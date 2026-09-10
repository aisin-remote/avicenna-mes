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
  'kanbans',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    customerId: fk('customer_id').references(() => customers.id),
    /** Nomor seri tercetak di kartu — unik per pabrik, dipakai saat scan. */
    serialNumber: varchar('serial_number', { length: 64 }).notNull(),
    qty: int('qty').notNull(),
    status: mysqlEnum('status', KANBAN_STATUSES).notNull().default('CREATED'),
    producedAt: timestamp('produced_at'),
    deliveredAt: timestamp('delivered_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('kanbans_plant_serial_unique').on(t.plantId, t.serialNumber),
    index('kanbans_part_status_idx').on(t.partId, t.status),
    index('kanbans_status_created_idx').on(t.status, t.createdAt),
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
  'kanban_events',
  {
    id: pk(),
    kanbanId: fk('kanban_id')
      .notNull()
      .references(() => kanbans.id, { onDelete: 'cascade' }),
    type: mysqlEnum('type', KANBAN_EVENT_TYPES).notNull(),
    lineId: fk('line_id').references(() => lines.id),
    /** Kanban pasangan, dipakai saat type = PAIRED (body <-> part). */
    pairedKanbanId: fk('paired_kanban_id'),
    qty: int('qty'),
    userId: fk('user_id').references(() => users.id),
    deviceId: fk('device_id').references(() => devices.id),
    occurredAt: timestamp('occurred_at').notNull(),
    /** Payload tambahan spesifik per tipe event. Jangan taruh data yang perlu di-query di sini. */
    meta: json('meta'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('kanban_events_kanban_idx').on(t.kanbanId, t.occurredAt),
    index('kanban_events_type_time_idx').on(t.type, t.occurredAt),
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
