import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { alias } from 'drizzle-orm/pg-core';
import { eq, and, or, desc, count, inArray, like, sql, type Database } from '@avicenna/db';
import {
  deliveries,
  deliveryLines,
  deliverySyncs,
  deliveryOrders,
  customers,
  customerParts,
  parts,
  plants,
  kanbans,
  kanbanItems,
  locations,
  lots,
  mutations,
  scanEvents,
  sapOutbox,
  users,
  devices,
} from '@avicenna/db';
import { galatDuplikat } from '@avicenna/db';

/** Lokasi staging sebagai alias kedua dari TM_LOCATION. Lihat rincian() di bawah. */
const lokasiStaging = alias(locations, 'staging');
import {
  convertCustomerPartNumber,
  allocateFifo,
  modeLoading,
  perluKanbanInternal,
  bacaKanban,
  KanbanTidakTerbaca,
  DELIVERY_DAY_START_HOUR,
  productionDayWindow,
  deliveryAttentionReason,
  type PartNumberFormat,
} from '@avicenna/domain';
import type {
  LoadingPhase,
  LoadingScanInput,
  LoadingScanResult,
  LoadingSummary,
  LoadingRfidBatchInput,
  LoadingRfidBatchResult,
} from '@avicenna/contracts';
import { loadingRfidBatchSchema } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';
import { prepareDeliveryOrder, lockDeliveryOrder } from './delivery-order';
import { readDeliveryFlow, scanDriverDocument, receiveDeliveryOrderReturn } from './delivery-flow';

/** Pelanggaran unique index MySQL, dipakai mengenali retry scan idempoten. */

@Injectable()
export class LoadingService {
  private readonly logger = new Logger(LoadingService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async authorizeScan(deliveryId: number, principal?: Principal, rfidOnly = false) {
    if (!principal) throw new ForbiddenException('Login pengguna atau perangkat RFID diperlukan.');
    const [doc] = await this.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    if (principal.kind === 'device') {
      const [device] = await this.db.select().from(devices).where(eq(devices.id, principal.sub));
      if (
        !device?.isActive ||
        !(rfidOnly ? ['RFID'] : ['RFID', 'SCANNER']).includes(device.kind) ||
        device.plantId !== doc.plantId
      )
        throw new ForbiddenException(
          'Gunakan perangkat scan aktif yang sesuai dari pabrik loading list ini.',
        );
    } else if (
      !['ADMIN', 'SCANNING'].includes(principal.roleKind ?? '') ||
      (principal.roleKind !== 'ADMIN' && principal.plantId !== doc.plantId)
    ) {
      throw new ForbiddenException(
        'Role atau pabrik pengguna tidak diizinkan melakukan scan delivery.',
      );
    }
    return doc;
  }

  async scanRfidBatch(
    raw: LoadingRfidBatchInput,
    principal?: Principal,
  ): Promise<LoadingRfidBatchResult> {
    const input = loadingRfidBatchSchema.parse(raw);
    const doc = await this.authorizeScan(input.deliveryId, principal, true);
    if (!['DRAFT', 'PICKING'].includes(doc.status))
      throw new BadRequestException('Pulling sudah ditutup atau loading list dibatalkan.');

    const results: LoadingRfidBatchResult['results'] = [];
    // Satu transaksi per tag: tag bermasalah tidak membatalkan tag lain yang valid.
    for (const [index, tag] of input.tags.entries()) {
      try {
        const result = await this.scanKanban(
          {
            deliveryId: input.deliveryId,
            phase: 'PULLING',
            customerPart: tag.customerPart,
            serialNumber: tag.serialNumber,
          },
          principal,
          tag.tagId,
        );
        results.push({
          index,
          tagId: tag.tagId,
          status:
            result.status === 'REJECTED' ? 'REJECTED' : result.duplicate ? 'DUPLICATE' : 'ACCEPTED',
          message: result.message,
          lineId: result.lineId,
          partNumber: result.partNumber,
        });
      } catch (error) {
        if (!(error instanceof BadRequestException || error instanceof NotFoundException))
          throw error;
        await this.recordRejected(
          { deliveryId: input.deliveryId, phase: 'PULLING', customerPart: tag.customerPart },
          error.message,
          principal,
          tag.tagId,
        );
        results.push({
          index,
          tagId: tag.tagId,
          status: 'REJECTED',
          message: error.message,
          lineId: null,
          partNumber: null,
        });
      }
    }
    return {
      deliveryId: input.deliveryId,
      phase: 'PULLING',
      results,
      summary: {
        total: results.length,
        accepted: results.filter((r) => r.status === 'ACCEPTED').length,
        duplicate: results.filter((r) => r.status === 'DUPLICATE').length,
        rejected: results.filter((r) => r.status === 'REJECTED').length,
      },
      totals: await this.totals(input.deliveryId),
    };
  }

  /** Manifest bisa menaungi beberapa loading list, jadi semua kandidat dikembalikan. */
  async resolveDocument(rawCode: string) {
    const code = rawCode.trim();
    if (!code) throw new BadRequestException('Scan manifest atau loading list lebih dulu');
    if (code.length > 128) throw new BadRequestException('Barcode dokumen terlalu panjang');

    const matches = await this.db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        manifestNumber: deliveries.manifestNumber,
        customerName: customers.name,
        deliveryDate: deliveries.deliveryDate,
        cycle: deliveries.cycle,
        status: deliveries.status,
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .where(
        or(
          eq(deliveries.documentNumber, code),
          eq(deliveries.manifestNumber, code),
          eq(deliveries.pdsNumber, code),
        ),
      )
      .orderBy(desc(deliveries.deliveryDate), desc(deliveries.id))
      .limit(100);

    if (matches.length === 0) {
      throw new NotFoundException(`Manifest atau loading list "${code}" tidak ditemukan`);
    }
    return { code, matches };
  }

  /** Menandai surat jalan yang kembali setelah barang diterima customer. */
  async receiveReturnedDocument(rawCode: string, principal?: Principal) {
    const code = rawCode.trim();
    if (!code) throw new BadRequestException('Scan nomor surat jalan lebih dulu');
    if (code.length > 128) throw new BadRequestException('Barcode surat jalan terlalu panjang');
    const orderResult = await receiveDeliveryOrderReturn(this.db, code, principal);
    if (orderResult) return orderResult;

    const rows = await this.db
      .select({
        id: deliveries.id,
        plantId: deliveries.plantId,
        documentNumber: deliveries.documentNumber,
        customerName: customers.name,
        deliveryDate: deliveries.deliveryDate,
        status: deliveries.status,
        arrivedAt: deliveries.arrivedAt,
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .leftJoin(
        sapOutbox,
        and(
          eq(sapOutbox.sourceTable, 'TT_DELIVERY'),
          eq(sapOutbox.sourceId, deliveries.id),
          eq(sapOutbox.docType, 'DELIVERY'),
        ),
      )
      .where(or(eq(deliveries.documentNumber, code), eq(sapOutbox.sapDocNumber, code)))
      .orderBy(desc(deliveries.deliveryDate), desc(deliveries.id))
      .limit(1);

    const doc = rows[0];
    if (!doc) throw new NotFoundException(`Surat jalan "${code}" tidak ditemukan`);
    if (doc.status === 'RECEIVED') {
      return { ...doc, receivedAt: doc.arrivedAt, alreadyReceived: true };
    }
    if (doc.status !== 'SHIPPED') {
      throw new BadRequestException(
        'Surat jalan ini belum berstatus berangkat, jadi belum bisa ditandai diterima customer.',
      );
    }

    const receivedAt = new Date();
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(deliveries)
          .set({ status: 'RECEIVED', arrivedAt: receivedAt })
          .where(and(eq(deliveries.id, doc.id), eq(deliveries.status, 'SHIPPED')));
        await tx.insert(scanEvents).values({
          plantId: doc.plantId,
          kind: 'DELIVERY',
          rawCode: code,
          qty: 0,
          userId: principal?.kind === 'user' ? principal.sub : null,
          scannedAt: receivedAt,
          dedupeKey: `delivery-return:${doc.id}`,
          meta: { deliveryId: doc.id, action: 'RECEIVE_RETURN' },
        });
      });
    } catch (err) {
      const e = err as { errno?: number; cause?: { errno?: number } };
      if (!galatDuplikat(err)) throw err;
      const [current] = await this.db
        .select({ arrivedAt: deliveries.arrivedAt })
        .from(deliveries)
        .where(eq(deliveries.id, doc.id))
        .limit(1);
      return {
        ...doc,
        status: 'RECEIVED' as const,
        receivedAt: current?.arrivedAt ?? receivedAt,
        alreadyReceived: true,
      };
    }

    this.logger.log(`surat jalan ${doc.documentNumber} kembali dari customer`);
    return { ...doc, status: 'RECEIVED' as const, receivedAt, alreadyReceived: false };
  }

  /**
   * Satu kanban discan saat muat barang.
   *
   * Barcode customer diubah dulu ke format internal memakai aturan milik
   * customer yang bersangkutan (lihat convertCustomerPartNumber). Tanpa itu
   * "902101234512" tidak akan pernah cocok dengan "90210-12345-12" di master.
   *
   * Scan yang berlebih TIDAK ditolak, hanya ditandai OVER. Barang sudah
   * terlanjur naik ke truk; menolak mencatatnya hanya membuat catatan sistem
   * berbeda dari isi truk yang sebenarnya.
   */
  async scan(input: LoadingScanInput, principal?: Principal): Promise<LoadingScanResult> {
    return this.scanKanban(input, principal);
  }

