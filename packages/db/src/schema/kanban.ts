import {
  mysqlTable,
  varchar,
  int,
  mysqlEnum,
  timestamp,
  uniqueIndex,
  index,
  json,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, customers, lines } from './master';
import { plants, users, devices } from './org';

export const KANBAN_STATUSES = [
  'CREATED',
  'PRODUCED',
  'STORED',
  'PULLED',
  'LOADED',
  'DELIVERED',
  'CANCELLED',
] as const;

/**
 * Kanban = satu kartu / satu kemasan berisi qty tertentu.
 * Kolom `status` adalah state saat ini; riwayat lengkapnya ada di `kanban_events`.
 */
export const kanbans = mysqlTable(
  'TM_KANBAN',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    customerId: fk('INT_CUSTOMER_ID').references(() => customers.id),
    /** Nomor seri tercetak di kartu — unik per pabrik, dipakai saat scan. */
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }).notNull(),
    qty: int('INT_QTY').notNull(),
    status: mysqlEnum('CHR_STATUS', KANBAN_STATUSES).notNull().default('CREATED'),
    producedAt: timestamp('DTM_PRODUCED_AT'),
    deliveredAt: timestamp('DTM_DELIVERED_AT'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_KANBAN_PLANT_SERIAL_UNIQUE').on(t.plantId, t.serialNumber),
    index('TM_KANBAN_PART_STATUS_IDX').on(t.partId, t.status),
    index('TM_KANBAN_STATUS_CREATED_IDX').on(t.status, t.createdAt),
  ],
);

export const KANBAN_EVENT_TYPES = [
  'PRODUCED',
  'PULLED',
  'PAIRED',
  'STORED',
  'LOADED',
  'DELIVERED',
  'CANCELLED',
  'ADJUSTED',
] as const;

/**
 * Log append-only perjalanan kanban.
 *
 * Ini menggantikan tiga tabel terpisah di bella:
 *   kanban_after_prods + kanban_after_pulls + body_kanban_pairings
 * menjadi satu tabel dengan diskriminator `type`.
 *
 * Alasannya: tiga tabel itu strukturnya hampir identik dan setiap penambahan
 * tahap baru memaksa bikin tabel baru. Dengan event log, tahap baru cukup
 * menambah nilai enum.
 *
 * ATURAN: baris di sini tidak pernah di-UPDATE atau di-DELETE. Koreksi
 * dilakukan dengan menambah event ADJUSTED.
 */
export const kanbanEvents = mysqlTable(
  'TT_KANBAN_EVENT',
  {
    id: pk(),
    kanbanId: fk('INT_KANBAN_ID')
      .notNull()
      .references(() => kanbans.id, { onDelete: 'cascade' }),
    type: mysqlEnum('CHR_TYPE', KANBAN_EVENT_TYPES).notNull(),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    /** Kanban pasangan, dipakai saat type = PAIRED (body <-> part). */
    pairedKanbanId: fk('INT_PAIRED_KANBAN_ID'),
    qty: int('INT_QTY'),
    userId: fk('INT_USER_ID').references(() => users.id),
    deviceId: fk('INT_DEVICE_ID').references(() => devices.id),
    occurredAt: timestamp('DTM_OCCURRED_AT').notNull(),
    /** Payload tambahan spesifik per tipe event. Jangan taruh data yang perlu di-query di sini. */
    meta: json('CHR_META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_KANBAN_EVENT_KANBAN_IDX').on(t.kanbanId, t.occurredAt),
    index('TT_KANBAN_EVENT_TYPE_TIME_IDX').on(t.type, t.occurredAt),
  ],
);

export const kanbansRelations = relations(kanbans, ({ one, many }) => ({
  plant: one(plants, { fields: [kanbans.plantId], references: [plants.id] }),
  part: one(parts, { fields: [kanbans.partId], references: [parts.id] }),
  customer: one(customers, { fields: [kanbans.customerId], references: [customers.id] }),
  events: many(kanbanEvents),
}));

export const kanbanEventsRelations = relations(kanbanEvents, ({ one }) => ({
  kanban: one(kanbans, { fields: [kanbanEvents.kanbanId], references: [kanbans.id] }),
  line: one(lines, { fields: [kanbanEvents.lineId], references: [lines.id] }),
  user: one(users, { fields: [kanbanEvents.userId], references: [users.id] }),
  device: one(devices, { fields: [kanbanEvents.deviceId], references: [devices.id] }),
}));
