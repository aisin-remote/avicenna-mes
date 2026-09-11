import {
  mysqlTable,
  varchar,
  int,
  date,
  time,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
  json,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps, PROCESS_TYPES } from './_shared';
import { lines, parts, customers, machines } from './master';
import { plants, users, devices } from './org';

/**
 * Rencana produksi per hari per line.
 *
 * Versi bella menyimpan line/customer/back_no sebagai string lepas. Di sini
 * dinormalisasi jadi FK supaya rename master data tidak memutus data historis,
 * dan report bisa join tanpa pencocokan string.
 */
export const productionPlans = mysqlTable(
  'TT_PRODUCTION_PLAN',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('LINE_ID')
      .notNull()
      .references(() => lines.id),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    customerId: fk('CUSTOMER_ID').references(() => customers.id),
    planDate: date('PLAN_DATE', { mode: 'string' }).notNull(),
    /** Cycle / rit pengiriman ke berapa dalam satu hari. */
    cycle: int('CYCLE').notNull().default(1),
    seqNo: int('SEQ_NO').notNull().default(0),
    orderQty: int('ORDER_QTY').notNull().default(0),
    directPullingQty: int('DIRECT_PULLING_QTY').notNull().default(0),
    stockChuteQty: int('STOCK_CHUTE_QTY').notNull().default(0),
    dock: varchar('DOCK', { length: 32 }),
    dnNumber: varchar('DN_NUMBER', { length: 64 }),
    workingStart: time('WORKING_START'),
    workingEnd: time('WORKING_END'),
    deliveryTime: time('DELIVERY_TIME'),
    actualStartAt: timestamp('ACTUAL_START_AT'),
    actualEndAt: timestamp('ACTUAL_END_AT'),
    planSource: mysqlEnum('PLAN_SOURCE', ['MANUAL', 'IMPORT', 'STATIC_SEQ', 'API']).notNull().default('MANUAL'),
    status: mysqlEnum('STATUS', ['DRAFT', 'RELEASED', 'RUNNING', 'DONE', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    ...timestamps,
  },
  (t) => [
    index('TT_PRODUCTION_PLAN_DATE_LINE_IDX').on(t.planDate, t.lineId),
    index('TT_PRODUCTION_PLAN_PART_DATE_IDX').on(t.partId, t.planDate),
    uniqueIndex('TT_PRODUCTION_PLAN_SLOT_UNIQUE').on(t.lineId, t.planDate, t.cycle, t.seqNo),
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
export const scanEvents = mysqlTable(
  'TT_HISTORY_SCAN',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    kind: mysqlEnum('KIND', SCAN_KINDS).notNull(),
    processType: mysqlEnum('PROCESS_TYPE', PROCESS_TYPES),
    lineId: fk('LINE_ID').references(() => lines.id),
    partId: fk('PART_ID').references(() => parts.id),
    machineId: fk('MACHINE_ID').references(() => machines.id),
    productionPlanId: fk('PRODUCTION_PLAN_ID').references(() => productionPlans.id),
    /** Isi barcode mentah, disimpan apa adanya untuk audit & investigasi. */
    rawCode: varchar('RAW_CODE', { length: 255 }).notNull(),
    serialNumber: varchar('SERIAL_NUMBER', { length: 64 }),
    qty: int('QTY').notNull().default(1),
    userId: fk('USER_ID').references(() => users.id),
    deviceId: fk('DEVICE_ID').references(() => devices.id),
    scannedAt: timestamp('SCANNED_AT').notNull(),
    /**
     * Kunci idempoten. Scanner di pabrik sering mengirim ulang saat jaringan
     * putus-nyambung; unique index di sini yang mencegah dobel, bukan logika app.
     */
    dedupeKey: varchar('DEDUPE_KEY', { length: 128 }).notNull(),
    meta: json('META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('TT_HISTORY_SCAN_DEDUPE_UNIQUE').on(t.dedupeKey),
    index('TT_HISTORY_SCAN_TIME_IDX').on(t.scannedAt),
    index('TT_HISTORY_SCAN_LINE_KIND_TIME_IDX').on(t.lineId, t.kind, t.scannedAt),
    index('TT_HISTORY_SCAN_PART_TIME_IDX').on(t.partId, t.scannedAt),
    index('TT_HISTORY_SCAN_SERIAL_IDX').on(t.serialNumber),
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
