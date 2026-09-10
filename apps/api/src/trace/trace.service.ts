import { Injectable, BadRequestException } from '@nestjs/common';
import { eq, and, desc, isNull, sql, type Database } from '@avicenna/db';
import { genealogy, parts, lots, scanEvents, lines, suppliers } from '@avicenna/db';
import { InjectDb } from '../db/db.module';

/**
 * Telusur silsilah — inti dari seluruh sistem ketertelusuran.
 *
 * Menjawab dua pertanyaan yang selalu muncul saat ada masalah kualitas, dan
 * keduanya sama pentingnya:
 *
 *   MUNDUR  unit ABC nomor seri X bermasalah — isinya komponen dan lot apa?
 *   MAJU    lot D-2026-11 cacat — unit mana saja yang memakainya?
 *
 * Yang pertama dipakai saat satu unit dikeluhkan customer. Yang kedua dipakai
 * saat supplier memberi tahu ada lot bermasalah, dan itulah yang menentukan
 * seberapa luas penarikan barang harus dilakukan.
 */
@Injectable()
export class TraceService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Menelusuri ke bawah: unit ini terbuat dari apa.
   *
   * Hanya tautan yang masih berlaku (belum digantikan lewat perbaikan) yang
   * dianggap isi saat ini. Tautan lama tetap dikembalikan terpisah, karena
   * saat investigasi justru komponen yang SUDAH diganti yang sering dicari.
   */
  async backward(serial: string) {
    const value = serial.trim();
    if (!value) throw new BadRequestException('Nomor seri wajib diisi');

    const rows = await this.db
      .select({
        id: genealogy.id,
        componentPartId: genealogy.componentPartId,
        componentPartNumber: parts.partNumber,
        componentPartName: parts.name,
        componentSerial: genealogy.componentSerial,
        lotId: genealogy.componentLotId,
        lotNumber: lots.lotNumber,
        supplierLotNumber: lots.supplierLotNumber,
        supplierName: suppliers.name,
        qty: genealogy.qty,
        evidence: genealogy.evidence,
        occurredAt: genealogy.occurredAt,
        supersededAt: genealogy.supersededAt,
      })
      .from(genealogy)
      .leftJoin(parts, eq(genealogy.componentPartId, parts.id))
      .leftJoin(lots, eq(genealogy.componentLotId, lots.id))
      .leftJoin(suppliers, eq(lots.supplierId, suppliers.id))
      .where(eq(genealogy.parentSerial, value))
      .orderBy(desc(genealogy.occurredAt));

    // Identitas unitnya sendiri, diambil dari catatan produksinya.
    const produced = await this.db
      .select({
        partNumber: parts.partNumber,
        partName: parts.name,
        lineCode: lines.code,
        lineName: lines.name,
        processType: scanEvents.processType,
        scannedAt: scanEvents.scannedAt,
        qty: scanEvents.qty,
      })
      .from(scanEvents)
      .leftJoin(parts, eq(scanEvents.partId, parts.id))
      .leftJoin(lines, eq(scanEvents.lineId, lines.id))
      .where(eq(scanEvents.serialNumber, value))
      .orderBy(desc(scanEvents.scannedAt));

    return {
      serial: value,
      found: rows.length > 0 || produced.length > 0,
      produced,
      components: rows.filter((r) => !r.supersededAt),
      replaced: rows.filter((r) => r.supersededAt),
    };
  }

  /**
   * Menelusuri ke atas: lot ini masuk ke unit mana saja.
   *
   * Dibatasi jumlahnya karena satu lot raw material bisa masuk ke ribuan unit,
   * dan menampilkan semuanya sekaligus tidak membantu siapa pun. Jumlah
   * totalnya tetap dihitung penuh supaya luas dampaknya tetap terlihat.
   */
  async forward(lotNumber: string, limit = 200) {
    const value = lotNumber.trim();
    if (!value) throw new BadRequestException('Nomor lot wajib diisi');

    const lotRows = await this.db
      .select({
        id: lots.id,
        lotNumber: lots.lotNumber,
        supplierLotNumber: lots.supplierLotNumber,
        supplierName: suppliers.name,
        partNumber: parts.partNumber,
        partName: parts.name,
        receivedAt: lots.receivedAt,
        initialQty: lots.initialQty,
        status: lots.status,
      })
      .from(lots)
      .leftJoin(parts, eq(lots.partId, parts.id))
      .leftJoin(suppliers, eq(lots.supplierId, suppliers.id))
      .where(
        sql`${lots.lotNumber} = ${value} OR ${lots.supplierLotNumber} = ${value}`,
      )
      .limit(1);

    const lot = lotRows[0];
    if (!lot) {
      return { found: false, lot: null, totalUnits: 0, units: [] };
    }

    const [countRows, units] = await Promise.all([
      this.db
        .select({ value: sql<number>`COUNT(DISTINCT ${genealogy.parentSerial})` })
        .from(genealogy)
        .where(eq(genealogy.componentLotId, lot.id)),
      this.db
        .select({
          parentSerial: genealogy.parentSerial,
          parentPartNumber: parts.partNumber,
          parentPartName: parts.name,
          qty: genealogy.qty,
          evidence: genealogy.evidence,
          occurredAt: genealogy.occurredAt,
          supersededAt: genealogy.supersededAt,
        })
        .from(genealogy)
        .leftJoin(parts, eq(genealogy.parentPartId, parts.id))
        .where(eq(genealogy.componentLotId, lot.id))
        .orderBy(desc(genealogy.occurredAt))
        .limit(Math.min(limit, 500)),
    ]);

    return {
      found: true,
      lot,
      totalUnits: countRows[0]?.value ?? 0,
      units,
    };
  }
}