  private async scanKanban(
    input: LoadingScanInput,
    principal?: Principal,
    rfidTagId?: string,
  ): Promise<LoadingScanResult & { duplicate?: boolean }> {
    if (input.clientRef) {
      const [event] = await this.db
        .select({ meta: scanEvents.meta })
        .from(scanEvents)
        .where(
          eq(scanEvents.dedupeKey, `load:${input.deliveryId}:${input.phase}:${input.clientRef}`),
        )
        .limit(1);
      if (event) {
        const meta = event.meta as { deliveryLineId: number; converted: string };
        const [line] = await this.db
          .select({ line: deliveryLines, partNumber: parts.partNumber })
          .from(deliveryLines)
          .leftJoin(parts, eq(parts.id, deliveryLines.partId))
          .where(eq(deliveryLines.id, meta.deliveryLineId))
          .limit(1);
        if (line) {
          const actual =
            input.phase === 'PULLING' ? line.line.pickedKanban : line.line.actualKanban;
          const target =
            input.phase === 'PULLING' ? line.line.plannedKanban : line.line.pickedKanban;
          return {
            status: actual > target ? 'OVER' : 'ACCEPTED',
            phase: input.phase,
            message: `Sudah tercatat sebelumnya — tetap ${actual} dari ${target} kanban.`,
            lineId: line.line.id,
            partNumber: line.partNumber,
            convertedPartNumber: meta.converted,
            actualKanban: actual,
            plannedKanban: target,
            totals: await this.totals(input.deliveryId),
          };
        }
      }
    }
    const docRows = await this.db
      .select({
        id: deliveries.id,
        plantId: deliveries.plantId,
        status: deliveries.status,
        format: customers.partNumberFormat,
        directKanban: customers.directKanban,
        plantScanDirectKanban: plants.scanDirectKanbanSaatMuat,
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .leftJoin(plants, eq(deliveries.plantId, plants.id))
      .where(eq(deliveries.id, input.deliveryId))
      .limit(1);

    const doc = docRows[0];
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    if (doc.status === 'SHIPPED' || doc.status === 'RECEIVED') {
      throw new BadRequestException(
        'Loading list ini sudah berangkat. Buat dokumen baru bila masih ada muatan.',
      );
    }
    if (doc.status === 'CANCELLED') {
      throw new BadRequestException('Loading list ini sudah dibatalkan.');
    }

    const phase = input.phase;
    if (phase === 'LOADING')
      throw new BadRequestException(
        'Scan kanban dilakukan pada tahap pulling PPIC. Driver cukup scan surat jalan setelah GI AIIA dan GR AII berhasil.',
      );

    /*
     * Urutan tahapan ditegakkan di sini, bukan sekadar disarankan di layar.
     *
     * Memuat barang yang belum pernah diambil dari gudang berarti memotong stok
     * dari staging yang isinya nol — saldo PP04 menjadi minus dan selisihnya
     * baru ketahuan berbulan-bulan kemudian, saat tidak ada lagi yang ingat
     * dokumen mana penyebabnya.
     */
    if (phase === 'PULLING' && (doc.status === 'PICKED' || doc.status === 'LOADING')) {
      throw new BadRequestException(
        'Pulling untuk dokumen ini sudah ditutup. Buka kembali bila masih ada yang harus diambil.',
      );
    }

    /*
     * ── Cara scan ditentukan customer DAN pabrik ──────────────────────────
     *
     * Customer biasa dicocokkan tiga arah. Customer direct kanban tidak punya
     * kanban internal untuk dicocokkan, dan di sebagian pabrik bahkan tidak
     * men-scan apa pun per box.
     *
     * Hanya berlaku saat MUAT. Pulling tetap men-scan seperti biasa: yang
     * diambil dari gudang harus dihitung apa pun cara muatnya nanti.
     */
    const mode = modeLoading({
      directKanban: doc.directKanban ?? false,
      plantScanDirectKanban: doc.plantScanDirectKanban ?? false,
    });

    if (!perluKanbanInternal(mode) && input.internalKanban)
      throw new BadRequestException('Customer ini cukup memakai kanban customer.');

    const kanbanContext = {
      customerFormat: (doc.format ?? 'NONE') as PartNumberFormat,
      // Delivery menerima kartu BODY berformat posisi tetap. Pencocokan part
      // di bawah tetap menjadi pagar bila format serupa datang dari pabrik lain.
      scanMode: 'PER_KANBAN' as const,
    };
    let customerPart = input.customerPart.trim();
    let customerSerial = input.serialNumber;
    try {
      const customerKanban = bacaKanban(input.customerPart, kanbanContext);
      customerPart = customerKanban.customerPartNumber ?? customerKanban.partNumber ?? customerPart;
      customerSerial ??= customerKanban.serialNumber;
    } catch {
      // Nomor part polos tetap didukung untuk scanner lama dan pengetesan manual.
    }

    const converted = convertCustomerPartNumber(
      customerPart,
      (doc.format ?? 'NONE') as PartNumberFormat,
    );

    const candidates = await this.db
      .select({
        lineId: deliveryLines.id,
        partId: deliveryLines.partId,
        partNumber: parts.partNumber,
        partName: parts.name,
        plannedKanban: deliveryLines.plannedKanban,
        plannedQty: deliveryLines.plannedQty,
        pickedKanban: deliveryLines.pickedKanban,
        pickedQty: deliveryLines.pickedQty,
        actualKanban: deliveryLines.actualKanban,
        qtyPerKanban: deliveryLines.qtyPerKanban,
        customerPartNumber: sql<
          string | null
        >`COALESCE(${deliveryLines.customerPartNumberSource}, ${customerParts.customerPartNumber})`,
      })
      .from(deliveryLines)
      .leftJoin(parts, eq(deliveryLines.partId, parts.id))
      .leftJoin(customerParts, eq(deliveryLines.customerPartId, customerParts.id))
      .where(eq(deliveryLines.deliveryId, input.deliveryId));

    // Cocokkan lewat penomoran customer dulu, lalu part internal — sebagian
    // barcode hanya memuat salah satunya.
    const chooseLine = (predicate: (line: (typeof candidates)[number]) => boolean) => {
      const matching = candidates.filter(predicate);
      return (
        matching.find((line) =>
          phase === 'PULLING'
            ? line.pickedKanban < line.plannedKanban
            : line.actualKanban < line.pickedKanban,
        ) ?? matching[0]
      );
    };
    const foundMatch =
      chooseLine((c) => c.customerPartNumber === converted) ??
      chooseLine((c) => c.partNumber === converted) ??
      chooseLine((c) => c.customerPartNumber === customerPart) ??
      /*
       * Nomor part internal APA ADANYA, tanpa konversi.
       *
       * Aturan konversi menyisipkan tanda hubung pada kode 12 karakter, dan itu
       * berlaku menurut PANJANG kode — bukan menurut format customer. Nomor
       * part internal yang kebetulan 12 karakter ikut berubah bentuk, lalu
       * tidak cocok dengan dirinya sendiri.
       *
       * Ditaruh paling belakang: hanya dipakai bila seluruh pencocokan yang
       * lebih khas sudah gagal, jadi tidak bisa menyerobot padanan yang benar.
       */
      chooseLine((c) => c.partNumber === customerPart);

    if (!foundMatch) {
      return this.tolakScan(
        input.deliveryId,
        phase,
        converted,
        `Part "${converted}" tidak ada dalam loading list ini. Periksa barcode atau dokumennya.`,
        input,
        principal,
        rfidTagId,
      );
    }
    let match = foundMatch;
    if (rfidTagId && !match.partId)
      throw new BadRequestException('Part SAP belum dipetakan ke master part.');
    if (match.qtyPerKanban <= 0)
      throw new BadRequestException('Qty per box belum lengkap. Lengkapi master sebelum scan.');

    /*
     * ── Pencocokan arah ketiga: kanban internal ───────────────────────────
     *
     * Kanban customer sudah mencocokkan barang dengan baris loading list. Yang
     * dibuktikan di sini adalah bahwa KARTU INTERNAL yang menempel pada box itu
     * juga milik part yang sama.
     *
     * Tanpa pemeriksaan ini, box berisi part A dengan kartu internal part B
     * tetap lolos selama label customer-nya benar — dan barang yang keliru
     * berangkat dengan dokumen yang terlihat rapi.
     */
    let internalSerial: string | undefined;
    if (!rfidTagId && perluKanbanInternal(mode) && !input.internalKanban)
      throw new BadRequestException('Scan kanban internal setelah kanban customer.');
    if (perluKanbanInternal(mode) && input.internalKanban) {
      let kb;
      try {
        kb = bacaKanban(input.internalKanban, kanbanContext);
      } catch (err) {
        if (err instanceof KanbanTidakTerbaca) {
          return this.tolakScan(
            input.deliveryId,
            phase,
            converted,
            'Barcode kanban internal tidak terbaca. Scan ulang kartunya.',
            input,
            principal,
          );
        }
        throw err;
      }
      internalSerial = kb.serialNumber;
      const kartuDenganSeriSama = await this.db
        .select({ id: kanbans.id, partId: kanbans.partId })
        .from(kanbans)
        .where(eq(kanbans.serialNumber, kb.serialNumber ?? ''));
      const kartu = kartuDenganSeriSama.find((item) => item.partId === match.partId);

      if (kartuDenganSeriSama.length === 0) {
        return this.tolakScan(
          input.deliveryId,
          phase,
          converted,
          `Kartu kanban internal seri ${kb.serialNumber} tidak terdaftar. Laporkan ke leader.`,
          input,
          principal,
        );
      }

      if (!kartu) {
        return this.tolakScan(
          input.deliveryId,
          phase,
          converted,
          `Kanban internal ini milik part lain, bukan ${match.partNumber}. Periksa boxnya.`,
          input,
          principal,
        );
      }

      /*
       * Kartu kosong berarti isinya tidak pernah ditempel di lini FG. Boxnya
       * mungkin benar, tetapi tidak ada satu pun unit yang bisa ditelusuri —
       * dan itu baru ketahuan saat customer menanyakan asal-usul barang.
       */
      const [isi] = await this.db
        .select({ n: count() })
        .from(kanbanItems)
        .where(eq(kanbanItems.kanbanId, kartu.id));
      if (Number(isi?.n ?? 0) === 0) {
        return this.tolakScan(
          input.deliveryId,
          phase,
          converted,
          `Kartu kanban seri ${kb.serialNumber} kosong — isinya belum pernah discan di lini finish good.`,
          input,
          principal,
        );
      }
    }

    const rfidHash = rfidTagId ? createHash('sha256').update(rfidTagId).digest('hex') : undefined;
    // Identitas tag tidak memakai serial customer pendek yang dapat berulang antar box.
    const scanSerial = rfidHash
      ? `RFID:${rfidHash.slice(0, 59)}`
      : (internalSerial ?? customerSerial);
    let rfidDedupeKey: string | undefined;

    /*
     * Tiap tahap menghitung kolomnya sendiri dan punya sasaran sendiri.
     *
     * Saat pulling, sasarannya adalah RENCANA. Saat memuat, sasarannya adalah
     * yang BENAR-BENAR terambil — memuat lebih banyak daripada yang ada di
     * staging tidak mungkin benar, berapa pun rencananya.
     */
    const kolom = phase === 'PULLING' ? deliveryLines.pickedKanban : deliveryLines.actualKanban;
    let sasaran = phase === 'PULLING' ? match.plannedKanban : match.pickedKanban;

    let duplicate = false;
    const nextActual = await this.db
      .transaction(async (tx) => {
        const [currentDoc] = await tx
          .select({ status: deliveries.status })
          .from(deliveries)
          .where(eq(deliveries.id, input.deliveryId))
          .for('update');
        if (
          !currentDoc ||
          !(['DRAFT', 'PICKING', 'PICKED', 'LOADING'] as string[]).includes(currentDoc.status) ||
          (phase === 'PULLING'
            ? !['DRAFT', 'PICKING'].includes(currentDoc.status)
            : !['PICKED', 'LOADING'].includes(currentDoc.status))
        ) {
          throw new BadRequestException(
            'Tahap dokumen sudah berubah. Muat ulang halaman sebelum scan.',
          );
        }
        // Barcode lama tidak selalu membawa identitas box; jangan campur dengan RFID pada dokumen aktif.
        const [otherMethod] = await tx
          .select({
            active: sql<number>`COALESCE(SUM(CASE
            WHEN ${scanEvents.meta}->>'action' = 'UNDO' THEN -1
            WHEN ${scanEvents.meta}->>'action' = 'REJECTED' THEN 0 ELSE 1 END), 0)::int`,
          })
          .from(scanEvents)
          .where(
            and(
              eq(scanEvents.kind, 'DELIVERY'),
              sql`${scanEvents.meta}->>'deliveryId' = ${String(input.deliveryId)}`,
              sql`${scanEvents.meta}->>'phase' = ${phase}`,
              sql`COALESCE(${scanEvents.meta}->>'method', 'BARCODE') = ${rfidTagId ? 'BARCODE' : 'RFID'}`,
            ),
          );
        if (Number(otherMethod?.active ?? 0) > 0)
          throw new BadRequestException(
            'Loading list ini sudah memakai metode scan lain. Gunakan metode yang sama atau koreksi semua scan sebelumnya terlebih dahulu.',
          );
        if (rfidTagId) {
          // Kunci lintas dokumen/reader, termasuk ketika tag datang bersamaan untuk part berbeda.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`delivery-rfid:${rfidTagId}`}, 0))`,
          );
          const history = await tx
            .select({
              meta: scanEvents.meta,
              rawCode: scanEvents.rawCode,
              status: deliveries.status,
            })
            .from(scanEvents)
            .innerJoin(deliveries, sql`${scanEvents.meta}->>'deliveryId' = ${deliveries.id}::text`)
            .where(
              and(
                eq(scanEvents.kind, 'DELIVERY'),
                eq(scanEvents.serialNumber, scanSerial!),
                sql`${scanEvents.meta}->>'phase' = 'PULLING'`,
                sql`${scanEvents.meta}->>'method' = 'RFID'`,
                sql`${scanEvents.meta}->>'rfidTagId' = ${rfidTagId}`,
              ),
            )
            .orderBy(scanEvents.id);
          type RfidMeta = {
            deliveryId: number;
            deliveryLineId: number;
            action?: string;
            rfidSerialInput?: string | null;
          };
          const own = history.filter(
            (event) => (event.meta as RfidMeta).deliveryId === input.deliveryId,
          );
          const accepted = own.filter((event) => (event.meta as RfidMeta).action !== 'UNDO');
          if (
            accepted.some(
              (event) =>
                event.rawCode !== input.customerPart ||
                ((event.meta as RfidMeta).rfidSerialInput ?? null) !== (input.serialNumber ?? null),
            )
          )
            throw new BadRequestException(
              'Tag RFID sudah terikat ke data kanban lain pada loading list ini.',
            );
          const active = history.filter(
            (event) => !['SHIPPED', 'RECEIVED', 'CANCELLED'].includes(event.status),
          );
          const balance = active.reduce(
            (n, event) => n + ((event.meta as RfidMeta).action === 'UNDO' ? -1 : 1),
            0,
          );
          if (balance > 0) {
            const ownBalance = own.reduce(
              (n, event) => n + ((event.meta as RfidMeta).action === 'UNDO' ? -1 : 1),
              0,
            );
            if (ownBalance <= 0)
              throw new BadRequestException(
                'Tag RFID masih tercatat pada loading list aktif lain.',
              );
            const originalId = (accepted.at(-1)!.meta as RfidMeta).deliveryLineId;
            const [original] = await tx
              .select()
              .from(deliveryLines)
              .where(eq(deliveryLines.id, originalId));
            if (!original)
              throw new BadRequestException('Baris scan RFID sebelumnya tidak ditemukan.');
            match = { ...match, ...original, lineId: original.id };
            duplicate = true;
            return original.pickedKanban;
          }
          // Setelah undo, scan baru mendapat kunci baru; event sebelumnya tetap utuh untuk audit.
          rfidDedupeKey = `load-rfid:${rfidHash}:${input.deliveryId}:${accepted.length}`;
        }
        const availableLines = await tx
          .select()
          .from(deliveryLines)
          .where(
            inArray(
              deliveryLines.id,
              candidates
                .filter(
                  (line) =>
                    line.partId === match!.partId &&
                    line.customerPartNumber === match!.customerPartNumber,
                )
                .map((line) => line.lineId),
            ),
          )
          .orderBy(deliveryLines.id);
        const available =
          availableLines.find((line) =>
            phase === 'PULLING'
              ? line.pickedKanban < line.plannedKanban &&
                (!rfidTagId || line.pickedQty + line.qtyPerKanban <= line.plannedQty)
              : line.actualKanban < line.pickedKanban,
          ) ?? availableLines[0];
        if (available) match = { ...match!, lineId: available.id, ...available };
        sasaran = phase === 'PULLING' ? match!.plannedKanban : match!.pickedKanban;
        if (rfidTagId && match.pickedQty !== match.pickedKanban * match.qtyPerKanban)
          throw new BadRequestException(
            'Jumlah kanban dan qty pulling tidak konsisten. Koreksi data loading list sebelum melanjutkan scan RFID.',
          );
        if (
          rfidTagId &&
          (match.pickedKanban >= match.plannedKanban ||
            match.pickedQty + match.qtyPerKanban > match.plannedQty)
        )
          throw new BadRequestException(
            'Jumlah RFID melebihi rencana kanban atau qty loading list.',
          );
        if (scanSerial && !rfidTagId) {
          // ponytail: scan berseri diserialkan per part; tabel reservasi terpisah
          // diperlukan hanya bila satu part diproses banyak scanner sekaligus.
          await tx.execute(
            sql`SELECT ${parts.id} FROM ${parts} WHERE ${parts.id} = ${match.partId} FOR UPDATE`,
          );
          const riwayat = await tx
            .select({ meta: scanEvents.meta, dedupeKey: scanEvents.dedupeKey })
            .from(scanEvents)
            .innerJoin(
              deliveries,
              /*
               * Kolomnya dibandingkan sebagai TEKS di kedua sisi.
               *
               * `->>` mengembalikan text, sedangkan INT_ID bigint — dan
               * Postgres tidak memaksa tipe seperti MySQL, jadi tanpa cast
               * seluruh kueri gagal dengan "operator does not exist: text =
               * bigint". Dua baris di bawah sudah membandingkan dengan String(),
               * yang ini terlewat karena sisi kanannya kolom, bukan nilai.
               */
              sql`${scanEvents.meta}->>'deliveryId' = ${deliveries.id}::text`,
            )
            .where(
              and(
                eq(scanEvents.kind, 'DELIVERY'),
                eq(scanEvents.partId, match.partId),
                or(
                  eq(scanEvents.serialNumber, scanSerial),
                  customerSerial
                    ? sql`${scanEvents.meta}->>'customerSerial' = ${customerSerial}`
                    : undefined,
                  internalSerial
                    ? sql`${scanEvents.meta}->>'internalSerial' = ${internalSerial}`
                    : undefined,
                ),
                sql`${scanEvents.meta}->>'phase' = ${phase}`,
                sql`${deliveries.status} NOT IN ('SHIPPED', 'RECEIVED', 'CANCELLED')`,
              ),
            );
          const sameRequest =
            input.clientRef &&
            riwayat.some(
              (event) => event.dedupeKey === `load:${input.deliveryId}:${phase}:${input.clientRef}`,
            );
          const saldoScan = riwayat.reduce((total, event) => {
            const meta = event.meta as { action?: string } | null;
            return total + (meta?.action === 'UNDO' ? -1 : meta?.action === 'REJECTED' ? 0 : 1);
          }, 0);
          if (saldoScan > 0 && !sameRequest) {
            throw new BadRequestException(`Kanban seri ${scanSerial} sudah discan pada tahap ini.`);
          }
        }
        /*
         * Penambahan dilakukan di dalam SQL, bukan dengan membaca lalu menulis
         * kembali dari sisi aplikasi.
         *
         * Dua orang bisa men-scan kanban ke dokumen yang sama pada saat yang
         * hampir bersamaan — satu di dekat truk, satu di gudang. Dengan
         * baca-ubah-tulis, keduanya membaca angka 5 dan keduanya menulis 6:
         * satu kanban hilang dari catatan tanpa jejak apa pun. UPDATE ini
         * mengunci barisnya, jadi yang kedua menunggu dan menulis 7.
         *
         * ── Kenapa lewat .set(), bukan SQL mentah ──────────────────────────
         *
         * Sebelumnya UPDATE-nya ditulis tangan, dan di Postgres itu gagal:
         * sisi kiri SET harus nama kolom POLOS, sedangkan Drizzle merender
         * kolom dengan skema dan tabelnya — "logistics"."TT_DELIVERY_ITEM".
         * MySQL menerimanya, Postgres menolak dengan "column logistics of
         * relation TT_DELIVERY_ITEM does not exist". Builder-nya merender
         * bentuk yang benar untuk kedua sisi.
         *
         * Sekalian hilang satu jebakan: catatan lama mengingatkan bahwa urutan
         * SET penting karena MySQL menilai ekspresi dari kiri ke kanan. Di
         * Postgres SELURUH ekspresi SET dinilai terhadap baris LAMA, jadi
         * keduanya memakai nilai sebelum penambahan apa pun urutannya.
         */
        const tambah = { kanban: sql`${kolom} + 1`, qty: sql`(${kolom} + 1) * ${deliveryLines.qtyPerKanban}` };
        await tx
          .update(deliveryLines)
          .set(
            phase === 'PULLING'
              ? { pickedKanban: tambah.kanban, pickedQty: tambah.qty }
              : { actualKanban: tambah.kanban, actualQty: tambah.qty },
          )
          .where(eq(deliveryLines.id, match.lineId));

        // Dibaca kembali di dalam transaksi yang sama: barisnya terkunci sampai
        // commit, jadi angka ini pasti hasil penambahan kita sendiri.
        const after = await tx
          .select({ nilai: kolom })
          .from(deliveryLines)
          .where(eq(deliveryLines.id, match.lineId))
          .limit(1);
        const sebelumnya = phase === 'PULLING' ? match.pickedKanban : match.actualKanban;
        const value = after[0]?.nilai ?? sebelumnya + 1;

        // Jejak tiap scan disimpan terpisah dari penghitungnya, supaya bisa
        // ditelusuri siapa memuat apa dan kapan — sesuatu yang tidak ada di bella.
        await tx.insert(scanEvents).values({
          plantId: doc.plantId,
          kind: 'DELIVERY',
          partId: match.partId,
          rawCode: input.customerPart,
          serialNumber: scanSerial || null,
          qty: match.qtyPerKanban,
          userId: principal?.kind === 'user' ? principal.sub : null,
          deviceId: principal?.kind === 'device' ? principal.sub : null,
          scannedAt: new Date(),
          // clientRef mencegah kiriman ulang jaringan terhitung dua kali.
          // Nomor kartu tidak dipakai sebagai kunci: setelah undo, kartu yang
          // sama memang harus boleh discan ulang dan riwayat lama tetap disimpan.
          dedupeKey:
            rfidDedupeKey ??
            (input.clientRef
              ? `load:${input.deliveryId}:${phase}:${input.clientRef}`
              : `load:${input.deliveryId}:${phase}:${match.lineId}:${randomUUID()}`),
          meta: {
            deliveryId: input.deliveryId,
            deliveryLineId: match.lineId,
            phase,
            converted,
            customerSerial: customerSerial ?? null,
            internalSerial: internalSerial ?? null,
            ...(rfidTagId
              ? { method: 'RFID', rfidTagId, rfidSerialInput: input.serialNumber ?? null }
              : {}),
          },
        });

        // Dokumen maju sendiri pada scan pertama tiap tahap, tanpa perlu
        // ditekan manual — operator sudah memegang barang, bukan tetikus.
        if (phase === 'PULLING' && doc.status === 'DRAFT') {
          await tx
            .update(deliveries)
            .set({ status: 'PICKING' })
            .where(eq(deliveries.id, input.deliveryId));
        }

        return value;
      })
      .catch(async (err) => {
        /*
         * Kunci idempoten bentrok: permintaan ini adalah kiriman ULANG dari
         * scan yang sudah tercatat — jaringan pabrik putus-nyambung, lalu
         * device mengirimkannya lagi.
         *
         * Seluruh transaksi sudah dibatalkan, jadi tidak ada hitungan ganda.
         * Yang tersisa hanya soal apa yang dilaporkan balik. Melempar 500 di
         * sini adalah kesalahan yang mahal: operator melihat "Gagal", lalu
         * men-scan ulang kanban yang sebenarnya sudah terhitung — dan BARU
         * saat itulah muncul hitungan ganda yang sesungguhnya.
         */
        const e = err as { errno?: number; cause?: { errno?: number } };
        if (!galatDuplikat(err) || rfidTagId) {
          if (err instanceof BadRequestException && !rfidTagId)
            await this.recordRejected(input, err.message, principal);
          throw err;
        }

        duplicate = true;
        if (input.clientRef) {
          const [event] = await this.db
            .select({ meta: scanEvents.meta })
            .from(scanEvents)
            .where(eq(scanEvents.dedupeKey, `load:${input.deliveryId}:${phase}:${input.clientRef}`))
            .limit(1);
          const originalId = (event?.meta as { deliveryLineId?: number } | null)?.deliveryLineId;
          const original = candidates.find((line) => line.lineId === originalId);
          if (original) match = original;
        }
        const rows = await this.db
          .select({ value: kolom })
          .from(deliveryLines)
          .where(eq(deliveryLines.id, match.lineId))
          .limit(1);
        return rows[0]?.value ?? (phase === 'PULLING' ? match.pickedKanban : match.actualKanban);
      });
    const [latestLine] = await this.db
      .select()
      .from(deliveryLines)
      .where(eq(deliveryLines.id, match.lineId));
    if (latestLine)
      sasaran = phase === 'PULLING' ? latestLine.plannedKanban : latestLine.pickedKanban;

    const over = nextActual > sasaran;
    const lebihDari = phase === 'PULLING' ? 'rencana' : 'yang diambil dari gudang';

    return {
      status: over ? 'OVER' : 'ACCEPTED',
      ...(rfidTagId ? { duplicate } : {}),
      phase,
      message: duplicate
        ? `Sudah tercatat sebelumnya — tetap ${nextActual} dari ${sasaran} kanban.`
        : over
          ? `Lebih dari ${lebihDari} — sudah ${nextActual} dari ${sasaran} kanban.`
          : `${match.partNumber} — ${nextActual}/${sasaran} kanban`,
      lineId: match.lineId,
      partNumber: match.partNumber,
      convertedPartNumber: converted,
      actualKanban: nextActual,
      plannedKanban: sasaran,
      totals: await this.totals(input.deliveryId),
    };
  }

  /** Membatalkan satu scan terakhir pada sebuah baris — salah scan itu biasa. */
  /** Bentuk jawaban penolakan yang seragam untuk layar stasiun. */
  private async tolakScan(
    deliveryId: number,
    phase: LoadingPhase,
    converted: string,
    message: string,
    input?: LoadingScanInput,
    principal?: Principal,
    rfidTagId?: string,
  ): Promise<LoadingScanResult> {
    if (input) await this.recordRejected(input, message, principal, rfidTagId);
    return {
      status: 'REJECTED',
      phase,
      message,
      lineId: null,
      partNumber: null,
      convertedPartNumber: converted,
      actualKanban: 0,
      plannedKanban: 0,
      totals: await this.totals(deliveryId),
    };
  }

  private async recordRejected(
    input: LoadingScanInput,
    message: string,
    principal?: Principal,
    rfidTagId?: string,
  ) {
    const [doc] = await this.db
      .select({ plantId: deliveries.plantId })
      .from(deliveries)
      .where(eq(deliveries.id, input.deliveryId));
    if (!doc) return;
    await this.db.insert(scanEvents).values({
      plantId: doc.plantId,
      kind: 'DELIVERY',
      qty: 0,
      rawCode: input.customerPart,
      userId: principal?.kind === 'user' ? principal.sub : null,
      deviceId: principal?.kind === 'device' ? principal.sub : null,
      scannedAt: new Date(),
      dedupeKey: `load-rejected:${randomUUID()}`,
      meta: {
        deliveryId: input.deliveryId,
        phase: input.phase,
        action: 'REJECTED',
        reason: message,
        internalKanban: input.internalKanban ?? null,
        ...(rfidTagId ? { method: 'RFID', rfidTagId } : {}),
      },
    });
  }

  async undoScan(
    deliveryId: number,
    lineId: number,
    phase: LoadingPhase = 'LOADING',
    principal?: Principal,
    reason = '',
  ) {
    if (reason.trim().length < 3)
      throw new BadRequestException('Alasan koreksi minimal 3 karakter');
    const result = await this.db.transaction(async (tx) => {
      const [lockedDoc] = await tx
        .select({ status: deliveries.status })
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId))
        .for('update');
      if (!lockedDoc) throw new NotFoundException('Loading list tidak ditemukan');
      if (
        phase === 'PULLING'
          ? !['DRAFT', 'PICKING'].includes(lockedDoc.status)
          : !['PICKED', 'LOADING'].includes(lockedDoc.status)
      ) {
        throw new BadRequestException('Tahap ini sudah ditutup; scan tidak dapat dibatalkan.');
      }
      const rows = await tx
        .select({ line: deliveryLines, plantId: deliveries.plantId })
        .from(deliveryLines)
        .innerJoin(deliveries, eq(deliveryLines.deliveryId, deliveries.id))
        .where(and(eq(deliveryLines.id, lineId), eq(deliveryLines.deliveryId, deliveryId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundException('Baris loading list tidak ditemukan');
      const line = row.line;

      const sekarang = phase === 'PULLING' ? line.pickedKanban : line.actualKanban;
      if (sekarang <= 0) {
        throw new BadRequestException('Belum ada kanban yang discan pada baris ini');
      }

      /*
       * Membatalkan pengambilan yang barangnya sudah terlanjur dimuat akan
       * membuat jumlah muat melebihi jumlah ambil — keadaan yang mustahil di
       * lapangan dan membuat saldo staging minus.
       */
      if (phase === 'PULLING' && sekarang - 1 < line.actualKanban) {
        throw new BadRequestException(
          `Tidak bisa dikurangi: ${line.actualKanban} kanban sudah dimuat ke truk. Batalkan muatnya lebih dulu.`,
        );
      }

      const next = sekarang - 1;
      await tx.execute(
        sql`SELECT ${parts.id} FROM ${parts} WHERE ${parts.id} = ${line.partId} FOR UPDATE`,
      );
      const auditRows = await tx
        .select({ serialNumber: scanEvents.serialNumber, meta: scanEvents.meta })
        .from(scanEvents)
        .where(
          and(
            eq(scanEvents.kind, 'DELIVERY'),
            sql`${scanEvents.meta}->>'deliveryLineId' = ${String(lineId)}`,
            sql`${scanEvents.meta}->>'phase' = ${phase}`,
          ),
        )
        .orderBy(scanEvents.id);
      const activeScans: typeof auditRows = [];
      for (const event of auditRows) {
        const meta = event.meta as { action?: string } | null;
        if (meta?.action === 'UNDO') activeScans.pop();
        else if (meta?.action !== 'REJECTED') activeScans.push(event);
      }
      const undoneScan = activeScans.at(-1);

      await tx
        .update(deliveryLines)
        .set(
          phase === 'PULLING'
            ? { pickedKanban: next, pickedQty: next * line.qtyPerKanban }
            : { actualKanban: next, actualQty: next * line.qtyPerKanban },
        )
        .where(eq(deliveryLines.id, lineId));
      await tx.insert(scanEvents).values({
        plantId: row.plantId,
        kind: 'DELIVERY',
        partId: line.partId,
        rawCode: `UNDO:${phase}:${lineId}`,
        serialNumber: undoneScan?.serialNumber ?? null,
        qty: -line.qtyPerKanban,
        userId: principal?.kind === 'user' ? principal.sub : null,
        scannedAt: new Date(),
        dedupeKey: `load-undo:${deliveryId}:${phase}:${lineId}:${randomUUID()}`,
        meta: {
          deliveryId,
          deliveryLineId: lineId,
          phase,
          action: 'UNDO',
          reason: reason.trim(),
          customerSerial:
            (undoneScan?.meta as { customerSerial?: string } | null)?.customerSerial ?? null,
          internalSerial:
            (undoneScan?.meta as { internalSerial?: string } | null)?.internalSerial ?? null,
          ...((undoneScan?.meta as { rfidTagId?: string } | null)?.rfidTagId
            ? {
                method: 'RFID',
                rfidTagId: (undoneScan!.meta as { rfidTagId: string }).rfidTagId,
              }
            : {}),
        },
      });
      return { lineId, actualKanban: next };
    });

    // Jejak scan tidak dihapus; koreksinya ditulis sebagai event baru.
    return { ...result, totals: await this.totals(deliveryId) };
  }

  /**
   * Menutup tahap pulling: barang berpindah dari gudang finish good ke staging.
   *
   * Inilah langkah 4 pada diagram alur — PP02 (-) menjadi PP04 (+). Mutasinya
   * dibuat sekali di akhir tahap, bukan per kanban: yang dibutuhkan SAP adalah
   * satu dokumen perpindahan, bukan ratusan baris sebesar satu kemasan.
   */
  async completePicking(id: number, principal?: Principal) {
    const docRows = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    const doc = docRows[0];
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    if (doc.status === 'CANCELLED') {
      throw new BadRequestException('Loading list ini sudah dibatalkan');
    }
    if (['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED'].includes(doc.status)) {
      if (['SHIPPED', 'RECEIVED'].includes(doc.status))
        throw new BadRequestException('Dokumen sudah berangkat; jangan memulai posting SAP baru.');
      await this.db.transaction(async (tx) => {
        if (!doc.pdsNumber?.trim()) throw new BadRequestException('Nomor PDS wajib tersedia.');
        await lockDeliveryOrder(tx, doc.customerId, doc.pdsNumber.trim());
        await prepareDeliveryOrder(
          tx,
          doc.customerId,
          doc.pdsNumber.trim(),
          new Date(),
          principal?.kind === 'user' ? principal.sub : null,
        );
      });
      const issued = await this.deliveryOrder(id);
      return {
        id,
        documentNumber: doc.documentNumber,
        pickedLines: 0,
        shortages: [],
        deliveryOrderNumber: issued.data?.number ?? null,
      };
    }
    if (doc.status !== 'DRAFT' && doc.status !== 'PICKING') {
      throw new BadRequestException('Pulling untuk dokumen ini sudah ditutup');
    }
    if (!doc.locationId || !doc.stagingLocationId) {
      throw new BadRequestException(
        'Dokumen ini belum menentukan SLOC asal dan staging. Lengkapi dulu sebelum menutup pulling.',
      );
    }
    const pdsNumber = doc.pdsNumber?.trim();
    if (!pdsNumber)
      throw new BadRequestException(
        'Nomor PDS customer wajib tersedia sebelum Finish Pulling dan penerbitan surat jalan.',
      );

    const lines = await this.db
      .select()
      .from(deliveryLines)
      .where(eq(deliveryLines.deliveryId, id));
    const diambil = lines.filter((l) => l.pickedKanban > 0);
    if (diambil.length === 0) {
      throw new BadRequestException(
        'Belum ada kanban yang diambil. Scan barangnya dulu sebelum menutup pulling.',
      );
    }

    // Kekurangan dilaporkan, bukan menghalangi — sama seperti di tahap muat.
    const shortages = await this.shortagesOf(
      diambil.map((l) => ({ partId: l.partId, qty: l.pickedQty })),
      doc.locationId,
    );

    const lotTracked = new Map<number, Awaited<ReturnType<typeof this.fifoLotsOf>>>();
    const partRows = await this.db
      .select()
      .from(parts)
      .where(
        inArray(
          parts.id,
          diambil.map((l) => l.partId),
        ),
      );
    for (const p of partRows) {
      if (p.trackingMode === 'LOT') {
        lotTracked.set(p.id, await this.fifoLotsOf(p.id, doc.locationId ?? undefined));
      }
    }

    const now = new Date();

    return this.db.transaction(async (tx) => {
      await lockDeliveryOrder(tx, doc.customerId, pdsNumber);
      const [locked] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, id))
        .for('update');
      if (locked && ['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED'].includes(locked.status)) {
        const [issued] = locked.deliveryOrderId
          ? await tx
              .select()
              .from(deliveryOrders)
              .where(eq(deliveryOrders.id, locked.deliveryOrderId))
          : [];
        return {
          id,
          documentNumber: locked.documentNumber,
          pickedLines: 0,
          shortages: [],
          deliveryOrderNumber: issued?.number ?? null,
        };
      }
      if (!locked || !['DRAFT', 'PICKING'].includes(locked.status))
        throw new BadRequestException('Pulling sudah ditutup.');
      if (locked.customerId !== doc.customerId || locked.pdsNumber?.trim() !== pdsNumber)
        throw new BadRequestException('Referensi PDS berubah. Muat ulang sebelum Finish Pulling.');
      const [issued] = await tx
        .select({ number: deliveryOrders.number })
        .from(deliveryOrders)
        .where(
          and(
            eq(deliveryOrders.customerId, doc.customerId),
            eq(deliveryOrders.pdsNumber, pdsNumber),
          ),
        );
      if (issued)
        throw new BadRequestException(
          `PDS ini sudah diterbitkan pada ${issued.number}. Item tambahan perlu diperiksa sebelum diterbitkan kembali.`,
        );
      const currentLines = await tx
        .select()
        .from(deliveryLines)
        .where(eq(deliveryLines.deliveryId, id));
      if (
        currentLines.some(
          (line) => line.pickedKanban !== lines.find((old) => old.id === line.id)?.pickedKanban,
        )
      ) {
        throw new BadRequestException('Ada scan baru. Muat ulang sebelum menutup pulling.');
      }
      for (const line of diambil) {
        const note = `Pulling ${line.pickedKanban} kanban untuk ${doc.documentNumber}`;
        const dasar = {
          plantId: doc.plantId,
          partId: line.partId,
          sourceTable: 'TT_DELIVERY',
          sourceId: id,
          note,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          occurredAt: now,
        };

        /*
         * Dua baris berpasangan, bukan satu. Perpindahan antar SLOC harus
         * terlihat di kedua sisinya: saldo PP02 turun DAN saldo PP04 naik.
         * Satu baris saja membuat barang seolah lenyap di tengah jalan.
         */
        const alokasi = lotTracked.get(line.partId);
        if (!alokasi) {
          await tx.insert(mutations).values({
            ...dasar,
            locationId: doc.locationId,
            type: 'TRANSFER_OUT',
            qty: String(-line.pickedQty),
          });
          await tx.insert(mutations).values({
            ...dasar,
            locationId: doc.stagingLocationId,
            type: 'TRANSFER_IN',
            qty: String(line.pickedQty),
          });
          continue;
        }

        const { allocations, unallocated } = allocateFifo(line.pickedQty, alokasi);
        for (const a of allocations) {
          await tx.insert(mutations).values({
            ...dasar,
            locationId: doc.locationId,
            lotId: a.lotId,
            type: 'TRANSFER_OUT',
            qty: String(-a.qty),
          });
          await tx.insert(mutations).values({
            ...dasar,
            locationId: doc.stagingLocationId,
            lotId: a.lotId,
            type: 'TRANSFER_IN',
            qty: String(a.qty),
          });
        }
        if (unallocated > 0) {
          const catatan = `${note} (tanpa lot — stok lot tidak mencukupi)`;
          await tx.insert(mutations).values({
            ...dasar,
            locationId: doc.locationId,
            type: 'TRANSFER_OUT',
            qty: String(-unallocated),
            note: catatan,
          });
          await tx.insert(mutations).values({
            ...dasar,
            locationId: doc.stagingLocationId,
            type: 'TRANSFER_IN',
            qty: String(unallocated),
            note: catatan,
          });
        }
      }

      await tx.update(deliveries).set({ status: 'PICKED' }).where(eq(deliveries.id, id));
      const deliveryOrderNumber = await prepareDeliveryOrder(
        tx,
        doc.customerId,
        pdsNumber,
        now,
        principal?.kind === 'user' ? principal.sub : null,
      );

      this.logger.log(`pulling ${doc.documentNumber} selesai: ${diambil.length} baris`);
      return {
        id,
        documentNumber: doc.documentNumber,
        pickedLines: diambil.length,
        shortages,
        deliveryOrderNumber,
      };
    });
  }

