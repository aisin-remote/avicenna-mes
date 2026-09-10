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
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, customers } from './master';
import { plants, users } from './org';

/**
 * Surat jalan / loading list. Gabungan LoadingList + Manifest + ExternalDelivery
 * milik bella dan avi_trace_delivery milik avicenna.
 */
export const deliveries = mysqlTable(
  'deliveries',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    customerId: fk('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Nomor surat jalan / DN. */
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    manifestNumber: varchar('manifest_number', { length: 64 }),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    cycle: int('cycle').notNull().default(1),
    dock: varchar('dock', { length: 32 }),
    planTime: time('plan_time'),
    departedAt: timestamp('departed_at'),
    arrivedAt: timestamp('arrived_at'),
    status: mysqlEnum('status', ['DRAFT', 'LOADING', 'LOADED', 'SHIPPED', 'RECEIVED', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    truckNumber: varchar('truck_number', { length: 32 }),
    driverName: varchar('driver_name', { length: 128 }),
    createdById: fk('created_by_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('deliveries_plant_document_unique').on(t.plantId, t.documentNumber),
    index('deliveries_date_customer_idx').on(t.deliveryDate, t.customerId),
    index('deliveries_status_idx').on(t.status),
  ],
);

export const deliveryLines = mysqlTable(
  'delivery_lines',
  {
    id: pk(),
    deliveryId: fk('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    planQty: int('plan_qty').notNull().default(0),
    actualQty: int('actual_qty').notNull().default(0),
    kanbanCount: int('kanban_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('delivery_lines_unique').on(t.deliveryId, t.partId),
    index('delivery_lines_part_idx').on(t.partId),
  ],
);

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  plant: one(plants, { fields: [deliveries.plantId], references: [plants.id] }),
  customer: one(customers, { fields: [deliveries.customerId], references: [customers.id] }),
  lines: many(deliveryLines),
}));

export const deliveryLinesRelations = relations(deliveryLines, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryLines.deliveryId], references: [deliveries.id] }),
  part: one(parts, { fields: [deliveryLines.partId], references: [parts.id] }),
}));
