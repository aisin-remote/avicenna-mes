import 'server-only';
import { getDb, eq, and, like, or, sql, desc, count } from '@avicenna/db';
import { parts, lines, plants, customers, scanEvents } from '@avicenna/db';

/**
 * Query baca untuk Server Component.
 *
 * Ini keuntungan nyata App Router untuk aplikasi ini: report yang berisi
 * puluhan ribu baris di-query dan dirender di server, browser hanya menerima
 * HTML jadi. Di sistem lama, DataTables server-side mengirim JSON lalu jQuery
 * membangun tabelnya di browser — itu yang bikin layar report berat di PC
 * pabrik yang spesifikasinya rendah.
 */

export interface PartListParams {
  page: number;
  perPage: number;
  search?: string;
  plantId?: number;
}

export async function listParts({ page, perPage, search, plantId }: PartListParams) {
  const db = getDb();
  const offset = (page - 1) * perPage;

  const conditions = [];
  if (plantId) conditions.push(eq(parts.plantId, plantId));
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(like(parts.partNumber, term), like(parts.name, term), like(parts.backNumber, term)),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        name: parts.name,
        processType: parts.processType,
        qtyPerKanban: parts.qtyPerKanban,
        standardStock: parts.standardStock,
        isActive: parts.isActive,
        lineName: lines.name,
        plantCode: plants.code,
      })
      .from(parts)
      .leftJoin(lines, eq(parts.lineId, lines.id))
      .leftJoin(plants, eq(parts.plantId, plants.id))
      .where(where)
      .orderBy(parts.partNumber)
      .limit(perPage)
      .offset(offset),
    db.select({ value: count() }).from(parts).where(where),
  ]);

  const total = totalRows[0]?.value ?? 0;

  return {
    data: rows,
    meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  };
}

/** Ringkasan untuk dashboard. Satu round-trip per kartu, dijalankan paralel. */
export async function getDashboardSummary() {
  const db = getDb();

  const [plantCount, lineCount, partCount, customerCount, todayScans] = await Promise.all([
    db.select({ value: count() }).from(plants),
    db.select({ value: count() }).from(lines),
    db.select({ value: count() }).from(parts),
    db.select({ value: count() }).from(customers),
    db
      .select({ value: count() })
      .from(scanEvents)
      .where(sql`DATE(${scanEvents.scannedAt}) = CURDATE()`),
  ]);

  return {
    plants: plantCount[0]?.value ?? 0,
    lines: lineCount[0]?.value ?? 0,
    parts: partCount[0]?.value ?? 0,
    customers: customerCount[0]?.value ?? 0,
    scansToday: todayScans[0]?.value ?? 0,
  };
}

export async function listLines() {
  const db = getDb();
  return db
    .select({
      id: lines.id,
      code: lines.code,
      name: lines.name,
      processType: lines.processType,
      plantCode: plants.code,
    })
    .from(lines)
    .leftJoin(plants, eq(lines.plantId, plants.id))
    .where(eq(lines.isActive, true))
    .orderBy(plants.code, lines.sortOrder);
}

export async function recentScans(limit = 20) {
  const db = getDb();
  return db
    .select({
      id: scanEvents.id,
      kind: scanEvents.kind,
      rawCode: scanEvents.rawCode,
      qty: scanEvents.qty,
      scannedAt: scanEvents.scannedAt,
      lineCode: lines.code,
      partName: parts.name,
    })
    .from(scanEvents)
    .leftJoin(lines, eq(scanEvents.lineId, lines.id))
    .leftJoin(parts, eq(scanEvents.partId, parts.id))
    .orderBy(desc(scanEvents.scannedAt))
    .limit(limit);
}