  /**
   * Menutup loading list: barang dinyatakan berangkat dan stok berkurang.
   *
   * Mutasi DELIVERY_OUT dibuat dari jumlah AKTUAL, bukan rencana — yang keluar
   * gudang adalah yang benar-benar dimuat.
   */
  async ship(_id: number, _principal?: Principal): Promise<never> {
    throw new BadRequestException(
      'Keberangkatan wajib melalui Absensi Driver dan konfirmasi GI AII.',
    );
  }

  /** Mencatat kedatangan truk — status truk terpisah dari status dokumen. */
  async setTruckStatus(
    id: number,
    truckStatus: 'PENDING' | 'ARRIVED' | 'LOADING' | 'DEPARTED',
    principal?: Principal,
  ) {
    const rows = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundException('Loading list tidak ditemukan');
    if (truckStatus === 'DEPARTED' && !['SHIPPED', 'RECEIVED'].includes(rows[0].status))
      throw new BadRequestException('Truk berangkat setelah scan driver dan GI AII dikonfirmasi.');

    await this.db
      .update(deliveries)
      .set({
        truckStatus,
        truckPickedAt: new Date(),
        truckPickedById: principal?.kind === 'user' ? principal.sub : null,
      })
      .where(eq(deliveries.id, id));

    return { id, truckStatus };
  }

