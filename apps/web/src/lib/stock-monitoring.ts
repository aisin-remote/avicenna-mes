import 'server-only';
import {
  getDb,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lt,
  ne,
  or,
  sql,
} from '@avicenna/db';
import {
  lines,
  locations,
  lots,
  mutations,
  partProcesses,
  parts,
  plants,
  sapOutbox,
  scanEvents,
} from '@avicenna/db';
import { PROCESS_LABELS, PROCESS_TYPES, type ProcessType } from '@avicenna/contracts';
import {
  productionDateKey,
  productionDayWindow,
  sapMovementFor,
  toLocalDateKey,
} from '@avicenna/domain';

export const JENIS_AKTIVITAS = [
  'PRODUCTION',
  'TRANSFER',
  'CONSUMPTION',
  'RECEIVING',
  'DELIVERY',
  'NG',
  'STOCK_TAKE',
  'ADJUSTMENT',
] as const;
export type JenisAktivitas = (typeof JENIS_AKTIVITAS)[number];

export const LABEL_AKTIVITAS: Record<JenisAktivitas, string> = {
  PRODUCTION: 'Hasil produksi',
  TRANSFER: 'Transfer SLOC',
  CONSUMPTION: 'Pemakaian komponen',
  RECEIVING: 'Penerimaan',
  DELIVERY: 'Pengiriman',
  NG: 'Barang NG',
  STOCK_TAKE: 'Stock opname',
  ADJUSTMENT: 'Penyesuaian',
};

export const LOCATION_KINDS = [
  'WAREHOUSE',
  'WIP',
  'FINISH_GOOD',
  'STAGING',
  'CHUTE',
  'NG',
  'TRANSIT',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface StockMonitorParams {
  search?: string;
  plantId?: number;
  processType?: string;
  locationKind?: string;
  activity?: string;
  from?: string;
  to?: string;
  balancePage: number;
  movementPage: number;
  perPage?: number;
}

function tanggalSah(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.valueOf()) && toLocalDateKey(parsed) === value;
}

function rentangTanggal(from?: string, to?: string) {
  const hariIni = productionDateKey(new Date());
  let awal = tanggalSah(from) ? from : hariIni;
  let akhir = tanggalSah(to) ? to : awal;
  if (akhir < awal) [awal, akhir] = [akhir, awal];
  return {
    from: awal,
    to: akhir,
    start: productionDayWindow(new Date(`${awal}T12:00:00`)).start,
    end: productionDayWindow(new Date(`${akhir}T12:00:00`)).end,
  };
}

function prosesSah(value?: string): ProcessType | undefined {
  return PROCESS_TYPES.find((p) => p === value);
}

function jenisAktivitas(value?: string): JenisAktivitas | undefined {
  return JENIS_AKTIVITAS.find((v) => v === value);
}

function jenisLokasi(value?: string): LocationKind | undefined {
  return LOCATION_KINDS.find((v) => v === value);
}

const MUTASI_PER_AKTIVITAS: Record<JenisAktivitas, string[]> = {
  PRODUCTION: ['PRODUCTION_IN'],
  TRANSFER: ['TRANSFER_OUT'],
  CONSUMPTION: ['CONSUMPTION_OUT'],
  RECEIVING: ['RECEIVING_IN'],
  DELIVERY: ['DELIVERY_OUT'],
  NG: ['NG_OUT'],
  STOCK_TAKE: ['STOCK_TAKE'],
  ADJUSTMENT: ['ADJUSTMENT'],
};

function tahapProses(processType: string | null): string {
  if (!processType) return 'Tanpa proses';
  if (processType.endsWith('_WIP')) return 'WIP';
  if (processType.endsWith('_FG')) return 'FG';
  if (processType.startsWith('ASSEMBLING_')) return 'ASSY FG';
  return 'PROSES';
}

function jenisDariMutasi(type: string): JenisAktivitas {
  if (type === 'PRODUCTION_IN') return 'PRODUCTION';
  if (type === 'TRANSFER_OUT' || type === 'TRANSFER_IN') return 'TRANSFER';
  if (type === 'CONSUMPTION_OUT') return 'CONSUMPTION';
  if (type === 'RECEIVING_IN') return 'RECEIVING';
  if (type === 'DELIVERY_OUT') return 'DELIVERY';
  if (type === 'NG_OUT') return 'NG';
  if (type === 'STOCK_TAKE') return 'STOCK_TAKE';
  return 'ADJUSTMENT';
}

