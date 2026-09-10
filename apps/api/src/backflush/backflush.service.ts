import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, isNull, or, type Database } from '@avicenna/db';
import { scanEvents, parts, bomLines, lots, mutations, consumptions, genealogy } from '@avicenna/db';
import { planBackflush, type AvailableLot, type BomLine } from '@avicenna/domain';
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

    const onDate = scan.scannedAt.toISOString().slice(0, 10);

    const rawBom = await this.db
      .select()
      .from(bomLines)
      .where(eq(bomLines.parentPartId, scan.partId));

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
    const availableLots = componentIds.length > 0 ? await this.lotsFor(componentIds) : [];

    const plan = planBackflush({
      producedPartId: scan.partId,
      qty: scan.qty,
      bomLines: bom,
      onDate,
      availableLots,
    });

    if (plan.noBom) {
      this.logger.debug(`part ${scan.partId} tidak punya BOM aktif, backflush dilewati`);
      return { consumed: 0, shortages: 0, noBom: true };
    }

    for (const c of plan.consumptions) {
      await this.db.insert(consumptions).values({
        plantId: scan.plantId,
        lineId: scan.lineId,
        producedPartId: scan.partId,
        componentPartId: c.componentPartId,
        lotId: c.lotId ?? null,
        qty: String(c.qty),
        uom: c.uom,
        source: 'BACKFLUSH',
        occurredAt: scan.scannedAt,
      });

      await this.db.insert(mutations).values({
        plantId: scan.plantId,
        partId: c.componentPartId,
        lineId: scan.lineId,
        lotId: c.lotId ?? null,
        type: 'CONSUMPTION_OUT',
        // Bertanda negatif: material keluar dari stok. TIDAK dibulatkan —
        // kolomnya desimal justru supaya pecahan kilogram tidak hilang.
        qty: String(-c.qty),
        sourceTable: 'scan_events',
        sourceId: scan.id,
        occurredAt: scan.scannedAt,
      });

      if (scan.serialNumber) {
        await this.db.insert(genealogy).values({
          plantId: scan.plantId,
          parentSerial: scan.serialNumber,
          parentPartId: scan.partId,
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
   * Sisa tiap lot = JUMLAH SELURUH MUTASI yang menyentuh lot itu.
   *
   * `lots.initialQty` TIDAK ikut dijumlahkan. Kolom itu hanya catatan berapa
   * yang tertulis saat barang datang; jumlah yang benar-benar masuk dicatat
   * sebagai mutasi RECEIVING_IN. Menjumlahkan keduanya menghitung barang yang
   * sama dua kali — dan akibatnya FIFO akan mengalokasikan dari stok yang
   * sebenarnya tidak ada.
   *
   * Aturannya tetap satu: saldo selalu turunan dari buku besar, tanpa kecuali.
   */
  private async lotsFor(partIds: number[]): Promise<AvailableLot[]> {
    const rows = await this.db
      .select({
        lotId: lots.id,
        partId: lots.partId,
        initialQty: lots.initialQty,
        receivedAt: lots.receivedAt,
        createdAt: lots.createdAt,
        moved: sql<string>`COALESCE(SUM(${mutations.qty}), 0)`,
      })
      .from(lots)
      .leftJoin(mutations, eq(mutations.lotId, lots.id))
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
  return sql`${column} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}
