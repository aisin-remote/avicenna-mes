import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, desc, count, inArray, type Database } from '@avicenna/db';
import {
  sapOutbox,
  deliveries,
  receipts,
  mutations,
  parts,
  locations,
  plants,
  lots,
  scanEvents,
  lines,
  users,
} from '@avicenna/db';
import { sapMovementFor, siapDikirim, slocKurang, bolehKirimDokumenRute } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';

/** Jeda sebelum sebuah dokumen dianggap lengkap. Lihat catatan di collect(). */
const SETTLE_SECONDS = 60;

/** Berapa dokumen dikumpulkan sekali jalan. */
const BATCH = 200;

interface BarisDokumen {
  mutationId: number;
  mutationType: string;
  partNumber: string | null;
  slocCode: string | null;
  qty: string;
  lotId: number | null;
  note: string | null;
}

/**
 * Mengumpulkan perpindahan barang menjadi dokumen untuk SAP.
 *
 * ── Kenapa mengumpulkan, bukan menulis saat kejadian ──────────────────────
 *
 * Alternatifnya adalah memanggil "catat ke outbox" di enam service yang
 * berbeda — penerimaan, transfer, pulling, pengiriman, scan produksi,
 * backflush. Enam tempat yang harus diingat, dan yang ketujuh pasti terlupa.
 *
 * Di sini sumbernya satu: buku besar mutasi. Dokumen yang belum punya baris
 * outbox dicari dengan NOT EXISTS, bukan dengan penanda posisi terakhir.
 * Penanda posisi punya lubang yang terkenal — transaksi yang commit belakangan
 * tetapi memperoleh id lebih kecil akan terlewat, dan tidak ada yang
 * memberitahu. NOT EXISTS ditambah unique index membuat pengumpulan ini
 * idempoten dan tidak bisa bocor.
 */