function namaLokasi(code: string | null, name: string | null): string | null {
  if (!code && !name) return null;
  return code ? `${code}${name ? ` · ${name}` : ''}` : name;
}

function kunciSumber(sourceTable: string | null, sourceId: number | null) {
  return `${sourceTable ?? ''}|${sourceId ?? ''}`;
}

function kunciPasangan(v: {
  sourceTable: string | null;
  sourceId: number | null;
  partId: number;
  lotId: number | null;
  qty: string | number;
}) {
  return `${kunciSumber(v.sourceTable, v.sourceId)}|${v.partId}|${v.lotId ?? ''}|${Math.abs(Number(v.qty))}`;
}

export async function stockMonitor(params: StockMonitorParams) {
  const db = getDb();
  const perPage = Math.min(100, Math.max(10, params.perPage ?? 25));
  const processType = prosesSah(params.processType);
  const locationKind = jenisLokasi(params.locationKind);
  const activity = jenisAktivitas(params.activity);
  const range = rentangTanggal(params.from, params.to);
  const search = params.search?.trim();

  /*
   * Tandai setiap baris dengan stock take terakhir pada part + SLOC yang sama.
   * Window function membuat buku besar cukup dipindai sekali; pemeriksaan
   * subquery per mutasi akan melambat tajam saat ledger sudah jutaan baris.
   * Timestamp disambung id agar urutan tetap pasti bila dua baris dibuat pada
   * detik yang sama.
   */
  const urutanMutasi = sql<string>`CONCAT(
    DATE_FORMAT(${mutations.occurredAt}, '%Y%m%d%H%i%s'),
    LPAD(${mutations.id}, 20, '0')
  )`;
  const mutasiSaldo = db
    .select({
      id: mutations.id,
      plantId: mutations.plantId,
      partId: mutations.partId,
      locationId: mutations.locationId,
      type: mutations.type,
      qty: mutations.qty,
      mutationOrder: urutanMutasi.as('mutation_order'),
      lastStockTakeOrder: sql<string | null>`MAX(
        CASE WHEN ${mutations.type} = 'STOCK_TAKE' THEN ${urutanMutasi} END
      ) OVER (
        PARTITION BY ${mutations.plantId}, ${mutations.partId}, ${mutations.locationId}
      )`.as('last_stock_take_order'),
    })
    .from(mutations)
    .as('mutasi_saldo');

  const kondisiSaldo = [];
  if (params.plantId) kondisiSaldo.push(eq(mutasiSaldo.plantId, params.plantId));
  if (locationKind) kondisiSaldo.push(eq(locations.kind, locationKind));
  if (processType) {
    kondisiSaldo.push(sql`EXISTS (
      SELECT 1 FROM TM_PROCESS_PARTS pp
      WHERE pp.INT_PART_ID = ${parts.id}
        AND pp.CHR_PROCESS_TYPE = ${processType}
        AND pp.FLG_IS_ACTIVE = true
    )`);
  }
  if (search) {
    const term = `%${search}%`;
    kondisiSaldo.push(
      or(
        like(parts.partNumber, term),
        like(parts.backNumber, term),
        like(parts.name, term),
        like(locations.code, term),
        like(locations.name, term),
      ),
    );
  }

  /* Stock take adalah angka fisik absolut; mutasi berikutnya baru ditambahkan. */
  const saldoKini = sql<string>`
    COALESCE(MAX(CASE
      WHEN ${mutasiSaldo.type} = 'STOCK_TAKE'
        AND ${mutasiSaldo.mutationOrder} = ${mutasiSaldo.lastStockTakeOrder}
      THEN ${mutasiSaldo.qty}
    END), 0)
    + COALESCE(SUM(CASE
      WHEN ${mutasiSaldo.type} <> 'STOCK_TAKE'
        AND (
          ${mutasiSaldo.lastStockTakeOrder} IS NULL
          OR ${mutasiSaldo.mutationOrder} > ${mutasiSaldo.lastStockTakeOrder}
        )
      THEN ${mutasiSaldo.qty}
      ELSE 0
    END), 0)
  `;

  const saldoDasar = db
    .select({
      plantId: mutasiSaldo.plantId,
      partId: mutasiSaldo.partId,
      partNumber: parts.partNumber,
      backNumber: parts.backNumber,
      partName: parts.name,
      uom: parts.uom,
      project: parts.project,
      plantCode: sql<string | null>`${plants.code}`.as('plant_code'),
      locationId: mutasiSaldo.locationId,
      locationCode: sql<string | null>`${locations.code}`.as('location_code'),
      locationName: sql<string | null>`${locations.name}`.as('location_name'),
      locationKind: sql<string | null>`${locations.kind}`.as('location_kind'),
      balance: saldoKini.as('balance'),
    })
    .from(mutasiSaldo)
    .innerJoin(parts, eq(mutasiSaldo.partId, parts.id))
    .leftJoin(plants, eq(mutasiSaldo.plantId, plants.id))
    .leftJoin(locations, eq(mutasiSaldo.locationId, locations.id))
    .where(kondisiSaldo.length ? and(...kondisiSaldo) : undefined)
    .groupBy(
      mutasiSaldo.plantId,
      mutasiSaldo.partId,
      parts.partNumber,
      parts.backNumber,
      parts.name,
      parts.uom,
      parts.project,
      plants.code,
      mutasiSaldo.locationId,
      locations.code,
      locations.name,
      locations.kind,
    )
    .having(sql`ABS(${saldoKini}) > 0.00005`)
    .as('saldo_dasar');

  const kondisiGerak = [
    ne(mutations.type, 'TRANSFER_IN'),
    gte(mutations.occurredAt, range.start),
    lt(mutations.occurredAt, range.end),
  ];
  if (params.plantId) kondisiGerak.push(eq(mutations.plantId, params.plantId));
  if (locationKind) {
    kondisiGerak.push(
      or(
        eq(locations.kind, locationKind),
        sql`EXISTS (
          SELECT 1
          FROM TT_STOCK_MUTATION mutation_in
          INNER JOIN TM_LOCATION location_in
            ON location_in.INT_ID = mutation_in.INT_LOCATION_ID
          WHERE mutation_in.CHR_TYPE = 'TRANSFER_IN'
            AND mutation_in.CHR_SOURCE_TABLE = ${mutations.sourceTable}
            AND mutation_in.INT_SOURCE_ID = ${mutations.sourceId}
            AND mutation_in.INT_PART_ID = ${mutations.partId}
            AND location_in.CHR_KIND = ${locationKind}
        )`,
      )!,
    );
  }
  if (processType) kondisiGerak.push(eq(lines.processType, processType));
  if (activity)
    kondisiGerak.push(inArray(mutations.type, MUTASI_PER_AKTIVITAS[activity] as never[]));
  if (search) {
    const term = `%${search}%`;
    kondisiGerak.push(
      or(
        like(parts.partNumber, term),
        like(parts.backNumber, term),
        like(parts.name, term),
        like(locations.code, term),
        like(locations.name, term),
        like(mutations.note, term),
        sql`EXISTS (
          SELECT 1
          FROM TT_STOCK_MUTATION mutation_in
          INNER JOIN TM_LOCATION location_in
            ON location_in.INT_ID = mutation_in.INT_LOCATION_ID
          WHERE mutation_in.CHR_TYPE = 'TRANSFER_IN'
            AND mutation_in.CHR_SOURCE_TABLE = ${mutations.sourceTable}
            AND mutation_in.INT_SOURCE_ID = ${mutations.sourceId}
            AND mutation_in.INT_PART_ID = ${mutations.partId}
            AND (
              location_in.CHR_CODE LIKE ${term}
              OR location_in.CHR_NAME LIKE ${term}
            )
        )`,
      )!,
    );
  }

  const movementWhere = and(...kondisiGerak);
  const balanceOffset = (Math.max(1, params.balancePage) - 1) * perPage;
  const movementOffset = (Math.max(1, params.movementPage) - 1) * perPage;

  const [balanceRows, balanceSummaryRows, movementRows, movementCountRows, filterPlants] =
    await Promise.all([
      db
        .select()
        .from(saldoDasar)
        .orderBy(asc(saldoDasar.partNumber), asc(saldoDasar.locationCode))
        .limit(perPage)
        .offset(balanceOffset),
      db
        .select({
          positions: count(),
          wip: sql<number>`COALESCE(SUM(CASE WHEN ${saldoDasar.locationKind} = 'WIP' THEN 1 ELSE 0 END), 0)`,
          finishGood: sql<number>`COALESCE(SUM(CASE WHEN ${saldoDasar.locationKind} = 'FINISH_GOOD' THEN 1 ELSE 0 END), 0)`,
          negative: sql<number>`COALESCE(SUM(CASE WHEN ${saldoDasar.balance} < 0 THEN 1 ELSE 0 END), 0)`,
          noSloc: sql<number>`COALESCE(SUM(CASE WHEN ${saldoDasar.locationId} IS NULL THEN 1 ELSE 0 END), 0)`,
        })
        .from(saldoDasar),
      db
        .select({
          id: mutations.id,
          plantCode: plants.code,
          partId: mutations.partId,
          partNumber: parts.partNumber,
          backNumber: parts.backNumber,
          partName: parts.name,
          uom: parts.uom,
          locationCode: locations.code,
          locationName: locations.name,
          locationKind: locations.kind,
          lineCode: lines.code,
          lineName: lines.name,
          processType: lines.processType,
          lotId: mutations.lotId,
          lotNumber: lots.lotNumber,
          type: mutations.type,
          qty: mutations.qty,
          sourceTable: mutations.sourceTable,
          sourceId: mutations.sourceId,
          npk: mutations.npk,
          occurredAt: mutations.occurredAt,
          note: mutations.note,
        })
        .from(mutations)
        .innerJoin(parts, eq(mutations.partId, parts.id))
        .leftJoin(plants, eq(mutations.plantId, plants.id))
        .leftJoin(locations, eq(mutations.locationId, locations.id))
        .leftJoin(lines, eq(mutations.lineId, lines.id))
        .leftJoin(lots, eq(mutations.lotId, lots.id))
        .where(movementWhere)
        .orderBy(desc(mutations.occurredAt), desc(mutations.id))
        .limit(perPage)
        .offset(movementOffset),
      db
        .select({ value: count() })
        .from(mutations)
        .innerJoin(parts, eq(mutations.partId, parts.id))
        .leftJoin(locations, eq(mutations.locationId, locations.id))
        .leftJoin(lines, eq(mutations.lineId, lines.id))
        .where(movementWhere),
      db
        .select({ id: plants.id, code: plants.code, name: plants.name })
        .from(plants)
        .orderBy(plants.code),
    ]);

  const sourceIds = [
    ...new Set(movementRows.map((m) => m.sourceId).filter((id): id is number => id !== null)),
  ];
  const scanIds = [
    ...new Set(
      movementRows
        .filter((m) => m.sourceTable === 'TT_HISTORY_SCAN' && m.sourceId !== null)
        .map((m) => m.sourceId as number),
    ),
  ];

  const [incoming, outboxes, sourceScans] = await Promise.all([
    sourceIds.length
      ? db
          .select({
            id: mutations.id,
            sourceTable: mutations.sourceTable,
            sourceId: mutations.sourceId,
            partId: mutations.partId,
            lotId: mutations.lotId,
            qty: mutations.qty,
            locationCode: locations.code,
            locationName: locations.name,
            lineCode: lines.code,
            lineName: lines.name,
            processType: lines.processType,
          })
          .from(mutations)
          .leftJoin(locations, eq(mutations.locationId, locations.id))
          .leftJoin(lines, eq(mutations.lineId, lines.id))
          .where(and(eq(mutations.type, 'TRANSFER_IN'), inArray(mutations.sourceId, sourceIds)))
          .orderBy(asc(mutations.id))
      : Promise.resolve([]),
    sourceIds.length
      ? db
          .select({
            sourceTable: sapOutbox.sourceTable,
            sourceId: sapOutbox.sourceId,
            docType: sapOutbox.docType,
            status: sapOutbox.status,
            sapDocNumber: sapOutbox.sapDocNumber,
            lastError: sapOutbox.lastError,
          })
          .from(sapOutbox)
          .where(inArray(sapOutbox.sourceId, sourceIds))
      : Promise.resolve([]),
    scanIds.length
      ? db
          .select({ id: scanEvents.id, processType: scanEvents.processType })
          .from(scanEvents)
          .where(inArray(scanEvents.id, scanIds))
      : Promise.resolve([]),
  ]);

  const tujuan = new Map<string, typeof incoming>();
  for (const row of incoming) {
    const key = kunciPasangan(row);
    tujuan.set(key, [...(tujuan.get(key) ?? []), row]);
  }
  const petaOutbox = new Map(
    outboxes.map((o) => [`${kunciSumber(o.sourceTable, o.sourceId)}|${o.docType}`, o]),
  );
  const prosesScan = new Map(sourceScans.map((s) => [s.id, s.processType]));

  const movements = movementRows.map((m) => {
    const kandidatPasangan = m.type === 'TRANSFER_OUT' ? tujuan.get(kunciPasangan(m)) : undefined;
    const indeksPasangan = kandidatPasangan?.findIndex((row) => row.id > m.id) ?? -1;
    const pasangan =
      indeksPasangan >= 0 ? kandidatPasangan?.splice(indeksPasangan, 1)[0] : undefined;
    const proses =
      m.processType ??
      (m.sourceTable === 'TT_HISTORY_SCAN' && m.sourceId
        ? (prosesScan.get(m.sourceId) ?? null)
        : null);
    const docType = sapMovementFor(m.type)?.docType;
    const outbox = docType
      ? petaOutbox.get(`${kunciSumber(m.sourceTable, m.sourceId)}|${docType}`)
      : undefined;
    const jenis = jenisDariMutasi(m.type);
    let fromName: string | null = null;
    let toName: string | null = null;
    const lokasi = namaLokasi(m.locationCode, m.locationName);
    const namaProses = proses ? PROCESS_LABELS[proses] : null;

    if (jenis === 'TRANSFER') {
      fromName = lokasi;
      toName = namaLokasi(pasangan?.locationCode ?? null, pasangan?.locationName ?? null);
    } else if (jenis === 'PRODUCTION') {
      fromName = namaProses ? `Hasil ${namaProses}` : 'Hasil produksi';
      toName = lokasi;
    } else if (jenis === 'CONSUMPTION') {
      fromName = lokasi;
      toName = namaProses ? `Proses ${namaProses}` : 'Produksi';
    } else if (jenis === 'RECEIVING') {
      fromName = 'Pemasok';
      toName = lokasi;
    } else if (jenis === 'DELIVERY') {
      fromName = lokasi;
      toName = 'Customer';
    } else if (jenis === 'NG') {
      fromName = lokasi;
      toName = 'Area NG';
    } else if (jenis === 'STOCK_TAKE') {
      fromName = 'Saldo sistem';
      toName = 'Hasil hitung fisik';
    } else {
      fromName = lokasi;
      toName = 'Koreksi saldo';
    }

    return {
      ...m,
      qty: Math.abs(Number(m.qty)),
      activity: jenis,
      activityLabel: LABEL_AKTIVITAS[jenis],
      processType: proses,
      processLabel: proses ? PROCESS_LABELS[proses] : null,
      processStage: tahapProses(proses),
      fromName: fromName ?? 'Belum ditentukan',
      toName: toName ?? 'Belum ditentukan',
      destinationProcessType: pasangan?.processType ?? null,
      destinationLineCode: pasangan?.lineCode ?? null,
      sapStatus: outbox?.status ?? null,
      sapDocNumber: outbox?.sapDocNumber ?? null,
      sapError: outbox?.lastError ?? null,
    };
  });

  const balancePartIds = [...new Set(balanceRows.map((b) => b.partId))];
  const routeRows = balancePartIds.length
    ? await db
        .select({
          partId: partProcesses.partId,
          processType: partProcesses.processType,
          seqNo: partProcesses.seqNo,
        })
        .from(partProcesses)
        .where(and(inArray(partProcesses.partId, balancePartIds), eq(partProcesses.isActive, true)))
        .orderBy(asc(partProcesses.partId), asc(partProcesses.seqNo))
    : [];
  const routeByPart = new Map<number, string[]>();
  for (const r of routeRows) {
    routeByPart.set(r.partId, [
      ...(routeByPart.get(r.partId) ?? []),
      PROCESS_LABELS[r.processType],
    ]);
  }

  const summary = balanceSummaryRows[0];
  const balanceTotal = Number(summary?.positions ?? 0);
  const movementTotal = Number(movementCountRows[0]?.value ?? 0);
  return {
    filters: {
      search: search ?? '',
      plantId: params.plantId ?? null,
      processType: processType ?? '',
      locationKind: locationKind ?? '',
      activity: activity ?? '',
      from: range.from,
      to: range.to,
    },
    options: { plants: filterPlants },
    summary: {
      positions: balanceTotal,
      wip: Number(summary?.wip ?? 0),
      finishGood: Number(summary?.finishGood ?? 0),
      negative: Number(summary?.negative ?? 0),
      noSloc: Number(summary?.noSloc ?? 0),
      movements: movementTotal,
    },
    balances: balanceRows.map((b) => ({
      ...b,
      balance: Number(b.balance),
      route: routeByPart.get(b.partId) ?? [],
    })),
    balanceMeta: {
      page: Math.max(1, params.balancePage),
      perPage,
      total: balanceTotal,
      totalPages: Math.max(1, Math.ceil(balanceTotal / perPage)),
    },
    movements,
    movementMeta: {
      page: Math.max(1, params.movementPage),
      perPage,
      total: movementTotal,
      totalPages: Math.max(1, Math.ceil(movementTotal / perPage)),
    },
  };
}
