import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, isNull, or, type Database } from '@avicenna/db';
import {
  scanEvents,
  parts,
  lines,
  bomLines,
  lots,
  mutations,
  consumptions,
  genealogy,
} from '@avicenna/db';
import { planBackflush, toLocalDateKey, type AvailableLot, type BomLine } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';

/**
 * Mengurangi stok komponen otomatis setiap ada produksi, mengikuti BOM.
 *
 * Dijalankan dari antrean, bukan di dalam request scan. Dua alasannya: layar
 * operator tidak boleh ikut menunggu perhitungan material, dan kegagalan
 * perhitungan tidak boleh menggagalkan pencatatan produksi yang sudah terjadi.
 *
 * Perhitungannya deterministik — selalu bisa dijalankan ulang dari catatan
 * produksi bila ada job yang gagal. Itu yang membuat pemindahan ke antrean
 * aman: tidak ada informasi yang hilang, hanya tertunda.
 */
@Injectable()
export class BackflushService {
  private readonly logger = new Logger(BackflushService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async run(scanEventId: number): Promise<{ consumed: number; shortages: number; noBom: boolean }> {
    const scanRows = await this.db
      .select()
      .from(scanEvents)
      .where(eq(scanEvents.id, scanEventId))
      .limit(1);

    const scan = scanRows[0];
    if (!scan || !scan.partId) {
      // Scan tanpa part yang dikenali tidak bisa di-backflush. Bukan kesalahan:
      // barcode yang belum terpetakan ke master tetap tercatat sebagai produksi.
      return { consumed: 0, shortages: 0, noBom: true };
    }
    const partId = scan.partId;

    // Kunci tanggal dari komponen waktu SETEMPAT. toISOString() memakai UTC,
    // sehingga scan pukul 06.00 di UTC+7 terbaca sebagai tanggal kemarin — dan
    // masa berlaku BOM akan dinilai dengan tanggal yang salah.
    const onDate = toLocalDateKey(scan.scannedAt);

    /*
     * Line menentukan SLOC mana yang dipotong. Produksi memindahkan barang:
     * komponen keluar dari gudang WIP line ini, bukan hilang dari ketiadaan.
     * Tanpa lokasi, saldo per SLOC tidak akan pernah cocok dengan SAP.
     */
    const lineRows = scan.lineId
      ? await this.db.select().from(lines).where(eq(lines.id, scan.lineId)).limit(1)
      : [];
    const lokasiRute = (scan.meta as { sapRoute?: { inputLocationId?: number | null } } | null)
      ?.sapRoute;
    const inputLocationId =
      lokasiRute && 'inputLocationId' in lokasiRute
        ? (lokasiRute.inputLocationId ?? null)
        : (lineRows[0]?.inputLocationId ?? null);
    if (scan.lineId && !inputLocationId) {
      // Dilaporkan, bukan digagalkan: produksinya sudah terjadi. Tapi tanpa
      // SLOC asal, baris ini tidak akan bisa dikirim ke SAP.
      this.logger.warn(
        `line ${scan.lineId} belum punya SLOC asal — pemakaian material tercatat tanpa lokasi`,
      );
    }

    const rawBom = await this.db.select().from(bomLines).where(eq(bomLines.parentPartId, partId));

    const bom: BomLine[] = rawBom.map((l) => ({
      parentPartId: l.parentPartId,
      componentPartId: l.componentPartId,
      qtyPer: Number(l.qtyPer),
      scrapPct: Number(l.scrapPct),
      uom: l.uom,
      effectiveFrom: l.effectiveFrom,
      effectiveTo: l.effectiveTo,
    }));

    const componentIds = [...new Set(bom.map((l) => l.componentPartId))];
    const hasil = await this.db.transaction(
      async (tx) => {
        const [terkunci] = await tx
          .select({ meta: scanEvents.meta })
          .from(scanEvents)
          .where(eq(scanEvents.id, scan.id))
          .for('update');
        const meta = (terkunci?.meta ?? {}) as Record<string, unknown>;
        if (meta.backflushCompleted === true) {
          return { sudah: true as const, noBom: meta.backflushNoBom === true, plan: null };
        }

        // Scan lama mungkin pernah di-backflush sebelum penanda ini ada.
        // Bila sudah ada satu mutasi konsumsi, jangan menebak bahwa semuanya
        // lengkap lalu menjalankan ulang dan memotong stok dua kali.
        const [konsumsiLama] = await tx
          .select({ id: mutations.id })
          .from(mutations)
          .where(
            and(
              eq(mutations.sourceTable, 'TT_HISTORY_SCAN'),
              eq(mutations.sourceId, scan.id),
              eq(mutations.type, 'CONSUMPTION_OUT'),
            ),
          )
          .limit(1);
        if (konsumsiLama) {
          throw new Error(
            `backflush scan ${scan.id} sudah punya konsumsi tanpa penanda selesai; periksa sebelum mengulang`,
          );
        }

        // Semua job yang memakai lot komponen yang sama mengambil kunci dengan
        // urutan id yang sama. Saldo FIFO dibaca SETELAH kunci diperoleh, jadi
        // dua scan serentak tidak sama-sama mengalokasikan stok lot terakhir.
        if (componentIds.length > 0) {
          await tx
            .select({ id: lots.id })
            .from(lots)
            .where(and(inArrayNumbers(lots.partId, componentIds), eq(lots.status, 'OPEN')))
            .orderBy(lots.id)
            .for('update');
        }
        const availableLots =
          componentIds.length > 0 ? await this.lotsFor(componentIds, inputLocationId, tx) : [];
        const plan = planBackflush({
          producedPartId: partId,
          qty: scan.qty,
          bomLines: bom,
          onDate,
          availableLots,
        });

        if (plan.noBom) {
          await tx
            .update(scanEvents)
            .set({ meta: { ...meta, backflushCompleted: true, backflushNoBom: true } })
            .where(eq(scanEvents.id, scan.id));
          return { sudah: false as const, noBom: true, plan };
        }

        for (const c of plan.consumptions) {
          await tx.insert(consumptions).values({
            plantId: scan.plantId,
            lineId: scan.lineId,
            producedPartId: partId,
            componentPartId: c.componentPartId,
            lotId: c.lotId ?? null,
            qty: String(c.qty),
            uom: c.uom,
            source: 'BACKFLUSH',
            occurredAt: scan.scannedAt,
          });

          await tx.insert(mutations).values({
            plantId: scan.plantId,
            partId: c.componentPartId,
            lineId: scan.lineId,
            locationId: inputLocationId,
            lotId: c.lotId ?? null,
            type: 'CONSUMPTION_OUT',
            // Bertanda negatif: material keluar dari stok. TIDAK dibulatkan —
            // kolomnya desimal justru supaya pecahan kilogram tidak hilang.
            qty: String(-c.qty),
            sourceTable: 'TT_HISTORY_SCAN',
            sourceId: scan.id,
            occurredAt: scan.scannedAt,
          });

          if (scan.serialNumber) {
            await tx.insert(genealogy).values({
              plantId: scan.plantId,
              parentSerial: scan.serialNumber,
              parentPartId: partId,
              componentPartId: c.componentPartId,
              componentLotId: c.lotId ?? null,
              qty: String(c.qty),
              // Komponen tidak discan, jadi ini kesimpulan dari lot yang aktif —
              // bukan bukti. Perbedaannya sengaja tetap terlihat.
              evidence: 'INFERRED',
              occurredAt: scan.scannedAt,
            });
          }
        }
        await tx
          .update(scanEvents)
          .set({ meta: { ...meta, backflushCompleted: true, backflushNoBom: false } })
          .where(eq(scanEvents.id, scan.id));
        return { sudah: false as const, noBom: false, plan };
      },
      { isolationLevel: 'read committed' },
    );

    if (hasil.sudah) return { consumed: 0, shortages: 0, noBom: hasil.noBom };
    const plan = hasil.plan;
    if (plan.noBom) {
      this.logger.debug(`part ${scan.partId} tidak punya BOM aktif, backflush dilewati`);
      return { consumed: 0, shortages: 0, noBom: true };
    }

    if (plan.shortages.length > 0) {
      // Bukan kegagalan: barangnya sudah jadi. Tapi harus terlihat, karena
      // artinya penerimaan barang atau data masternya tertinggal.
      for (const s of plan.shortages) {
        this.logger.warn(
          `stok komponen ${s.componentPartId} kurang saat backflush scan ${scan.id}: ` +
            `butuh ${s.requiredQty}, tersedia ${s.availableQty}`,
        );
      }
    }

    return {
      consumed: plan.consumptions.length,
      shortages: plan.shortages.length,
      noBom: false,
    };
  }

  /**
   * Sisa tiap lot = jumlah mutasi pada SLOC input langkah rute.
   *
   * `lots.initialQty` TIDAK ikut dijumlahkan. Kolom itu hanya catatan berapa
   * yang tertulis saat barang datang; jumlah yang benar-benar masuk dicatat
   * sebagai mutasi RECEIVING_IN. Menjumlahkan keduanya menghitung barang yang
   * sama dua kali — dan akibatnya FIFO akan mengalokasikan dari stok yang
   * sebenarnya tidak ada. Bila SLOC input belum ada, saldo global tetap dipakai
   * untuk kompatibilitas dengan scan lama.
   *
   * Aturannya tetap satu: saldo selalu turunan dari buku besar, tanpa kecuali.
   */
  private async lotsFor(
    partIds: number[],
    locationId: number | null,
    db: Database = this.db,
  ): Promise<AvailableLot[]> {
    const rows = await db
      .select({
        lotId: lots.id,
        partId: lots.partId,
        initialQty: lots.initialQty,
        receivedAt: lots.receivedAt,
        createdAt: lots.createdAt,
        moved: sql<string>`COALESCE(SUM(${mutations.qty}), 0)`,
      })
      .from(lots)
      .leftJoin(
        mutations,
        and(
          eq(mutations.lotId, lots.id),
          locationId === null ? undefined : eq(mutations.locationId, locationId),
        ),
      )
      .where(and(inArrayNumbers(lots.partId, partIds), eq(lots.status, 'OPEN')))
      .groupBy(lots.id, lots.partId, lots.initialQty, lots.receivedAt, lots.createdAt);

    return rows
      .map((r) => ({
        lotId: r.lotId,
        partId: r.partId,
        remainingQty: Number(r.moved),
        receivedAt: r.receivedAt ?? r.createdAt,
      }))
      .filter((l) => l.remainingQty > 0);
  }
}

/** Pembungkus kecil agar pemanggilan inArray tetap terbaca di atas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inArrayNumbers(column: any, values: number[]) {
  return sql`${column} IN (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}
