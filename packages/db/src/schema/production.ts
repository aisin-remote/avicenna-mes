import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  time,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import {
  daftarNilai,
  enumCol,
  fk,
  pk,
  productionSchema,
  timestamps,
  type ProcessType,
} from './_shared';
import { lines, parts, customers, machines, processTypes } from './master';
import { plants, users, devices } from './org';

/**
 * Rencana produksi per hari per line.
 *
 * Versi bella menyimpan line/customer/back_no sebagai string lepas. Di sini
 * dinormalisasi jadi FK supaya rename master data tidak memutus data historis,
 * dan report bisa join tanpa pencocokan string.
 */
export const productionPlans = productionSchema.table(
  'TT_PRODUCTION_PLAN',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID')
      .notNull()
      .references(() => lines.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    customerId: fk('INT_CUSTOMER_ID').references(() => customers.id),
    planDate: date('DTM_PLAN_DATE', { mode: 'string' }).notNull(),
    /** Cycle / rit pengiriman ke berapa dalam satu hari. */
    cycle: integer('INT_CYCLE').notNull().default(1),
    seqNo: integer('INT_SEQ_NO').notNull().default(0),
    orderQty: integer('INT_ORDER_QTY').notNull().default(0),
    directPullingQty: integer('INT_DIRECT_PULLING_QTY').notNull().default(0),
    stockChuteQty: integer('INT_STOCK_CHUTE_QTY').notNull().default(0),
    dock: varchar('CHR_DOCK', { length: 32 }),
    dnNumber: varchar('CHR_DN_NUMBER', { length: 64 }),
    workingStart: time('DTM_WORKING_START'),
    workingEnd: time('DTM_WORKING_END'),
    deliveryTime: time('DTM_DELIVERY_TIME'),
    actualStartAt: timestamp('DTM_ACTUAL_START_AT', { withTimezone: true, mode: 'date' }),
    actualEndAt: timestamp('DTM_ACTUAL_END_AT', { withTimezone: true, mode: 'date' }),
    planSource: enumCol('CHR_PLAN_SOURCE', ['MANUAL', 'IMPORT', 'STATIC_SEQ', 'API'])
      .notNull()
      .default('MANUAL'),
    status: enumCol('CHR_STATUS', ['DRAFT', 'RELEASED', 'RUNNING', 'DONE', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    ...timestamps,
  },
  (t) => [
    index('TT_PRODUCTION_PLAN_DATE_LINE_IDX').on(t.planDate, t.lineId),
    index('TT_PRODUCTION_PLAN_PART_DATE_IDX').on(t.partId, t.planDate),
    uniqueIndex('TT_PRODUCTION_PLAN_SLOT_UNIQUE').on(t.lineId, t.planDate, t.cycle, t.seqNo),

    daftarNilai('TT_PRODUCTION_PLAN_CHR_PLAN_SOURCE_CHK', t.planSource, [
      'MANUAL',
      'IMPORT',
      'STATIC_SEQ',
      'API',
    ]),
    daftarNilai('TT_PRODUCTION_PLAN_CHR_STATUS_CHK', t.status, [
      'DRAFT',
      'RELEASED',
      'RUNNING',
      'DONE',
      'CANCELLED',
    ]),
  ],
);

export const SCAN_KINDS = [
  'PRODUCTION',
  'PULLING',
  'DELIVERY',
  'RECEIVING',
  'INSPECTION',
  'STOCK_TAKE',
] as const;

/**
 * Ledger tunggal untuk semua kejadian scan di lapangan.
 *
 * Menggantikan tabel-tabel trace terpisah avicenna (avi_trace_casting,
 * avi_trace_machining, avi_trace_assembling, avi_trace_delivery, ...) yang
 * strukturnya berulang. Pembeda ada di `kind` + `processType`.
 *
 * Tabel ini akan jadi yang paling cepat membesar. Rencanakan partisi per bulan
 * pada `scanned_at` sebelum masuk produksi.
 *
 * ATURAN: append-only, sama seperti kanban_events.
 */
export const scanEvents = productionSchema.table(
  'TT_HISTORY_SCAN',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    kind: enumCol('CHR_KIND', SCAN_KINDS).notNull(),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    partId: fk('INT_PART_ID').references(() => parts.id),
    machineId: fk('INT_MACHINE_ID').references(() => machines.id),
    productionPlanId: fk('INT_PRODUCTION_PLAN_ID'),
    /** Isi barcode mentah, disimpan apa adanya untuk audit & investigasi. */
    rawCode: varchar('CHR_RAW_CODE', { length: 255 }).notNull(),
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }),
    qty: integer('INT_QTY').notNull().default(1),
    userId: fk('INT_USER_ID').references(() => users.id),
    deviceId: fk('INT_DEVICE_ID').references(() => devices.id),
    scannedAt: timestamp('DTM_SCANNED_AT', { withTimezone: true, mode: 'date' }).notNull(),
    /**
     * Kunci idempoten. Scanner di pabrik sering mengirim ulang saat jaringan
     * putus-nyambung; unique index di sini yang mencegah dobel, bukan logika app.
     */
    dedupeKey: varchar('CHR_DEDUPE_KEY', { length: 128 }).notNull(),
    meta: jsonb('CHR_META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    /*
     * Nama constraint ditulis eksplisit.
     *
     * Nama bawaan Drizzle merangkai tabel + kolom di kedua sisi, dan setelah
     * kolom memakai prefiks INT_/CHR_ hasilnya melewati batas 64 karakter milik
     * MySQL. Migrasi di database yang SUDAH ada tetap jalan — rename kolom tidak
     * menyentuh nama constraint — sehingga kegagalannya hanya muncul saat
     * membuat database dari nol: di CI, di laptop orang baru, dan di produksi.
     */
    foreignKey({
      name: 'TT_HISTORY_SCAN_PROD_PLAN_FK',
      columns: [t.productionPlanId],
      foreignColumns: [productionPlans.id],
    }),
    uniqueIndex('TT_HISTORY_SCAN_DEDUPE_UNIQUE').on(t.dedupeKey),
    index('TT_HISTORY_SCAN_TIME_IDX').on(t.scannedAt),
    index('TT_HISTORY_SCAN_LINE_KIND_TIME_IDX').on(t.lineId, t.kind, t.scannedAt),
    index('TT_HISTORY_SCAN_PART_TIME_IDX').on(t.partId, t.scannedAt),
    index('TT_HISTORY_SCAN_SERIAL_IDX').on(t.serialNumber),
    index('TT_HISTORY_SCAN_DELIVERY_PHASE_IDX')
      .on(sql`(${t.meta}->>'deliveryId')`, sql`(${t.meta}->>'phase')`, t.id)
      .where(sql`${t.kind} = 'DELIVERY'`),
    /*
     * Barcode + proses.
     *
     * DUA pemeriksaan terpanas di seluruh sistem menyaring dengan kolom ini,
     * dan keduanya berjalan pada SETIAP scan produksi:
     *
     *   1. "barcode ini sudah pernah discan di proses ini?"  (station)
     *   2. "proses sebelumnya di rute part ini sudah discan?" (ingestOne)
     *
     * Tanpa index, keduanya memindai seluruh tabel. Di meja pengembang dengan
     * 48 baris itu tidak terasa sama sekali; di lantai produksi tabel ini
     * bertambah belasan juta baris per tahun, dan dua pemindaian penuh per scan
     * membuat layar operator menggantung makin lama setiap minggunya — tanpa
     * satu pun galat yang menunjukkan sebabnya.
     *
     * Urutan kolomnya: CHR_RAW_CODE lebih dulu karena itu yang paling memilah,
     * lalu CHR_PROCESS_TYPE. DTM_SCANNED_AT ikut supaya pencarian scan produksi
     * TERAKHIR pada sebuah barang (pencatatan NG) tidak perlu mengurutkan lagi.
     */
    index('TT_HISTORY_SCAN_RAW_PROCESS_IDX').on(t.rawCode, t.processType, t.scannedAt),

    daftarNilai('TT_HISTORY_SCAN_CHR_KIND_CHK', t.kind, SCAN_KINDS),
  ],
);

export const productionPlansRelations = relations(productionPlans, ({ one, many }) => ({
  plant: one(plants, { fields: [productionPlans.plantId], references: [plants.id] }),
  line: one(lines, { fields: [productionPlans.lineId], references: [lines.id] }),
  part: one(parts, { fields: [productionPlans.partId], references: [parts.id] }),
  customer: one(customers, { fields: [productionPlans.customerId], references: [customers.id] }),
  scans: many(scanEvents),
}));

export const scanEventsRelations = relations(scanEvents, ({ one }) => ({
  plant: one(plants, { fields: [scanEvents.plantId], references: [plants.id] }),
  line: one(lines, { fields: [scanEvents.lineId], references: [lines.id] }),
  part: one(parts, { fields: [scanEvents.partId], references: [parts.id] }),
  machine: one(machines, { fields: [scanEvents.machineId], references: [machines.id] }),
  user: one(users, { fields: [scanEvents.userId], references: [users.id] }),
  device: one(devices, { fields: [scanEvents.deviceId], references: [devices.id] }),
  productionPlan: one(productionPlans, {
    fields: [scanEvents.productionPlanId],
    references: [productionPlans.id],
  }),
}));
