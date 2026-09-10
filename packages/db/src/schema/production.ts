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
  'production_plans',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    lineId: fk('line_id')
      .notNull()
      .references(() => lines.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    customerId: fk('customer_id').references(() => customers.id),
    planDate: date('plan_date', { mode: 'string' }).notNull(),
    /** Cycle / rit pengiriman ke berapa dalam satu hari. */
    cycle: int('cycle').notNull().default(1),
    seqNo: int('seq_no').notNull().default(0),
    orderQty: int('order_qty').notNull().default(0),
    directPullingQty: int('direct_pulling_qty').notNull().default(0),
    stockChuteQty: int('stock_chute_qty').notNull().default(0),
    dock: varchar('dock', { length: 32 }),
    dnNumber: varchar('dn_number', { length: 64 }),
    workingStart: time('working_start'),
    workingEnd: time('working_end'),
    deliveryTime: time('delivery_time'),
    actualStartAt: timestamp('actual_start_at'),
    actualEndAt: timestamp('actual_end_at'),
    planSource: mysqlEnum('plan_source', ['MANUAL', 'IMPORT', 'STATIC_SEQ', 'API']).notNull().default('MANUAL'),
    status: mysqlEnum('status', ['DRAFT', 'RELEASED', 'RUNNING', 'DONE', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    ...timestamps,
  },
  (t) => [
    index('production_plans_date_line_idx').on(t.planDate, t.lineId),
    index('production_plans_part_date_idx').on(t.partId, t.planDate),
    uniqueIndex('production_plans_slot_unique').on(t.lineId, t.planDate, t.cycle, t.seqNo),
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
  'scan_events',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    kind: mysqlEnum('kind', SCAN_KINDS).notNull(),
    processType: mysqlEnum('process_type', PROCESS_TYPES),
    lineId: fk('line_id').references(() => lines.id),
    partId: fk('part_id').references(() => parts.id),
    machineId: fk('machine_id').references(() => machines.id),
    productionPlanId: fk('production_plan_id').references(() => productionPlans.id),
    /** Isi barcode mentah, disimpan apa adanya untuk audit & investigasi. */
    rawCode: varchar('raw_code', { length: 255 }).notNull(),
    serialNumber: varchar('serial_number', { length: 64 }),
    qty: int('qty').notNull().default(1),
    userId: fk('user_id').references(() => users.id),
    deviceId: fk('device_id').references(() => devices.id),
    scannedAt: timestamp('scanned_at').notNull(),
    /**
     * Kunci idempoten. Scanner di pabrik sering mengirim ulang saat jaringan
     * putus-nyambung; unique index di sini yang mencegah dobel, bukan logika app.
     */
    dedupeKey: varchar('dedupe_key', { length: 128 }).notNull(),
    meta: json('meta'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex('scan_events_dedupe_unique').on(t.dedupeKey),
    index('scan_events_time_idx').on(t.scannedAt),
    index('scan_events_line_kind_time_idx').on(t.lineId, t.kind, t.scannedAt),
    index('scan_events_part_time_idx').on(t.partId, t.scannedAt),
    index('scan_events_serial_idx').on(t.serialNumber),
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
