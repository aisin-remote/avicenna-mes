import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, and, desc, count, inArray, sql, type Database } from '@avicenna/db';
import {
  deliveries,
  deliveryLines,
  customers,
  customerParts,
  parts,
  plants,
  locations,
  lots,
  mutations,
  scanEvents,
} from '@avicenna/db';
import {
  convertCustomerPartNumber,
  buildDocumentNumber,
  allocateFifo,
  type PartNumberFormat,
} from '@avicenna/domain';
import type {
  LoadingCreateInput,
  LoadingPhase,
  LoadingScanInput,
  LoadingScanResult,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

/** Pelanggaran unique index MySQL. */
const MYSQL_DUP_ENTRY = 1062;

@Injectable()
export class LoadingService {
  private readonly logger = new Logger(LoadingService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Membuat dokumen loading list beserta rencana muatnya.
   *
   * Di bella dokumen ini datang dari J922 lewat URL; di sini dibuat sendiri,
   * jadi nomornya dihasilkan sistem dan nomor PDS customer hanya jadi rujukan.
   */
  async create(input: LoadingCreateInput, principal?: Principal) {
    const customerRows = await this.db
      .select()
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    const customer = customerRows[0];
    if (!customer) throw new BadRequestException('Customer tidak ditemukan');

    const plantRows = await this.db
      .select()
      .from(plants)
      .where(eq(plants.id, input.plantId))
      .limit(1);
    if (!plantRows[0]) throw new BadRequestException('Pabrik tidak ditemukan');

    // Kedua SLOC diperiksa dengan aturan yang sama: milik pabrik yang benar,
    // dan bukan lokasi yang sama — memindahkan barang ke tempatnya sendiri
    // menghasilkan dua mutasi yang saling meniadakan dan tidak berarti apa-apa.
    for (const [id, label] of [
      [input.locationId, 'SLOC asal'],
      [input.stagingLocationId, 'SLOC staging'],
    ] as const) {
      if (!id) continue;
      const locRows = await this.db.select().from(locations).where(eq(locations.id, id)).limit(1);
      const loc = locRows[0];
      if (!loc) throw new BadRequestException(`${label} tidak ditemukan`);
      if (loc.plantId !== input.plantId) {
        throw new BadRequestException(
          `${label} ${loc.code} milik pabrik lain. Pilih lokasi di pabrik yang sama.`,
        );
      }
    }
    if (input.locationId && input.locationId === input.stagingLocationId) {
      throw new BadRequestException('SLOC asal dan staging tidak boleh sama.');
    }

    const partIds = [...new Set(input.lines.map((l) => l.partId))];
    if (partIds.length !== input.lines.length) {
      throw new BadRequestException(
        'Ada part yang dimasukkan dua kali. Gabungkan jadi satu baris.',
      );
    }

    const partRows = await this.db.select().from(parts).where(inArray(parts.id, partIds));
    const partById = new Map(partRows.map((p) => [p.id, p]));
    for (const line of input.lines) {
      const part = partById.get(line.partId);
      if (!part) throw new BadRequestException(`Part dengan id ${line.partId} tidak ditemukan`);
      if (part.plantId !== input.plantId) {
        throw new BadRequestException(
          `Part ${part.partNumber} terdaftar di pabrik lain. Pilih pabrik yang sesuai.`,
        );
      }
    }

    // Penomoran customer yang dipilih harus benar-benar milik customer dan
    // part di baris itu — kalau tidak, barcode nanti dicocokkan ke baris yang salah.
    const customerPartIds = input.lines
      .map((l) => l.customerPartId)
      .filter((v): v is number => typeof v === 'number');
    if (customerPartIds.length > 0) {
      const cpRows = await this.db
        .select()
        .from(customerParts)
        .where(inArray(customerParts.id, customerPartIds));
      const cpById = new Map(cpRows.map((c) => [c.id, c]));
      for (const line of input.lines) {
        if (!line.customerPartId) continue;
        const cp = cpById.get(line.customerPartId);
        if (!cp) throw new BadRequestException('Penomoran customer tidak ditemukan');
        if (cp.customerId !== input.customerId || cp.partId !== line.partId) {
          throw new BadRequestException(
            `Penomoran customer "${cp.customerPartNumber}" bukan milik part di baris ini.`,
          );
        }
      }
    }

    const at = new Date(`${input.deliveryDate}T00:00:00`);

    /*
     * Nomor urut dihitung dari jumlah dokumen pabrik itu pada tanggal yang
     * sama, jadi dua orang yang menyimpan pada saat bersamaan bisa memperoleh
     * angka yang sama dan yang kedua ditolak unique index. Itu bukan kesalahan
     * pengguna dan tidak perlu sampai ke layar: cukup ambil nomor berikutnya
     * lalu coba lagi. Dibatasi beberapa kali supaya kegagalan lain tidak
     * berubah menjadi perulangan tanpa akhir.
     */
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.insertDocument(input, at, partById, principal);
      } catch (err) {
        const e = err as { errno?: number; cause?: { errno?: number } };
        const dup = (e?.errno ?? e?.cause?.errno) === MYSQL_DUP_ENTRY;
        if (!dup || attempt >= 4) throw err;
      }
    }
  }

  private async insertDocument(
    input: LoadingCreateInput,
    at: Date,
    partById: Map<number, typeof parts.$inferSelect>,
    principal: Principal | undefined,
  ) {
    // Dihitung ulang tiap percobaan: kalau nomor tadi bentrok, berarti ada
    // dokumen baru yang masuk dan hitungannya memang sudah berubah.
    const seqBase = await this.countOn(input.plantId, input.deliveryDate);

    return this.db.transaction(async (tx) => {
      const documentNumber = buildDocumentNumber('LL', at, seqBase + 1);

      const inserted = await tx.insert(deliveries).values({
        plantId: input.plantId,
        customerId: input.customerId,
        documentNumber,
        pdsNumber: input.pdsNumber || null,
        deliveryDate: input.deliveryDate,
        cycle: input.cycle,
        dock: input.dock || null,
        locationId: input.locationId ?? null,
        stagingLocationId: input.stagingLocationId ?? null,
        status: 'DRAFT',
        truckStatus: 'PENDING',
        truckNumber: input.truckNumber || null,
        driverName: input.driverName || null,
        createdById: principal?.kind === 'user' ? principal.sub : null,
      });
      const deliveryId = Number((inserted as unknown as Array<{ insertId: number }>)[0]?.insertId);

      for (const line of input.lines) {
        const part = partById.get(line.partId)!;
        // qtyPerKanban DISALIN ke baris, tidak dibaca ulang dari master saat
        // menghitung. Master bisa berubah, dokumen yang sudah dikirim tidak boleh ikut berubah.
        const qtyPerKanban = line.qtyPerKanban || part.qtyPerKanban || 0;
        await tx.insert(deliveryLines).values({
          deliveryId,
          partId: line.partId,
          customerPartId: line.customerPartId ?? null,
          plannedKanban: line.plannedKanban,
          qtyPerKanban,
          plannedQty: line.plannedKanban * qtyPerKanban,
          actualKanban: 0,
          actualQty: 0,
        });
      }

      this.logger.log(`loading list ${documentNumber}: ${input.lines.length} baris`);
      return { id: deliveryId, documentNumber, lineCount: input.lines.length };
    });
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
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
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

    const converted = convertCustomerPartNumber(
      input.customerPart,
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
      candidates.find((c) => c.customerPartNumber === input.customerPart.trim()) ??
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
          serialNumber: input.serialNumber || null,
          qty: match.qtyPerKanban,
          userId: principal?.kind === 'user' ? principal.sub : null,
          scannedAt: new Date(),
          // clientRef-lah yang mencegah kiriman ulang terhitung dua kali. Tanpa
          // itu dipakai kunci acak: nomor urut kanban tidak bisa dipakai karena
          // setelah undo, nomor yang sama akan muncul lagi.
          // Tahap ikut masuk kunci: kanban yang sama memang discan dua kali,
          // sekali saat diambil dari gudang dan sekali saat naik truk.
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
          await tx.update(deliveries).set({ status: 'PICKING' }).where(eq(deliveries.id, input.deliveryId));
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
          .select({ actualKanban: deliveryLines.actualKanban })
          .from(deliveryLines)
          .where(eq(deliveryLines.id, match.lineId))
          .limit(1);
        return rows[0]?.actualKanban ?? match.actualKanban;
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

    const lines = await this.db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, id));
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
      .where(inArray(parts.id, diambil.map((l) => l.partId)));
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
          sourceTable: 'deliveries',
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

    const lines = await this.db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, id));
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
      .where(inArray(parts.id, loaded.map((l) => l.partId)));
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
          sourceTable: 'deliveries',
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

  async cancel(id: number) {
    const rows = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan');
    if (doc.status === 'SHIPPED' || doc.status === 'RECEIVED') {
      throw new BadRequestException(
        'Dokumen yang sudah berangkat tidak bisa dibatalkan. Catat koreksinya sebagai penyesuaian stok.',
      );
    }
    await this.db.update(deliveries).set({ status: 'CANCELLED' }).where(eq(deliveries.id, id));
    return { id, status: 'CANCELLED' as const };
  }

  async list(params: { page: number; perPage: number }) {
    const offset = (params.page - 1) * params.perPage;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: deliveries.id,
          documentNumber: deliveries.documentNumber,
          pdsNumber: deliveries.pdsNumber,
          customerName: customers.name,
          deliveryDate: deliveries.deliveryDate,
          cycle: deliveries.cycle,
          status: deliveries.status,
          truckStatus: deliveries.truckStatus,
          plannedKanban: sql<string>`COALESCE(SUM(${deliveryLines.plannedKanban}), 0)`,
          pickedKanban: sql<string>`COALESCE(SUM(${deliveryLines.pickedKanban}), 0)`,
          actualKanban: sql<string>`COALESCE(SUM(${deliveryLines.actualKanban}), 0)`,
        })
        .from(deliveries)
        .leftJoin(customers, eq(deliveries.customerId, customers.id))
        .leftJoin(deliveryLines, eq(deliveryLines.deliveryId, deliveries.id))
        .groupBy(
          deliveries.id,
          deliveries.documentNumber,
          deliveries.pdsNumber,
          customers.name,
          deliveries.deliveryDate,
          deliveries.cycle,
          deliveries.status,
          deliveries.truckStatus,
        )
        .orderBy(desc(deliveries.deliveryDate), desc(deliveries.id))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(deliveries),
    ]);

    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows.map((r) => ({
        ...r,
        plannedKanban: Number(r.plannedKanban),
        pickedKanban: Number(r.pickedKanban),
        actualKanban: Number(r.actualKanban),
      })),
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  async findOne(id: number) {
    const rows = await this.db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        pdsNumber: deliveries.pdsNumber,
        plantId: deliveries.plantId,
        customerId: deliveries.customerId,
        customerName: customers.name,
        customerCode: customers.code,
        partNumberFormat: customers.partNumberFormat,
        deliveryDate: deliveries.deliveryDate,
        cycle: deliveries.cycle,
        dock: deliveries.dock,
        locationId: deliveries.locationId,
        locationName: locations.name,
        locationCode: locations.code,
        stagingLocationId: deliveries.stagingLocationId,
        stagingLocationName: sql<string | null>`staging.name`,
        stagingLocationCode: sql<string | null>`staging.code`,
        status: deliveries.status,
        truckStatus: deliveries.truckStatus,
        truckNumber: deliveries.truckNumber,
        driverName: deliveries.driverName,
        departedAt: deliveries.departedAt,
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .leftJoin(locations, eq(deliveries.locationId, locations.id))
      // Alias tersendiri: tabel locations dipakai dua kali dalam query yang sama.
      .leftJoin(sql`locations AS staging`, sql`staging.id = ${deliveries.stagingLocationId}`)
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

    return { ...doc, lines };
  }

  /**
   * Daftar part yang bisa dimuat untuk sebuah customer.
   *
   * Part tanpa penomoran customer tetap ditampilkan — barangnya boleh dikirim,
   * hanya saja barcode kanban customer tidak akan cocok otomatis, dan itu
   * ditandai di layar supaya ketahuan sebelum truk datang.
   */
  async customerCatalog(customerId: number, plantId?: number) {
    const rows = await this.db
      .select({
        partId: parts.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        plantId: parts.plantId,
        uom: parts.uom,
        partQtyPerKanban: parts.qtyPerKanban,
        customerPartId: customerParts.id,
        customerPartNumber: customerParts.customerPartNumber,
        customerQtyPerKanban: customerParts.qtyPerKanban,
      })
      .from(parts)
      .leftJoin(
        customerParts,
        and(eq(customerParts.partId, parts.id), eq(customerParts.customerId, customerId)),
      )
      .where(
        plantId
          ? and(eq(parts.isActive, true), eq(parts.plantId, plantId))
          : eq(parts.isActive, true),
      )
      .orderBy(parts.partNumber);

    return rows.map((r) => ({
      partId: r.partId,
      partNumber: r.partNumber,
      partName: r.partName,
      plantId: r.plantId,
      uom: r.uom,
      customerPartId: r.customerPartId,
      customerPartNumber: r.customerPartNumber,
      // Penomoran customer boleh menimpa isi kanban standar — kemasan tiap
      // customer berbeda meski partnya sama.
      qtyPerKanban: r.customerQtyPerKanban ?? r.partQtyPerKanban ?? 0,
    }));
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

  private async countOn(plantId: number, date: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(deliveries)
      .where(and(eq(deliveries.plantId, plantId), eq(deliveries.deliveryDate, date)));
    return rows[0]?.value ?? 0;
  }
}