@Injectable()
export class SapOutboxService {
  private readonly logger = new Logger(SapOutboxService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async collect(): Promise<{ dikumpulkan: number; ditahan: number; dilewati: number }> {
    // Jeda memberi waktu transaksi scan selesai. Dokumen produksi juga
    // menunggu penanda backflushCompleted sebelum dibuat di bawah.
    const kandidat = await this.db.execute(sql`
      SELECT m.CHR_SOURCE_TABLE AS sourceTable,
             m.INT_SOURCE_ID  AS sourceId
      FROM ${mutations} m
      LEFT JOIN ${scanEvents} s
        ON m.CHR_SOURCE_TABLE = 'TT_HISTORY_SCAN' AND s.INT_ID = m.INT_SOURCE_ID
      WHERE m.CHR_SOURCE_TABLE IS NOT NULL
        AND m.INT_SOURCE_ID IS NOT NULL
        AND (
          m.CHR_SOURCE_TABLE <> 'TT_HISTORY_SCAN'
          OR m.CHR_TYPE NOT IN ('PRODUCTION_IN', 'CONSUMPTION_OUT')
          OR JSON_UNQUOTE(JSON_EXTRACT(s.CHR_META, '$.backflushCompleted')) = 'true'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${sapOutbox} o
          WHERE o.CHR_SOURCE_TABLE = m.CHR_SOURCE_TABLE
            AND o.INT_SOURCE_ID = m.INT_SOURCE_ID
            AND o.CHR_DOC_TYPE = CASE m.CHR_TYPE
              WHEN 'PRODUCTION_IN' THEN 'PRODUCTION'
              WHEN 'CONSUMPTION_OUT' THEN 'PRODUCTION'
              WHEN 'TRANSFER_OUT' THEN 'TRANSFER'
              WHEN 'TRANSFER_IN' THEN 'TRANSFER'
              WHEN 'RECEIVING_IN' THEN 'GOODS_RECEIPT'
              WHEN 'DELIVERY_OUT' THEN 'DELIVERY'
              WHEN 'NG_OUT' THEN 'SCRAP'
              WHEN 'ADJUSTMENT' THEN 'ADJUSTMENT'
              WHEN 'STOCK_TAKE' THEN 'ADJUSTMENT'
            END
        )
      GROUP BY m.CHR_SOURCE_TABLE, m.INT_SOURCE_ID
      HAVING MAX(m.DTM_CREATED_AT) < (NOW() - INTERVAL ${sql.raw(String(SETTLE_SECONDS))} SECOND)
      ORDER BY MIN(m.DTM_OCCURRED_AT)
      LIMIT ${sql.raw(String(BATCH))}
    `);

    const rows = (kandidat as unknown as Array<Array<Record<string, unknown>>>)[0] ?? [];
    let dikumpulkan = 0;
    let ditahan = 0;
    let dilewati = 0;

    for (const r of rows) {
      const hasil = await this.buildAndInsert(String(r.sourceTable), Number(r.sourceId));
      dikumpulkan += hasil.pending;
      ditahan += hasil.held;
      dilewati += hasil.skipped;
    }

    if (dikumpulkan + ditahan + dilewati > 0) {
      this.logger.log(
        `outbox: ${dikumpulkan} siap kirim, ${ditahan} ditahan, ${dilewati} dilewati`,
      );
    }
    return { dikumpulkan, ditahan, dilewati };
  }

  /**
   * Membangun dokumen SAP dari sebuah dokumen asal.
   *
   * Satu dokumen asal bisa menghasilkan BEBERAPA dokumen SAP. Satu loading
   * list memuat pulling (PP02 ke PP04, movement 311) dan pengiriman keluar
   * (PP04, movement 601) — dua perpindahan berbeda yang kebetulan dicatat pada
   * dokumen yang sama. Karena itu barisnya dikelompokkan per jenis dokumen
   * SAP, bukan ditumpuk jadi satu.
   */
  private async buildAndInsert(
    sourceTable: string,
    sourceId: number,
  ): Promise<{ pending: number; held: number; skipped: number }> {
    const hasil = { pending: 0, held: 0, skipped: 0 };

    const baris = await this.db
      .select({
        mutationId: mutations.id,
        mutationType: mutations.type,
        plantId: mutations.plantId,
        partNumber: parts.partNumber,
        uom: parts.uom,
        slocCode: locations.code,
        qty: mutations.qty,
        lotId: mutations.lotId,
        // Nomor lot, bukan id-nya: sisi SAP tidak mengenal id tabel kita.
        lotNumber: lots.lotNumber,
        note: mutations.note,
        occurredAt: mutations.occurredAt,
      })
      .from(mutations)
      .leftJoin(parts, eq(mutations.partId, parts.id))
      .leftJoin(locations, eq(mutations.locationId, locations.id))
      .leftJoin(lots, eq(mutations.lotId, lots.id))
      .where(and(eq(mutations.sourceTable, sourceTable), eq(mutations.sourceId, sourceId)))
      .orderBy(mutations.id);

    if (baris.length === 0) return hasil;

    const [delivery] =
      sourceTable === 'TT_DELIVERY'
        ? await this.db
            .select({ documentNumber: deliveries.documentNumber })
            .from(deliveries)
            .where(eq(deliveries.id, sourceId))
            .limit(1)
        : [];
    // Prefiks ini hanya dibuat seed/check lokal: seluruh mutasi fixture tetap trial.
    const isSimulation = delivery?.documentNumber.startsWith('LL-TRIAL-') ?? false;
    const [receiving] =
      sourceTable === 'TT_PURCHASE_RECEIPT_H'
        ? await this.db
            .select({ aresOrderId: receipts.aresOrderId, status: receipts.status })
            .from(receipts)
            .where(eq(receipts.id, sourceId))
            .limit(1)
        : [];
    const receivingHold = receiving?.aresOrderId
      ? 'pendorong untuk receiving belum disepakati: kontrak GR/PO/item perlu dikonfirmasi'
      : null;

    const [scan] =
      sourceTable === 'TT_HISTORY_SCAN'
        ? await this.db
            .select({
              meta: scanEvents.meta,
              lineCode: lines.code,
              backNumber: parts.backNumber,
              partName: parts.name,
              serialNumber: scanEvents.serialNumber,
              npk: users.npk,
            })
            .from(scanEvents)
            .leftJoin(lines, eq(scanEvents.lineId, lines.id))
            .leftJoin(parts, eq(scanEvents.partId, parts.id))
            .leftJoin(users, eq(scanEvents.userId, users.id))
            .where(eq(scanEvents.id, sourceId))
            .limit(1)
        : [];
    const metaScan = scan?.meta as {
      backflushCompleted?: boolean;
      sapRoute?: {
        productionEnabled?: boolean;
        transferEnabled?: boolean;
        transferMovementType?: string | null;
      };
    } | null;
    const kebijakan = metaScan?.sapRoute;

    // Kelompokkan per jenis dokumen SAP.
    const kelompok = new Map<string, typeof baris>();
    const takDikenal: string[] = [];
    for (const b of baris) {
      const docType = sapMovementFor(b.mutationType)?.docType;
      if (!docType) {
        takDikenal.push(b.mutationType);
        continue;
      }
      const daftar = kelompok.get(docType) ?? [];
      daftar.push(b);
      kelompok.set(docType, daftar);
    }

    if (takDikenal.length > 0) {
      this.logger.warn(
        `jenis mutasi belum dipetakan ke SAP: ${[...new Set(takDikenal)].join(', ')}`,
      );
    }

    for (const [docType, anggota] of kelompok) {
      const izin = bolehKirimDokumenRute(sourceTable, docType, kebijakan);
      const dikirim = anggota.filter((b) => sapMovementFor(b.mutationType)?.kirim);
      const jenis = anggota.map((b) => b.mutationType);

      const dasar = {
        plantId: anggota[0]!.plantId,
        sourceTable,
        sourceId,
        docType,
        isSimulation,
        // Jenis dokumen ikut ke dalam kunci: satu dokumen asal bisa punya dua.
        idempotencyKey: `${sourceTable}:${sourceId}:${docType}`,
        occurredAt: anggota[0]!.occurredAt,
      };

      if (!izin) {
        const baru = await this.simpan({
          ...dasar,
          movementType: null,
          status: 'SKIPPED',
          lastError: 'push staging SAP dimatikan untuk langkah rute ini',
          payload: { docType, lines: [] },
        });
        if (baru) hasil.skipped++;
        continue;
      }

      // Job backflush bisa tertunda lebih dari jeda kolektor. Produksi baru
      // boleh masuk outbox setelah konsumsi komponennya selesai atau BOM
      // dipastikan kosong. Transfer SLOC tetap boleh berjalan terpisah.
      if (
        docType === 'PRODUCTION' &&
        sourceTable === 'TT_HISTORY_SCAN' &&
        metaScan?.backflushCompleted !== true
      )
        continue;

      if (dikirim.length === 0) {
        const baru = await this.simpan({
          ...dasar,
          movementType: null,
          status: 'SKIPPED',
          lastError: 'tidak ada baris yang perlu dikirim ke SAP',
          payload: { docType, lines: [] },
        });
        if (baru) hasil.skipped++;
        continue;
      }

      const movementType =
        docType === 'TRANSFER' && sourceTable === 'TT_HISTORY_SCAN'
          ? (kebijakan?.transferMovementType ?? null)
          : (sapMovementFor(dikirim[0]!.mutationType)?.movementType ?? null);
      const pemeriksaan = siapDikirim(jenis);
      const siap =
        docType === 'TRANSFER' && sourceTable === 'TT_HISTORY_SCAN'
          ? Boolean(movementType)
          : pemeriksaan.siap;
      const belum = siap
        ? []
        : docType === 'TRANSFER' && sourceTable === 'TT_HISTORY_SCAN'
          ? ['TRANSFER (atur di rute)']
          : pemeriksaan.belum;

      /*
       * SLOC tujuan diambil dari baris pasangannya yang TIDAK ikut dikirim.
       *
       * Perpindahan antar SLOC ditulis sebagai dua mutasi, tetapi hanya sisi
       * keluarnya yang jadi dokumen SAP (movement 311 memuat kedua sisi
       * sekaligus). Akibatnya baris yang dikirim hanya tahu SLOC asalnya —
       * padahal staging butuh keduanya. Tujuannya ada di baris TRANSFER_IN
       * yang sengaja dilewati, jadi diambil dari sana, dicocokkan per part.
       */
      const tujuanPerPart = new Map<string, string>();
      for (const b of anggota) {
        const arah = sapMovementFor(b.mutationType);
        if (arah && !arah.kirim && Number(b.qty) > 0 && b.partNumber && b.slocCode) {
          tujuanPerPart.set(b.partNumber, b.slocCode);
        }
      }

      const barisKirim = dikirim.map((b) => {
        const keluar = Number(b.qty) < 0;
        return {
          mutationId: b.mutationId,
          mutationType: b.mutationType,
          movementType:
            docType === 'TRANSFER' && sourceTable === 'TT_HISTORY_SCAN'
              ? movementType
              : (sapMovementFor(b.mutationType)?.movementType ?? null),
          partNumber: b.partNumber,
          uom: b.uom ?? null,

          /** SLOC apa adanya dari mutasi — dipertahankan untuk penelusuran. */
          sloc: b.slocCode,

          /*
           * Asal dan tujuan yang sudah diurai. Baris keluar berasal dari
           * SLOC-nya sendiri; tujuannya diambil dari pasangan masuknya.
           * Baris masuk (penerimaan, produksi) tidak punya asal.
           */
          slocFrom: keluar ? b.slocCode : null,
          slocTo: keluar ? (tujuanPerPart.get(b.partNumber ?? '') ?? null) : b.slocCode,

          /** Bertanda, sesuai buku besar kita. */
          qty: b.qty,

          /*
           * Tanpa tanda, untuk sisi SAP. Di SAP arah perpindahan dibawa
           * oleh movement type, bukan oleh tanda angkanya — mengirim -12
           * dengan movement 601 berarti pengiriman keluar sebesar minus
           * dua belas, dan itu ditolak atau dibalik arahnya.
           */
          qtyAbsolute: Math.abs(Number(b.qty)),

          lotId: b.lotId,
          lotNumber: b.lotNumber ?? null,
          note: b.note,
        };
      });

      /*
       * SLOC yang tidak lengkap MENAHAN dokumen, bukan dikirim dengan kolom
       * kosong. SAP tidak bisa memposting 311 tanpa tujuan, dan baris yang
       * lolos dengan SLOC kosong akan ditolak di sisi sana — atau lebih buruk,
       * diterima lalu masuk ke lokasi bawaan yang keliru.
       */
      const kurangSloc = slocKurang(
        docType as never,
        barisKirim.map((b) => ({
          mutationType: b.mutationType,
          qty: Number(b.qty),
          slocFrom: b.slocFrom,
          slocTo: b.slocTo,
          partNumber: b.partNumber,
        })),
      );

      const kurangKonteks =
        docType === 'PRODUCTION' && sourceTable === 'TT_HISTORY_SCAN' && !scan?.lineCode;
      let menungguProduksi: string | null = null;
      if (docType === 'TRANSFER' && sourceTable === 'TT_HISTORY_SCAN') {
        if (!kebijakan?.productionEnabled) {
          menungguProduksi = 'push hasil produksi tidak aktif untuk rute ini';
        } else {
          const [produksi] = await this.db
            .select({ status: sapOutbox.status })
            .from(sapOutbox)
            .where(
              and(
                eq(sapOutbox.sourceTable, sourceTable),
                eq(sapOutbox.sourceId, sourceId),
                eq(sapOutbox.docType, 'PRODUCTION'),
              ),
            )
            .limit(1);
          if (produksi?.status !== 'CONFIRMED') {
            menungguProduksi = 'menunggu hasil produksi dikonfirmasi SAP';
          }
        }
      }
      const lengkap =
        siap && kurangSloc.length === 0 && !kurangKonteks && !menungguProduksi && !receivingHold;
      const alasanTahan = [
        receivingHold,
        siap ? null : `movement type belum diputuskan untuk: ${belum.join(', ')}`,
        kurangSloc.length > 0 ? kurangSloc.join('; ') : null,
        kurangKonteks ? 'work center dari line scan kosong' : null,
        menungguProduksi,
      ]
        .filter(Boolean)
        .join(' | ');

      const baru = await this.simpan({
        ...dasar,
        movementType,
        // Dokumen yang movement type-nya belum diputuskan DITAHAN, bukan
        // dibuang dan bukan pula dikirim dengan tebakan. Begitu angkanya turun
        // dari tim SAP, statusnya tinggal dikembalikan ke PENDING.
        status:
          receiving?.aresOrderId && receiving.status === 'CANCELLED'
            ? 'SKIPPED'
            : lengkap
              ? 'PENDING'
              : 'HELD',
        lastError:
          receiving?.aresOrderId && receiving.status === 'CANCELLED'
            ? 'Receiving dibatalkan'
            : lengkap
              ? null
              : alasanTahan,
        payload: {
          docType,
          movementType,
          plantId: dasar.plantId,
          sourceTable,
          sourceId,
          occurredAt: dasar.occurredAt,
          lineCode: scan?.lineCode ?? null,
          backNumber: scan?.backNumber ?? null,
          partName: scan?.partName ?? null,
          serialNumber: scan?.serialNumber ?? null,
          npk: scan?.npk ?? null,
          lines: barisKirim,
        },
      });

      if (!baru) continue;
      if (receiving?.aresOrderId && receiving.status === 'CANCELLED') hasil.skipped++;
      else if (lengkap) hasil.pending++;
      else hasil.held++;
    }

    return hasil;
  }

  /**
   * Menyimpan satu dokumen. Mengembalikan false bila dokumennya SUDAH ADA.
   *
   * Pembedaan ini bukan kerapian belaka: tanpa itu penghitung melaporkan
   * jumlah yang DICOBA, bukan yang benar-benar baru, dan layar pemantauan akan
   * mengatakan "7 dokumen siap kirim" setiap menit selamanya — seolah antrean
   * terus bertambah padahal tidak ada yang berubah.
   */
  private async simpan(v: {
    plantId: number;
    sourceTable: string;
    sourceId: number;
    docType: string;
    isSimulation: boolean;
    movementType: string | null;
    idempotencyKey: string;
    status: 'PENDING' | 'HELD' | 'SKIPPED';
    lastError: string | null;
    payload: unknown;
    occurredAt: Date;
  }): Promise<boolean> {
    try {
      await this.db.insert(sapOutbox).values(v);
      return true;
    } catch (err) {
      // Unique index yang menolak berarti dokumen ini sudah dikumpulkan —
      // entah pada putaran sebelumnya, entah oleh pengumpul lain yang berjalan
      // bersamaan. Itu justru yang diinginkan.
      const e = err as { errno?: number; cause?: { errno?: number } };
      if ((e?.errno ?? e?.cause?.errno) !== 1062) throw err;
      return false;
    }
  }

  /** Melepas dokumen yang tertahan, setelah movement type-nya diputuskan. */
  async releaseHeld(): Promise<{ dilepas: number }> {
    const tertahan = await this.db.select().from(sapOutbox).where(eq(sapOutbox.status, 'HELD'));

    let dilepas = 0;
    for (const row of tertahan) {
      if (row.lastError?.startsWith('pendorong untuk ')) continue;
      const payload = row.payload as {
        lines?: Array<{
          mutationType: string;
          qty: string | number;
          slocFrom: string | null;
          slocTo: string | null;
          partNumber: string | null;
        }>;
      };
      const lines = payload.lines ?? [];
      if (row.docType === 'TRANSFER' && row.sourceTable === 'TT_HISTORY_SCAN' && !row.movementType)
        continue;
      if (row.docType === 'TRANSFER' && row.sourceTable === 'TT_HISTORY_SCAN') {
        const [produksi] = await this.db
          .select({ status: sapOutbox.status })
          .from(sapOutbox)
          .where(
            and(
              eq(sapOutbox.sourceTable, row.sourceTable),
              eq(sapOutbox.sourceId, row.sourceId),
              eq(sapOutbox.docType, 'PRODUCTION'),
            ),
          )
          .limit(1);
        if (produksi?.status !== 'CONFIRMED') continue;
      }
      if (row.docType === 'PRODUCTION' && !('lineCode' in payload && payload.lineCode)) continue;
      const jenis = lines.map((l) => l.mutationType);

      const { siap } = siapDikirim(jenis);
      if (!siap && !(row.docType === 'TRANSFER' && row.movementType)) continue;

      /*
       * Dokumen bisa tertahan karena DUA sebab: movement type belum diputuskan,
       * atau SLOC-nya tidak lengkap. Memeriksa yang pertama saja berarti
       * dokumen ber-SLOC kosong ikut terlepas begitu angka movement type turun,
       * lalu ditolak SAP — dan sebab aslinya sudah terhapus dari LAST_ERROR.
       */
      const kurang = slocKurang(
        row.docType as never,
        lines.map((l) => ({
          mutationType: l.mutationType,
          qty: Number(l.qty),
          slocFrom: l.slocFrom ?? null,
          slocTo: l.slocTo ?? null,
          partNumber: l.partNumber,
        })),
      );
      if (kurang.length > 0) continue;

      const movementType =
        row.docType === 'TRANSFER'
          ? (row.movementType ?? sapMovementFor('TRANSFER_OUT')?.movementType ?? null)
          : (sapMovementFor(jenis[0] ?? '')?.movementType ?? null);
      await this.db
        .update(sapOutbox)
        .set({ status: 'PENDING', movementType, lastError: null })
        .where(eq(sapOutbox.id, row.id));
      dilepas++;
    }
    if (dilepas > 0) this.logger.log(`${dilepas} dokumen tertahan dilepas ke antrean kirim`);
    return { dilepas };
  }

  /** Ringkasan per status, untuk layar pemantauan. */
  async summary() {
    const rows = await this.db
      .select({ status: sapOutbox.status, jumlah: count() })
      .from(sapOutbox)
      .groupBy(sapOutbox.status);
    const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.jumlah)]));
    return {
      pending: map.PENDING ?? 0,
      // SENT = sudah di staging, MENUNGGU diproses SAP. Bukan status akhir.
      sent: map.SENT ?? 0,
      confirmed: map.CONFIRMED ?? 0,
      rejected: map.REJECTED ?? 0,
      failed: map.FAILED ?? 0,
      held: map.HELD ?? 0,
      skipped: map.SKIPPED ?? 0,
    };
  }

  async list(params: { page: number; perPage: number; status?: string }) {
    const offset = (params.page - 1) * params.perPage;
    const filter =
      params.status && params.status !== 'ALL'
        ? eq(sapOutbox.status, params.status as 'PENDING')
        : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: sapOutbox.id,
          plantCode: plants.code,
          docType: sapOutbox.docType,
          movementType: sapOutbox.movementType,
          sourceTable: sapOutbox.sourceTable,
          sourceId: sapOutbox.sourceId,
          status: sapOutbox.status,
          isSimulation: sapOutbox.isSimulation,
          attempts: sapOutbox.attempts,
          lastError: sapOutbox.lastError,
          sapDocNumber: sapOutbox.sapDocNumber,
          occurredAt: sapOutbox.occurredAt,
          sentAt: sapOutbox.sentAt,
          confirmedAt: sapOutbox.confirmedAt,
        })
        .from(sapOutbox)
        .leftJoin(plants, eq(sapOutbox.plantId, plants.id))
        .where(filter)
        .orderBy(desc(sapOutbox.occurredAt), desc(sapOutbox.id))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(sapOutbox).where(filter),
    ]);

    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows,
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  /** Mencoba ulang dokumen yang gagal kirim. */
  async retry(ids: number[]): Promise<{ diulang: number }> {
    if (ids.length === 0) return { diulang: 0 };
    await this.db
      .update(sapOutbox)
      .set({ status: 'PENDING', lastError: null })
      .where(
        and(
          inArray(sapOutbox.id, ids),
          eq(sapOutbox.isSimulation, false),
          eq(sapOutbox.status, 'FAILED'),
        ),
      );
    return { diulang: ids.length };
  }

  /** Menutup satu Good Issue secara manual hanya untuk trial tanpa koneksi SAP. */
  async simulateDelivery(
    id: number,
    outcome: 'CONFIRMED' | 'REJECTED' | 'PENDING',
  ): Promise<{ id: number; status: string; sapDocNumber: string | null }> {
    const [row] = await this.db
      .select({
        id: sapOutbox.id,
        docType: sapOutbox.docType,
        status: sapOutbox.status,
        isSimulation: sapOutbox.isSimulation,
      })
      .from(sapOutbox)
      .where(eq(sapOutbox.id, id))
      .limit(1);
    if (!row || row.docType !== 'DELIVERY') {
      throw new BadRequestException('Good Issue delivery tidak ditemukan');
    }
    if (outcome === 'PENDING' ? !row.isSimulation : row.status !== 'PENDING') {
      throw new BadRequestException(`Status ${row.status} tidak bisa disimulasikan`);
    }

    const confirmed = outcome === 'CONFIRMED';
    const sapDocNumber = confirmed ? `SIM-${String(id).padStart(8, '0')}` : null;
    await this.db
      .update(sapOutbox)
      .set({
        status: outcome,
        isSimulation: true,
        sapDocNumber,
        confirmedAt: confirmed ? new Date() : null,
        lastError: outcome === 'REJECTED' ? 'Simulasi: Good Issue ditolak SAP' : null,
      })
      .where(and(eq(sapOutbox.id, id), eq(sapOutbox.status, row.status)));
    return { id, status: outcome, sapDocNumber };
  }
}
