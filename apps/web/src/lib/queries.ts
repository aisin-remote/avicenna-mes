import 'server-only';
import { getDb, eq, and, gte, lt, like, or, sql, desc, count } from '@avicenna/db';
import { parts, lines, plants, customers, scanEvents } from '@avicenna/db';
import { productionDayWindow } from '@avicenna/domain';

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

  /*
   * Jendela hari produksi, bukan `DATE(scannedAt) = CURDATE()`.
   *
   * Dua hal yang salah pada cara lama, dan keduanya menghilangkan shift malam:
   *
   *   1. CURDATE() adalah tanggal LOKAL milik MySQL, sedangkan DTM_SCANNED_AT
   *      ditulis dari Node dalam UTC (lihat catatan zona waktu di
   *      packages/db/src/client.ts). Scan pukul 02:00 tersimpan sebagai pukul
   *      19:00 hari sebelumnya, sehingga tidak pernah terhitung.
   *   2. Hari produksi mulai pukul 07:00, bukan tengah malam — jadi sekalipun
   *      zona waktunya benar, potongan tengah malam tetap membelah hasil satu
   *      shift ke dua tanggal.
   *
   * Batasnya dikirim sebagai parameter Date supaya driver yang mengurus
   * konversinya, bukan dirangkai sebagai teks tanggal.
   */
  const hariProduksi = productionDayWindow(new Date());

  const [plantCount, lineCount, partCount, customerCount, todayScans] = await Promise.all([
    db.select({ value: count() }).from(plants),
    db.select({ value: count() }).from(lines),
    db.select({ value: count() }).from(parts),
    db.select({ value: count() }).from(customers),
    db
      .select({ value: count() })
      .from(scanEvents)
      .where(
        and(
          gte(scanEvents.scannedAt, hariProduksi.start),
          lt(scanEvents.scannedAt, hariProduksi.end),
        ),
      ),
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

export interface LineProduksi {
  id: number;
  code: string;
  name: string;
  processType: string;
  plantCode: string | null;
  /** Jumlah scan produksi diterima pada HARI PRODUKSI berjalan. */
  scanHariIni: number;
  /** Jumlah unit — qty dijumlahkan, bukan sekadar banyaknya scan. */
  qtyHariIni: number;
  scanTerakhir: Date | null;
}

/**
 * Line beserta hasil produksinya pada hari produksi berjalan.
 *
 * ── Kenapa satu query, bukan satu per line ──────────────────────────────────
 *
 * Layar monitor menampilkan seluruh line sekaligus. Menghitung per line berarti
 * satu query per kartu, dan jumlahnya bertambah setiap kali pabrik menambah
 * line — persoalan N+1 yang baru terasa setelah line ke sepuluh.
 *
 * ── Kenapa jendelanya bukan hari kalender ───────────────────────────────────
 *
 * Shift malam melewati tengah malam. Memakai 00:00-23:59 membuat hasil shift
 * malam terbelah ke dua tanggal, dan angka di layar tidak akan pernah cocok
 * dengan hitungan manual orang lapangan.
 */
export async function listLinesWithProduction(): Promise<LineProduksi[]> {
  const db = getDb();
  const { start, end } = productionDayWindow(new Date());

  const rows = await db
    .select({
      id: lines.id,
      code: lines.code,
      name: lines.name,
      processType: lines.processType,
      plantCode: plants.code,
      scanHariIni: sql<number>`COUNT(${scanEvents.id})`,
      qtyHariIni: sql<number>`COALESCE(SUM(${scanEvents.qty}), 0)`,
      scanTerakhir: sql<Date | null>`MAX(${scanEvents.scannedAt})`,
    })
    .from(lines)
    .leftJoin(plants, eq(lines.plantId, plants.id))
    /*
     * Penyaring waktu ikut di dalam ON, bukan di WHERE.
     *
     * Di WHERE, line yang belum ada scan-nya hari ini akan hilang dari hasil —
     * padahal justru line yang belum berproduksi yang perlu terlihat di layar
     * monitor.
     */
    .leftJoin(
      scanEvents,
      and(
        eq(scanEvents.lineId, lines.id),
        eq(scanEvents.kind, 'PRODUCTION'),
        gte(scanEvents.scannedAt, start),
        lt(scanEvents.scannedAt, end),
      ),
    )
    .where(eq(lines.isActive, true))
    .groupBy(lines.id, lines.code, lines.name, lines.processType, plants.code)
    .orderBy(plants.code, lines.sortOrder);

  return rows.map((r) => ({
    ...r,
    scanHariIni: Number(r.scanHariIni),
    qtyHariIni: Number(r.qtyHariIni),
    scanTerakhir: r.scanTerakhir ? new Date(r.scanTerakhir) : null,
  }));
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
