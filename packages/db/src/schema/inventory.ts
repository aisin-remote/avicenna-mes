import {
  mysqlTable,
  varchar,
  int,
  date,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
  json,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, lines } from './master';
import { plants, users } from './org';

export const locations = mysqlTable(
  'locations',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    kind: mysqlEnum('kind', ['WIP', 'FINISH_GOOD', 'CHUTE', 'NG', 'TRANSIT']).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('locations_plant_code_unique').on(t.plantId, t.code)],
);

export const MUTATION_TYPES = [
  'PRODUCTION_IN',
  'DELIVERY_OUT',
  'NG_OUT',
  'ADJUSTMENT',
  'STOCK_TAKE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RECEIVING_IN',
] as const;

/**
 * Buku besar pergerakan stok — append-only.
 *
 * `qty` bertanda: positif menambah, negatif mengurangi. Saldo tidak pernah
 * di-UPDATE di sini; koreksi dicatat sebagai baris ADJUSTMENT baru sehingga
 * jejak audit untuk customer tetap utuh.
 */
export const mutations = mysqlTable(
  'mutations',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    locationId: fk('location_id').references(() => locations.id),
    lineId: fk('line_id').references(() => lines.id),
    type: mysqlEnum('type', MUTATION_TYPES).notNull(),
    /** Bertanda: + masuk, - keluar. */
    qty: int('qty').notNull(),
    /** Tabel + id asal (scan_events, quality_inspections, deliveries, ...). */
    sourceTable: varchar('source_table', { length: 64 }),
    sourceId: fk('source_id'),
    npk: varchar('npk', { length: 32 }),
    userId: fk('user_id').references(() => users.id),
    occurredAt: timestamp('occurred_at').notNull(),
    note: varchar('note', { length: 255 }),
    meta: json('meta'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('mutations_part_time_idx').on(t.partId, t.occurredAt),
    index('mutations_type_time_idx').on(t.type, t.occurredAt),
    index('mutations_source_idx').on(t.sourceTable, t.sourceId),
  ],
);

/**
 * Saldo stok harian — turunan (cache) dari `mutations`, bukan sumber kebenaran.
 * Bisa dibangun ulang kapan saja dari ledger. Diperbarui worker, bukan request web.
 */
export const stockBalances = mysqlTable(
  'stock_balances',
  {
    id: pk(),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    locationId: fk('location_id').references(() => locations.id),
    balanceDate: date('balance_date', { mode: 'string' }).notNull(),
    openingQty: int('opening_qty').notNull().default(0),
    inQty: int('in_qty').notNull().default(0),
    outQty: int('out_qty').notNull().default(0),
    closingQty: int('closing_qty').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stock_balances_unique').on(t.partId, t.locationId, t.balanceDate),
    index('stock_balances_date_idx').on(t.balanceDate),
  ],
);

export const mutationsRelations = relations(mutations, ({ one }) => ({
  plant: one(plants, { fields: [mutations.plantId], references: [plants.id] }),
  part: one(parts, { fields: [mutations.partId], references: [parts.id] }),
  location: one(locations, { fields: [mutations.locationId], references: [locations.id] }),
  user: one(users, { fields: [mutations.userId], references: [users.id] }),
}));

export const stockBalancesRelations = relations(stockBalances, ({ one }) => ({
  part: one(parts, { fields: [stockBalances.partId], references: [parts.id] }),
  location: one(locations, { fields: [stockBalances.locationId], references: [locations.id] }),
}));