  async list(params: {
    page: number;
    perPage: number;
    operationalDate?: string;
    all?: boolean;
    query?: string;
    attention?: 'all' | 'only';
  }) {
    const offset = (params.page - 1) * params.perPage;
    const operationalDate =
      params.operationalDate ?? productionDayWindow(new Date(), DELIVERY_DAY_START_HOUR).key;
    const term = params.query ? `%${params.query}%` : null;
    const filter = and(
      params.all ? undefined : eq(deliveries.deliveryDate, operationalDate),
      term
        ? or(
            like(deliveries.documentNumber, term),
            like(deliveries.manifestNumber, term),
            like(deliveries.pdsNumber, term),
            like(customers.name, term),
          )
        : undefined,
    );

    const summaryQuery = () =>
      this.db
        .select({
          id: deliveries.id,
          documentNumber: deliveries.documentNumber,
          manifestNumber: deliveries.manifestNumber,
          pdsNumber: deliveries.pdsNumber,
          purchaseOrderNumber: deliveries.purchaseOrderNumber,
          deliveryType: deliveries.deliveryType,
          sapGiStatus: deliveries.sapGiStatus,
          customerName: customers.name,
          deliveryDate: deliveries.deliveryDate,
          cycle: deliveries.cycle,
          status: deliveries.status,
          truckStatus: deliveries.truckStatus,
          locationId: deliveries.locationId,
          stagingLocationId: deliveries.stagingLocationId,
          plannedKanban: sql<string>`COALESCE(SUM(${deliveryLines.plannedKanban}), 0)`,
          pickedKanban: sql<string>`COALESCE(SUM(${deliveryLines.pickedKanban}), 0)`,
          actualKanban: sql<string>`COALESCE(SUM(${deliveryLines.actualKanban}), 0)`,
          unmappedItems: sql<string>`COALESCE(SUM(CASE WHEN ${deliveryLines.id} IS NOT NULL AND ${deliveryLines.customerPartId} IS NULL THEN 1 ELSE 0 END), 0)`,
          invalidQtyPerBox: sql<string>`COALESCE(SUM(CASE WHEN ${deliveryLines.id} IS NOT NULL AND ${deliveryLines.qtyPerKanban} <= 0 THEN 1 ELSE 0 END), 0)`,
          sapStatus: sapOutbox.status,
          intercompanyStatus: sql<
            string | null
          >`(SELECT o."CHR_STATUS" FROM ${sapOutbox} o WHERE o."CHR_SOURCE_TABLE"='TT_DELIVERY_ORDER' AND o."INT_SOURCE_ID"=${deliveries.deliveryOrderId} ORDER BY CASE o."CHR_DOC_TYPE" WHEN 'DELIVERY_GI_AII' THEN 3 WHEN 'DELIVERY_GR_AII' THEN 2 ELSE 1 END DESC LIMIT 1)`,
          sapIsSimulation: sapOutbox.isSimulation,
          sapDocNumber: sapOutbox.sapDocNumber,
          sapError: sapOutbox.lastError,
        })
        .from(deliveries)
        .leftJoin(customers, eq(deliveries.customerId, customers.id))
        .leftJoin(deliveryLines, eq(deliveryLines.deliveryId, deliveries.id))
        .leftJoin(
          sapOutbox,
          and(
            eq(sapOutbox.sourceTable, 'TT_DELIVERY'),
            eq(sapOutbox.sourceId, deliveries.id),
            eq(sapOutbox.docType, 'DELIVERY'),
          ),
        )
        .where(filter)
        .groupBy(
          deliveries.id,
          deliveries.documentNumber,
          deliveries.manifestNumber,
          deliveries.pdsNumber,
          deliveries.purchaseOrderNumber,
          deliveries.deliveryType,
          deliveries.sapGiStatus,
          customers.name,
          deliveries.deliveryDate,
          deliveries.cycle,
          deliveries.status,
          deliveries.truckStatus,
          deliveries.locationId,
          deliveries.stagingLocationId,
          sapOutbox.status,
          sapOutbox.isSimulation,
          sapOutbox.sapDocNumber,
          sapOutbox.lastError,
        )
        .orderBy(desc(deliveries.deliveryDate), desc(deliveries.id));

    type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];
    const normalize = (row: SummaryRow): LoadingSummary => {
      const summary = {
        ...row,
        sapStatus: row.intercompanyStatus ?? row.sapStatus,
        plannedKanban: Number(row.plannedKanban),
        pickedKanban: Number(row.pickedKanban),
        actualKanban: Number(row.actualKanban),
        unmappedItems: Number(row.unmappedItems),
        invalidQtyPerBox: Number(row.invalidQtyPerBox),
        missingSloc: !row.locationId || !row.stagingLocationId,
      };
      const {
        locationId: _locationId,
        stagingLocationId: _stagingLocationId,
        ...publicSummary
      } = summary;
      return {
        ...publicSummary,
        attentionReason: deliveryAttentionReason(publicSummary),
      };
    };

