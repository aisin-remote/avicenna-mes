import 'server-only';
import { getDb, eq, and, gte, lt, like, or, sql, desc, asc, count, inArray } from '@avicenna/db';
import {
  parts,
  lines,
  plants,
  customers,
  suppliers,
  kanbans,
  deliveries,
  receipts,
  scanEvents,
  sapOutbox,
} from '@avicenna/db';
import { productionDayWindow } from '@avicenna/domain';
import type { GlobalSearchResult, NavNotification } from './shell-types';

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

/** Data lintas modul untuk command palette; hasil dibatasi menu dan pabrik sesi. */
export async function searchGlobalData(opts: {
  q: string;
  plantId: number;
  menuHrefs: string[];
}): Promise<GlobalSearchResult[]> {
  const db = getDb();
  const menus = new Set(opts.menuHrefs);
  const escaped = opts.q.replace(/[\\%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const zero = Promise.resolve([]);
  const canParts = menus.has('/master/parts') || menus.has('/stock');

  const [partRows, cardRows, deliveryRows, receiptRows, supplierRows] = await Promise.all([
    canParts
      ? db
          .select({
            id: parts.id,
            partNumber: parts.partNumber,
            backNumber: parts.backNumber,
            name: parts.name,
          })
          .from(parts)
          .where(
            and(
              eq(parts.plantId, opts.plantId),
              or(
                like(parts.partNumber, pattern),
                like(parts.backNumber, pattern),
                like(parts.name, pattern),
              ),
            ),
          )
          .orderBy(asc(parts.partNumber))
          .limit(6)
      : zero,
    menus.has('/master/kanbans')
      ? db
          .select({
            id: kanbans.id,
            serialNumber: kanbans.serialNumber,
            status: kanbans.status,
            partNumber: parts.partNumber,
          })
          .from(kanbans)
          .innerJoin(parts, eq(kanbans.partId, parts.id))
          .where(
            and(
              eq(kanbans.plantId, opts.plantId),
              or(like(kanbans.serialNumber, pattern), like(parts.partNumber, pattern)),
            ),
          )
          .orderBy(desc(kanbans.id))
          .limit(5)
      : zero,
    menus.has('/delivery')
      ? db
          .select({
            id: deliveries.id,
            documentNumber: deliveries.documentNumber,
            pdsNumber: deliveries.pdsNumber,
            status: deliveries.status,
            customerName: customers.name,
          })
          .from(deliveries)
          .innerJoin(customers, eq(deliveries.customerId, customers.id))
          .where(
            and(
              eq(deliveries.plantId, opts.plantId),
              or(
                like(deliveries.documentNumber, pattern),
                like(deliveries.pdsNumber, pattern),
                like(customers.name, pattern),
              ),
            ),
          )
          .orderBy(desc(deliveries.id))
          .limit(5)
      : zero,
    menus.has('/receiving')
      ? db
          .select({
            id: receipts.id,
            documentNumber: receipts.documentNumber,
            supplierDocNumber: receipts.supplierDocNumber,
            status: receipts.status,
            supplierName: suppliers.name,
          })
          .from(receipts)
          .innerJoin(suppliers, eq(receipts.supplierId, suppliers.id))
          .where(
            and(
              eq(receipts.plantId, opts.plantId),
              or(
                like(receipts.documentNumber, pattern),
                like(receipts.supplierDocNumber, pattern),
                like(suppliers.name, pattern),
              ),
            ),
          )
          .orderBy(desc(receipts.id))
          .limit(5)
      : zero,
    menus.has('/master/suppliers')
      ? db
          .select({ id: suppliers.id, code: suppliers.code, name: suppliers.name })
          .from(suppliers)
          .where(or(like(suppliers.code, pattern), like(suppliers.name, pattern)))
          .orderBy(asc(suppliers.name))
          .limit(5)
      : zero,
  ]);

  const partHref = (partNumber: string) =>
    menus.has('/master/parts')
      ? `/master/parts?q=${encodeURIComponent(partNumber)}`
      : `/stock?q=${encodeURIComponent(partNumber)}`;

  return [
    ...partRows.map(
      (row): GlobalSearchResult => ({
        type: 'Part',
        title: row.partNumber,
        subtitle: [row.backNumber, row.name].filter(Boolean).join(' · '),
        href: partHref(row.partNumber),
        icon: 'Package',
      }),
    ),
    ...cardRows.map(
      (row): GlobalSearchResult => ({
        type: 'Kanban',
        title: row.serialNumber,
        subtitle: `${row.partNumber} · ${row.status}`,
        href: `/master/kanbans?q=${encodeURIComponent(row.serialNumber)}`,
        icon: 'ScanLine',
      }),
    ),
    ...deliveryRows.map(
      (row): GlobalSearchResult => ({
        type: 'Pengiriman',
        title: row.documentNumber,
        subtitle: [row.pdsNumber, row.customerName, row.status].filter(Boolean).join(' · '),
        href: `/delivery/${row.id}`,
        icon: 'PackageCheck',
      }),
    ),
    ...receiptRows.map(
      (row): GlobalSearchResult => ({
        type: 'Penerimaan',
        title: row.documentNumber,
        subtitle: [row.supplierDocNumber, row.supplierName, row.status]
          .filter(Boolean)
          .join(' · '),
        href: `/receiving/${row.id}`,
        icon: 'Truck',
      }),
    ),
    ...supplierRows.map(
      (row): GlobalSearchResult => ({
        type: 'Supplier',
        title: row.name,
        subtitle: row.code,
        href: `/master/suppliers?q=${encodeURIComponent(row.code)}`,
        icon: 'Factory',
      }),
    ),
  ].slice(0, 18);
}

/** Ringkasan tindakan operasional untuk tombol notifikasi di topbar. */
export async function getNavNotifications(opts: {
  plantId: number;
  menuHrefs: string[];
}): Promise<NavNotification[]> {
  const db = getDb();
  const menus = new Set(opts.menuHrefs);
  const zero = Promise.resolve([{ value: 0 }]);
  const [picking, loading, receiptDrafts, sapProblems] = await Promise.all([
    menus.has('/delivery')
      ? db
          .select({ value: count() })
          .from(deliveries)
          .where(and(eq(deliveries.plantId, opts.plantId), eq(deliveries.status, 'PICKING')))
      : zero,
    menus.has('/delivery')
      ? db
          .select({ value: count() })
          .from(deliveries)
          .where(and(eq(deliveries.plantId, opts.plantId), eq(deliveries.status, 'LOADING')))
      : zero,
    menus.has('/receiving')
      ? db
          .select({ value: count() })
          .from(receipts)
          .where(and(eq(receipts.plantId, opts.plantId), eq(receipts.status, 'DRAFT')))
      : zero,
    menus.has('/sap')
      ? db
          .select({ value: count() })
          .from(sapOutbox)
          .where(
            and(
              eq(sapOutbox.plantId, opts.plantId),
              inArray(sapOutbox.status, ['FAILED', 'REJECTED']),
            ),
          )
      : zero,
  ]);

  return [
    {
      id: 'delivery-picking',
      title: 'Pengiriman sedang dipicking',
      detail: 'Barang masih dipindahkan dari gudang ke staging.',
      href: '/delivery',
      tone: 'warn',
      count: Number(picking[0]?.value ?? 0),
    },
    {
      id: 'delivery-loading',
      title: 'Truk sedang dimuat',
      detail: 'Loading list belum diberangkatkan.',
      href: '/delivery',
      tone: 'warn',
      count: Number(loading[0]?.value ?? 0),
    },
    {
      id: 'receipt-draft',
      title: 'Penerimaan belum selesai',
      detail: 'Dokumen penerimaan masih berstatus draft.',
      href: '/receiving',
      tone: 'warn',
      count: Number(receiptDrafts[0]?.value ?? 0),
    },
    {
      id: 'sap-problem',
      title: 'Dokumen SAP bermasalah',
      detail: 'Periksa dokumen gagal atau ditolak SAP.',
      href: '/sap',
      tone: 'danger',
      count: Number(sapProblems[0]?.value ?? 0),
    },
  ].filter((item) => item.count > 0) as NavNotification[];
}
