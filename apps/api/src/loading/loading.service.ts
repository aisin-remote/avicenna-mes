import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, and, or, desc, count, inArray, like, sql, type Database } from '@avicenna/db';
import {
  deliveries,
  deliveryLines,
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
} from '@avicenna/db';
import {
  convertCustomerPartNumber,
  allocateFifo,
  modeLoading,
  perluKanbanInternal,
  adaScanPerBox,
  MODE_LOADING_INSTRUKSI,
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
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

/** Pelanggaran unique index MySQL, dipakai mengenali retry scan idempoten. */
const MYSQL_DUP_ENTRY = 1062;

@Injectable()
export class LoadingService {
  private readonly logger = new Logger(LoadingService.name);

  constructor(@InjectDb() private readonly db: Database) {}

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
      .where(or(eq(deliveries.documentNumber, code), eq(deliveries.manifestNumber, code)))
      .orderBy(desc(deliveries.deliveryDate), desc(deliveries.id))
      .limit(100);

    if (matches.length === 0) {
      throw new NotFoundException(`Manifest atau loading list "${code}" tidak ditemukan`);
    }
    return { code, matches };
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
    if (phase === 'LOADING' && (doc.status === 'DRAFT' || doc.status === 'PICKING')) {
      throw new BadRequestException(
        'Barangnya belum selesai diambil dari gudang. Selesaikan pulling lebih dulu.',
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

    if (phase === 'LOADING') {
      if (!adaScanPerBox(mode)) {
        throw new BadRequestException(
          `Customer ini tidak memakai scan per box saat muat. ${MODE_LOADING_INSTRUKSI[mode]}`,
        );
      }
      if (perluKanbanInternal(mode) && !input.internalKanban) {
        throw new BadRequestException(
          `Kanban internal belum discan. ${MODE_LOADING_INSTRUKSI[mode]}`,
        );
      }
      if (!perluKanbanInternal(mode) && input.internalKanban) {
        throw new BadRequestException(
          'Customer ini tidak memakai kanban internal. Cukup scan kanban customer.',
        );
      }
    }

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
        pickedKanban: deliveryLines.pickedKanban,
        actualKanban: deliveryLines.actualKanban,
        qtyPerKanban: deliveryLines.qtyPerKanban,
        customerPartNumber: customerParts.customerPartNumber,
      })
      .from(deliveryLines)
      .leftJoin(parts, eq(deliveryLines.partId, parts.id))
      .leftJoin(customerParts, eq(deliveryLines.customerPartId, customerParts.id))
      .where(eq(deliveryLines.deliveryId, input.deliveryId));

    // Cocokkan lewat penomoran customer dulu, lalu part internal — sebagian
    // barcode hanya memuat salah satunya.
    const match =
      candidates.find((c) => c.customerPartNumber === converted) ??
      candidates.find((c) => c.partNumber === converted) ??
      candidates.find((c) => c.customerPartNumber === customerPart) ??
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
      candidates.find((c) => c.partNumber === customerPart) ??
      (input.internalPart
        ? candidates.find((c) => c.partNumber === input.internalPart)
        : undefined);

    if (!match) {
      return {
        status: 'REJECTED',
        phase,
        message: `Part "${converted}" tidak ada dalam loading list ini. Periksa barcode atau dokumennya.`,
        lineId: null,
        partNumber: null,
        convertedPartNumber: converted,
        actualKanban: 0,
        plannedKanban: 0,
        totals: await this.totals(input.deliveryId),
      };
    }

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
    if (phase === 'LOADING' && perluKanbanInternal(mode) && input.internalKanban) {
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
          );
        }
        throw err;
      }
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
        );
      }

      if (!kartu) {
        return this.tolakScan(
          input.deliveryId,
          phase,
          converted,
          `Kanban internal ini milik part lain, bukan ${match.partNumber}. Periksa boxnya.`,
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
        );
      }
    }

    /*
     * Tiap tahap menghitung kolomnya sendiri dan punya sasaran sendiri.
     *
     * Saat pulling, sasarannya adalah RENCANA. Saat memuat, sasarannya adalah
     * yang BENAR-BENAR terambil — memuat lebih banyak daripada yang ada di
     * staging tidak mungkin benar, berapa pun rencananya.
     */
    const kolom = phase === 'PULLING' ? deliveryLines.pickedKanban : deliveryLines.actualKanban;
    const kolomQty = phase === 'PULLING' ? deliveryLines.pickedQty : deliveryLines.actualQty;
    const sasaran = phase === 'PULLING' ? match.plannedKanban : match.pickedKanban;

    let duplicate = false;
    const nextActual = await this.db
      .transaction(async (tx) => {
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
         * Urutan SET penting: MySQL menilai ekspresi dari kiri ke kanan, jadi
         * actual_qty harus dihitung SEBELUM actual_kanban bertambah.
         */
        await tx.execute(sql`
          UPDATE ${deliveryLines}
          SET ${kolomQty} = (${kolom} + 1) * ${deliveryLines.qtyPerKanban},
              ${kolom} = ${kolom} + 1
          WHERE ${deliveryLines.id} = ${match.lineId}
        `);

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
          serialNumber: customerSerial || null,
          qty: match.qtyPerKanban,
          userId: principal?.kind === 'user' ? principal.sub : null,
          scannedAt: new Date(),
          // clientRef mencegah kiriman ulang jaringan terhitung dua kali.
          // Nomor kartu tidak dipakai sebagai kunci: setelah undo, kartu yang
          // sama memang harus boleh discan ulang dan riwayat lama tetap disimpan.
          dedupeKey: input.clientRef
            ? `load:${input.deliveryId}:${phase}:${input.clientRef}`
            : `load:${input.deliveryId}:${phase}:${match.lineId}:${randomUUID()}`,
          meta: {
            deliveryId: input.deliveryId,
            deliveryLineId: match.lineId,
            phase,
            converted,
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
        if (phase === 'LOADING' && doc.status === 'PICKED') {
          await tx
            .update(deliveries)
            .set({ status: 'LOADING', truckStatus: 'LOADING' })
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
        if ((e?.errno ?? e?.cause?.errno) !== MYSQL_DUP_ENTRY) throw err;

        duplicate = true;
        const rows = await this.db
          .select({ value: kolom })
          .from(deliveryLines)
          .where(eq(deliveryLines.id, match.lineId))
          .limit(1);
        return rows[0]?.value ?? (phase === 'PULLING' ? match.pickedKanban : match.actualKanban);
      });

    const over = nextActual > sasaran;
    const lebihDari = phase === 'PULLING' ? 'rencana' : 'yang diambil dari gudang';

    return {
      status: over ? 'OVER' : 'ACCEPTED',
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
  ): Promise<LoadingScanResult> {
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

  async undoScan(deliveryId: number, lineId: number, phase: LoadingPhase = 'LOADING') {
    const rows = await this.db
      .select()
      .from(deliveryLines)
      .where(and(eq(deliveryLines.id, lineId), eq(deliveryLines.deliveryId, deliveryId)))
      .limit(1);
    const line = rows[0];
    if (!line) throw new NotFoundException('Baris loading list tidak ditemukan');

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
    await this.db
      .update(deliveryLines)
      .set(
        phase === 'PULLING'
          ? { pickedKanban: next, pickedQty: next * line.qtyPerKanban }
          : { actualKanban: next, actualQty: next * line.qtyPerKanban },
      )
      .where(eq(deliveryLines.id, lineId));

    // Jejak scan-nya TIDAK dihapus; yang batal ikut jadi bagian riwayat.
    return { lineId, actualKanban: next, totals: await this.totals(deliveryId) };
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
    if (doc.status !== 'DRAFT' && doc.status !== 'PICKING') {
      throw new BadRequestException('Pulling untuk dokumen ini sudah ditutup');
    }
    if (!doc.locationId || !doc.stagingLocationId) {
      throw new BadRequestException(
        'Dokumen ini belum menentukan SLOC asal dan staging. Lengkapi dulu sebelum menutup pulling.',
      );
    }

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

      this.logger.log(`pulling ${doc.documentNumber} selesai: ${diambil.length} baris`);
      return {
        id,
        documentNumber: doc.documentNumber,
        pickedLines: diambil.length,
        shortages,
      };
    });
  }

  /**
   * Menutup loading list: barang dinyatakan berangkat dan stok berkurang.
   *
   * Mutasi DELIVERY_OUT dibuat dari jumlah AKTUAL, bukan rencana — yang keluar
   * gudang adalah yang benar-benar dimuat.
   */
  async ship(id: number, principal?: Principal) {
    const docRows = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    const doc = docRows[0];
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    if (doc.status === 'SHIPPED' || doc.status === 'RECEIVED') {
      throw new BadRequestException('Loading list ini sudah dinyatakan berangkat');
    }
    if (doc.status === 'CANCELLED') {
      throw new BadRequestException('Loading list ini sudah dibatalkan');
    }
    if (doc.status === 'DRAFT' || doc.status === 'PICKING') {
      throw new BadRequestException(
        'Barangnya belum selesai diambil dari gudang. Tutup pulling lebih dulu.',
      );
    }

    const lines = await this.db
      .select()
      .from(deliveryLines)
      .where(eq(deliveryLines.deliveryId, id));
    const loaded = lines.filter((l) => l.actualKanban > 0);
    if (loaded.length === 0) {
      throw new BadRequestException(
        'Belum ada kanban yang discan. Muat barangnya dulu sebelum menutup dokumen.',
      );
    }

    // Stok kurang dilaporkan, bukan dihalangi. Truk sudah berisi; menolak
    // mencatatnya justru membuat selisihnya hilang dari pandangan.
    const shortages = await this.shortagesOf(
      loaded.map((l) => ({ partId: l.partId, qty: l.actualQty })),
      doc.stagingLocationId ?? undefined,
    );

    // Part yang dilacak per lot harus dibagi ke lot tertentu. Mutasi keluar
    // tanpa lotId membuat saldo lot tidak pernah berkurang — total part benar,
    // tapi tiap lot terlihat masih penuh selamanya, dan alokasi FIFO
    // berikutnya jadi salah.
    const lotTracked = new Map<number, Awaited<ReturnType<typeof this.fifoLotsOf>>>();
    const partRows = await this.db
      .select()
      .from(parts)
      .where(
        inArray(
          parts.id,
          loaded.map((l) => l.partId),
        ),
      );
    for (const p of partRows) {
      if (p.trackingMode === 'LOT') {
        lotTracked.set(p.id, await this.fifoLotsOf(p.id, doc.stagingLocationId ?? undefined));
      }
    }

    const now = new Date();

    return this.db.transaction(async (tx) => {
      for (const line of loaded) {
        const note = `Kirim ${line.actualKanban} kanban lewat ${doc.documentNumber}`;
        const base = {
          plantId: doc.plantId,
          partId: line.partId,
          /*
           * Dipotong dari STAGING, bukan dari gudang finish good.
           *
           * Barangnya sudah berpindah ke sana saat pulling. Memotong lagi dari
           * PP02 akan menghitung satu barang dua kali: PP02 minus dua kali,
           * PP04 tidak pernah kosong.
           */
          locationId: doc.stagingLocationId ?? doc.locationId ?? null,
          type: 'DELIVERY_OUT' as const,
          sourceTable: 'TT_DELIVERY',
          sourceId: id,
          note,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          occurredAt: now,
        };

        const available = lotTracked.get(line.partId);
        if (!available) {
          await tx.insert(mutations).values({ ...base, qty: String(-line.actualQty) });
          continue;
        }

        const { allocations, unallocated } = allocateFifo(line.actualQty, available);
        for (const a of allocations) {
          await tx.insert(mutations).values({ ...base, lotId: a.lotId, qty: String(-a.qty) });
        }
        // Sisa yang tak tertampung lot mana pun tetap dicatat, tanpa lot.
        // Menghilangkannya akan membuat total stok tidak cocok dengan isi truk.
        if (unallocated > 0) {
          await tx.insert(mutations).values({
            ...base,
            qty: String(-unallocated),
            note: `${note} (tanpa lot — stok lot tidak mencukupi)`,
          });
        }
      }

      await tx
        .update(deliveries)
        .set({ status: 'SHIPPED', truckStatus: 'DEPARTED', departedAt: now })
        .where(eq(deliveries.id, id));

      this.logger.log(`loading list ${doc.documentNumber} berangkat: ${loaded.length} baris`);
      return {
        id,
        documentNumber: doc.documentNumber,
        shippedLines: loaded.length,
        shortages,
      };
    });
  }

  /** Mencatat kedatangan truk — status truk terpisah dari status dokumen. */
  async setTruckStatus(
    id: number,
    truckStatus: 'PENDING' | 'ARRIVED' | 'LOADING' | 'DEPARTED',
    principal?: Principal,
  ) {
    const rows = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    if (!rows[0]) throw new NotFoundException('Loading list tidak ditemukan');

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
          customerName: customers.name,
          deliveryDate: deliveries.deliveryDate,
          cycle: deliveries.cycle,
          status: deliveries.status,
          truckStatus: deliveries.truckStatus,
          plannedKanban: sql<string>`COALESCE(SUM(${deliveryLines.plannedKanban}), 0)`,
          pickedKanban: sql<string>`COALESCE(SUM(${deliveryLines.pickedKanban}), 0)`,
          actualKanban: sql<string>`COALESCE(SUM(${deliveryLines.actualKanban}), 0)`,
          sapStatus: sapOutbox.status,
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
          customers.name,
          deliveries.deliveryDate,
          deliveries.cycle,
          deliveries.status,
          deliveries.truckStatus,
          sapOutbox.status,
          sapOutbox.sapDocNumber,
          sapOutbox.lastError,
        )
        .orderBy(desc(deliveries.deliveryDate), desc(deliveries.id));

    type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];
    const normalize = (row: SummaryRow): LoadingSummary => {
      const summary = {
        ...row,
        plannedKanban: Number(row.plannedKanban),
        pickedKanban: Number(row.pickedKanban),
        actualKanban: Number(row.actualKanban),
      };
      return { ...summary, attentionReason: deliveryAttentionReason(summary) };
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

  async findOne(id: number) {
    const rows = await this.db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        manifestNumber: deliveries.manifestNumber,
        pdsNumber: deliveries.pdsNumber,
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
        locationId: deliveries.locationId,
        locationName: locations.name,
        locationCode: locations.code,
        stagingLocationId: deliveries.stagingLocationId,
        stagingLocationName: sql<string | null>`staging.CHR_NAME`,
        stagingLocationCode: sql<string | null>`staging.CHR_CODE`,
        status: deliveries.status,
        truckStatus: deliveries.truckStatus,
        truckNumber: deliveries.truckNumber,
        driverName: deliveries.driverName,
        departedAt: deliveries.departedAt,
        sapStatus: sapOutbox.status,
        sapDocNumber: sapOutbox.sapDocNumber,
        sapError: sapOutbox.lastError,
      })
      .from(deliveries)
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
      // Alias tersendiri: tabel lokasi dipakai dua kali dalam query yang sama.
      // Nama tabelnya ditulis langsung di sini — satu-satunya tempat begitu —
      // karena Drizzle belum bisa menjadikan tabel yang sama dua alias berbeda.
      .leftJoin(sql`TM_LOCATION AS staging`, sql`staging.INT_ID = ${deliveries.stagingLocationId}`)
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
        customerPartNumber: customerParts.customerPartNumber,
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