    if (params.attention) {
      /*
       * ponytail: halaman delivery hanya memuat satu hari operasional, jadi
       * menyaring hasil agregat di memori lebih kecil daripada menggandakan
       * CASE/HAVING SQL. Pindahkan ke SQL bila satu hari mencapai ribuan LL.
       */
      const allRows = (await summaryQuery()).map(normalize);
      const attentionRows = allRows.filter((row) => row.attentionReason);
      const selected = params.attention === 'only' ? attentionRows : allRows;
      const total = selected.length;
      return {
        data: selected.slice(offset, offset + params.perPage),
        meta: {
          page: params.page,
          perPage: params.perPage,
          total,
          totalPages: Math.max(1, Math.ceil(total / params.perPage)),
          operationalDate,
          attention: attentionRows.length,
          allTotal: allRows.length,
        },
      };
    }

    const [rows, totalRows] = await Promise.all([
      summaryQuery().limit(params.perPage).offset(offset),
      this.db
        .select({ value: count() })
        .from(deliveries)
        .leftJoin(customers, eq(deliveries.customerId, customers.id))
        .where(filter),
    ]);

    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows.map(normalize),
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
        operationalDate,
      },
    };
  }

  async syncStatus(date: string) {
    const [row] = await this.db
      .select()
      .from(deliverySyncs)
      .where(eq(deliverySyncs.operationalDate, date))
      .limit(1);
    return row ?? null;
  }

  async history(id: number) {
    const [doc] = await this.db
      .select({ id: deliveries.id, orderId: deliveries.deliveryOrderId })
      .from(deliveries)
      .where(eq(deliveries.id, id));
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    const [scans, movements] = await Promise.all([
      this.db
        .select({
          id: scanEvents.id,
          at: scanEvents.scannedAt,
          rawCode: scanEvents.rawCode,
          serialNumber: scanEvents.serialNumber,
          qty: scanEvents.qty,
          meta: scanEvents.meta,
          user: users.name,
        })
        .from(scanEvents)
        .leftJoin(users, eq(users.id, scanEvents.userId))
        .where(
          and(
            eq(scanEvents.kind, 'DELIVERY'),
            or(
              sql`${scanEvents.meta}->>'deliveryId' = ${String(id)}`,
              sql`${scanEvents.meta}->'deliveryIds' @> ${JSON.stringify([id])}::jsonb`,
            ),
          ),
        )
        .orderBy(desc(scanEvents.id))
        .limit(500),
      this.db
        .select({
          id: mutations.id,
          at: mutations.occurredAt,
          type: mutations.type,
          partNumber: parts.partNumber,
          qty: mutations.qty,
          note: mutations.note,
          user: users.name,
          location: locations.code,
        })
        .from(mutations)
        .leftJoin(users, eq(users.id, mutations.userId))
        .leftJoin(parts, eq(parts.id, mutations.partId))
        .leftJoin(locations, eq(locations.id, mutations.locationId))
        .where(
          or(
            and(eq(mutations.sourceTable, 'TT_DELIVERY'), eq(mutations.sourceId, id)),
            ...(doc.orderId
              ? [
                  and(
                    eq(mutations.sourceTable, 'TT_DELIVERY_ORDER'),
                    eq(mutations.sourceId, doc.orderId),
                  ),
                ]
              : []),
          ),
        )
        .orderBy(desc(mutations.id))
        .limit(500),
    ]);
    return { scans, movements };
  }

  /** Cetak ulang kartu internal terdaftar; tidak membuat kartu atau isi box baru. */
  async internalKanbans(id: number, query = '', principal?: Principal) {
    const [doc] = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    if (
      principal?.plantId &&
      principal.plantId !== doc.plantId &&
      !(principal.kind === 'user' && principal.roleKind === 'ADMIN')
    ) {
      throw new ForbiddenException('Kartu kanban berada di pabrik lain.');
    }
    const lines = await this.db
      .select({ partId: deliveryLines.partId })
      .from(deliveryLines)
      .where(eq(deliveryLines.deliveryId, id));
    if (!lines.length) return { data: [], truncated: false };
    const search = query.trim().slice(0, 64);
    const rows = await this.db
      .select({
        id: kanbans.id,
        serialNumber: kanbans.serialNumber,
        qtyPerBox: kanbans.qtyPerBox,
        partId: parts.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
        uom: parts.uom,
        plantCode: plants.code,
        boxType: kanbans.boxType,
        side: kanbans.side,
        status: kanbans.status,
      })
      .from(kanbans)
      .innerJoin(parts, eq(parts.id, kanbans.partId))
      .innerJoin(plants, eq(plants.id, kanbans.plantId))
      .where(
        and(
          eq(kanbans.plantId, doc.plantId),
          eq(parts.plantId, doc.plantId),
          inArray(
            kanbans.partId,
            lines.map((line) => line.partId),
          ),
          eq(kanbans.owner, 'INTERNAL'),
          eq(kanbans.isActive, true),
          sql`${kanbans.status} <> 'CANCELLED'`,
          or(sql`${kanbans.customerId} IS NULL`, eq(kanbans.customerId, doc.customerId)),
          search
            ? or(
                like(kanbans.serialNumber, `%${search}%`),
                like(parts.partNumber, `%${search}%`),
                like(parts.backNumber, `%${search}%`),
              )
            : undefined,
        ),
      )
      .orderBy(parts.partNumber, kanbans.serialNumber)
      .limit(501);
    return {
      data: rows.slice(0, 500).map((card) => {
        const back = card.backNumber?.trim(),
          serial = card.serialNumber.trim();
        const valid = back && serial && !/[|~\r\n]/.test(back + serial) && card.qtyPerBox > 0;
        return { ...card, barcode: valid ? `${back}|${serial}` : null };
      }),
      truncated: rows.length > 500,
    };
  }

  async findOne(id: number) {
    const rows = await this.db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        manifestNumber: deliveries.manifestNumber,
        pdsNumber: deliveries.pdsNumber,
        deliveryOrderNumber: deliveryOrders.number,
        purchaseOrderNumber: deliveries.purchaseOrderNumber,
        salesOrganization: deliveries.salesOrganization,
        distributionChannel: deliveries.distributionChannel,
        division: deliveries.division,
        deliveryType: deliveries.deliveryType,
        sapGiStatus: deliveries.sapGiStatus,
        invoiceNumber: deliveries.invoiceNumber,
        qcStatus: deliveries.qcStatus,
        sapActualDeliveryDate: deliveries.sapActualDeliveryDate,
        sapHeaderMovementStatus: deliveries.sapHeaderMovementStatus,
        sapLineMovementStatus: deliveries.sapLineMovementStatus,
        sapReceiveStatus: deliveries.sapReceiveStatus,
        sapReceiveDate: deliveries.sapReceiveDate,
        sapReceiveTime: deliveries.sapReceiveTime,
        plantId: deliveries.plantId,
        customerId: deliveries.customerId,
        customerName: customers.name,
        customerCode: customers.code,
        partNumberFormat: customers.partNumberFormat,
        directKanban: customers.directKanban,
        plantScanDirectKanban: plants.scanDirectKanbanSaatMuat,
        deliveryDate: deliveries.deliveryDate,
        cycle: deliveries.cycle,
        dock: deliveries.dock,
        planTime: deliveries.planTime,
        locationId: deliveries.locationId,
        locationName: locations.name,
        locationCode: locations.code,
        stagingLocationId: deliveries.stagingLocationId,
        stagingLocationName: lokasiStaging.name,
        stagingLocationCode: lokasiStaging.code,
        status: deliveries.status,
        truckStatus: deliveries.truckStatus,
        truckNumber: deliveries.truckNumber,
        driverName: deliveries.driverName,
        departedAt: deliveries.departedAt,
        arrivedAt: deliveries.arrivedAt,
        sapStatus: sapOutbox.status,
        sapIsSimulation: sapOutbox.isSimulation,
        sapDocNumber: sapOutbox.sapDocNumber,
        sapError: sapOutbox.lastError,
      })
      .from(deliveries)
      .leftJoin(deliveryOrders, eq(deliveryOrders.id, deliveries.deliveryOrderId))
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .leftJoin(plants, eq(deliveries.plantId, plants.id))
      .leftJoin(locations, eq(deliveries.locationId, locations.id))
      .leftJoin(
        sapOutbox,
        and(
          eq(sapOutbox.sourceTable, 'TT_DELIVERY'),
          eq(sapOutbox.sourceId, deliveries.id),
          eq(sapOutbox.docType, 'DELIVERY'),
        ),
      )
      /*
       * Alias tersendiri: tabel lokasi dipakai DUA KALI dalam query ini —
       * sekali sebagai SLOC asal, sekali sebagai staging.
       *
       * Sebelumnya ditulis sebagai SQL mentah `TM_LOCATION AS staging`, dan itu
       * salah dua kali di Postgres: nama tabelnya tidak dikutip (sehingga dicari
       * sebagai `tm_location` huruf kecil) dan tidak disebut skemanya. Seluruh
       * layar rincian loading list gagal dengan "relation does not exist", dan
       * baru ketahuan saat pemeriksaan pengiriman dijalankan. alias() milik
       * Drizzle melakukan hal yang sama dengan benar — catatan lama yang
       * mengatakan Drizzle tidak bisa sudah tidak berlaku.
       */
      .leftJoin(lokasiStaging, eq(lokasiStaging.id, deliveries.stagingLocationId))
      .where(eq(deliveries.id, id))
      .limit(1);

    const doc = rows[0];
    if (!doc) throw new NotFoundException(`Loading list ${id} tidak ditemukan`);

    const lines = await this.db
      .select({
        id: deliveryLines.id,
        partId: deliveryLines.partId,
        partNumber: parts.partNumber,
        partName: parts.name,
        uom: parts.uom,
        customerPartNumber: sql<
          string | null
        >`COALESCE(${deliveryLines.customerPartNumberSource}, ${customerParts.customerPartNumber})`,
        sapItemNumber: deliveryLines.sapItemNumber,
        customerPartId: deliveryLines.customerPartId,
        sapDeliveryQty: deliveryLines.sapDeliveryQty,
        itemType: deliveryLines.itemType,
        plannedKanban: deliveryLines.plannedKanban,
        pickedKanban: deliveryLines.pickedKanban,
        actualKanban: deliveryLines.actualKanban,
        qtyPerKanban: deliveryLines.qtyPerKanban,
        plannedQty: deliveryLines.plannedQty,
        pickedQty: deliveryLines.pickedQty,
        actualQty: deliveryLines.actualQty,
      })
      .from(deliveryLines)
      .leftJoin(parts, eq(deliveryLines.partId, parts.id))
      .leftJoin(customerParts, eq(deliveryLines.customerPartId, customerParts.id))
      .where(eq(deliveryLines.deliveryId, id))
      .orderBy(deliveryLines.id);

    const { directKanban, plantScanDirectKanban, ...detail } = doc;
    return {
      ...detail,
      loadingMode: modeLoading({
        directKanban: directKanban ?? false,
        plantScanDirectKanban: plantScanDirectKanban ?? false,
      }),
      lines,
    };
  }

  async deliveryOrder(id: number) {
    const [row] = await this.db
      .select({ orderId: deliveries.deliveryOrderId, status: deliveries.status })
      .from(deliveries)
      .where(eq(deliveries.id, id));
    if (!row) throw new NotFoundException('Loading list tidak ditemukan');
    if (!row.orderId)
      return {
        data: null,
        reason:
          'Surat jalan terbit setelah Finish Pulling seluruh loading list untuk PDS customer ini.',
      };
    const [cancelled] = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.deliveryOrderId, row.orderId), eq(deliveries.status, 'CANCELLED')))
      .limit(1);
    if (cancelled)
      return {
        data: null,
        reason:
          'Ada loading list yang dibatalkan setelah surat jalan terbit. Periksa dokumen sebelum mencetak ulang.',
      };
    const flow = await readDeliveryFlow(this.db, row.orderId);
    if (!flow || !['READY', 'WAITING_GI_AII', 'SHIPPED'].includes(flow.stage))
      return {
        data: null,
        reason: 'Surat jalan menunggu konfirmasi GI AIIA dan GR AII dari SAP.',
        flow,
      };
    const [order] = await this.db
      .select({
        number: deliveryOrders.number,
        issuedAt: deliveryOrders.issuedAt,
        snapshot: deliveryOrders.snapshot,
      })
      .from(deliveryOrders)
      .where(eq(deliveryOrders.id, row.orderId));
    return { data: order ? { ...order, isSimulation: flow.isSimulation } : null, flow };
  }

  async intercompanyFlow(id: number) {
    const [doc] = await this.db
      .select({ orderId: deliveries.deliveryOrderId })
      .from(deliveries)
      .where(eq(deliveries.id, id));
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    return { data: doc.orderId ? await readDeliveryFlow(this.db, doc.orderId) : null };
  }

  scanDriver(code: string, orderId: number | undefined, principal?: Principal) {
    return scanDriverDocument(this.db, code, orderId, principal);
  }

  async driverStatus(id: number) {
    const data = await readDeliveryFlow(this.db, id);
    if (!data) throw new NotFoundException('Surat jalan tidak ditemukan');
    return { data };
  }

  /**
   * Lot yang masih bersisa untuk sebuah part, siap dibagi FIFO.
   *
   * `locationId` mempersempit ke satu SLOC. Saat berangkat yang boleh dibagi
   * hanyalah lot yang benar-benar ada di staging — lot yang masih tergeletak di
   * gudang belum ikut diambil, dan mengalokasikannya berarti mengirim barang
   * yang tidak ada di truk.
   */
  private async fifoLotsOf(partId: number, locationId?: number) {
    const rows = await this.db
      .select({
        lotId: lots.id,
        receivedAt: lots.receivedAt,
        createdAt: lots.createdAt,
        // Saldo lot SELALU jumlah mutasinya, tidak pernah initialQty —
        // menjumlahkan keduanya menghitung barang yang sama dua kali.
        moved: sql<string>`COALESCE(SUM(${mutations.qty}), 0)`,
      })
      .from(lots)
      .leftJoin(
        mutations,
        locationId
          ? and(eq(mutations.lotId, lots.id), eq(mutations.locationId, locationId))
          : eq(mutations.lotId, lots.id),
      )
      .where(and(eq(lots.partId, partId), eq(lots.status, 'OPEN')))
      .groupBy(lots.id, lots.receivedAt, lots.createdAt);

    return rows
      .map((r) => ({
        lotId: r.lotId,
        remainingQty: Number(r.moved),
        receivedAt: r.receivedAt ?? r.createdAt ?? null,
      }))
      .filter((l) => l.remainingQty > 0);
  }

  /**
   * Part apa saja yang stoknya tak cukup untuk muatan ini.
   *
   * `locationId` mempersempit perhitungan ke satu SLOC. Saat berangkat, yang
   * relevan adalah isi STAGING — saldo total boleh besar, tapi kalau barangnya
   * masih di gudang dan belum diambil, truk tetap tidak bisa dimuati.
   */
  private async shortagesOf(need: Array<{ partId: number; qty: number }>, locationId?: number) {
    if (need.length === 0) return [];
    const perPart = new Map<number, number>();
    for (const line of need) perPart.set(line.partId, (perPart.get(line.partId) ?? 0) + line.qty);
    need = Array.from(perPart, ([partId, qty]) => ({ partId, qty }));
    const partIds = need.map((n) => n.partId);

    const balances = await this.db
      .select({
        partId: mutations.partId,
        balance: sql<string>`COALESCE(SUM(${mutations.qty}), 0)`,
      })
      .from(mutations)
      .where(
        locationId
          ? and(inArray(mutations.partId, partIds), eq(mutations.locationId, locationId))
          : inArray(mutations.partId, partIds),
      )
      .groupBy(mutations.partId);
    const balanceOf = new Map(balances.map((b) => [b.partId, Number(b.balance)]));

    const partRows = await this.db.select().from(parts).where(inArray(parts.id, partIds));
    const partById = new Map(partRows.map((p) => [p.id, p]));

    return need
      .map((n) => {
        const available = balanceOf.get(n.partId) ?? 0;
        return {
          partId: n.partId,
          partNumber: partById.get(n.partId)?.partNumber ?? String(n.partId),
          needed: n.qty,
          available,
          short: n.qty - available,
        };
      })
      .filter((s) => s.short > 0);
  }

  private async totals(deliveryId: number) {
    const rows = await this.db
      .select({
        plannedKanban: sql<string>`COALESCE(SUM(${deliveryLines.plannedKanban}), 0)`,
        pickedKanban: sql<string>`COALESCE(SUM(${deliveryLines.pickedKanban}), 0)`,
        actualKanban: sql<string>`COALESCE(SUM(${deliveryLines.actualKanban}), 0)`,
      })
      .from(deliveryLines)
      .where(eq(deliveryLines.deliveryId, deliveryId));
    return {
      plannedKanban: Number(rows[0]?.plannedKanban ?? 0),
      pickedKanban: Number(rows[0]?.pickedKanban ?? 0),
      actualKanban: Number(rows[0]?.actualKanban ?? 0),
    };
  }
}
