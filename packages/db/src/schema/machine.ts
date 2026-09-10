import { mysqlTable, varchar, int, timestamp, mysqlEnum, index, json } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { machines } from './master';
import { plants } from './org';

export const MACHINE_EVENT_TYPES = [
  'SHOT',
  'CYCLE_END',
  'ALARM',
  'DOWNTIME_START',
  'DOWNTIME_END',
  'STATUS_CHANGE',
  'DANDORI_START',
  'DANDORI_END',
] as const;

/**
 * Event mesin dari MQTT dan hasil sync SQL Server J922.
 *
 * Ditulis oleh worker (apps/api), tidak pernah oleh web app. Ini yang
 * menggantikan andon + polling langsung ke SQL Server dari request web
 * di sistem lama.
 */
export const machineEvents = mysqlTable(
  'machine_events',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    machineId: fk('machine_id').references(() => machines.id),
    type: mysqlEnum('type', MACHINE_EVENT_TYPES).notNull(),
    /** Sumber data: mesin kirim sendiri (MQTT) atau hasil tarikan dari J922. */
    source: mysqlEnum('source', ['MQTT', 'J922_SYNC', 'MANUAL']).notNull(),
    status: varchar('status', { length: 64 }),
    shotCount: int('shot_count'),
    occurredAt: timestamp('occurred_at').notNull(),
    /** Idempotensi: MQTT at-least-once dan sync bisa mengirim ulang baris yang sama. */
    dedupeKey: varchar('dedupe_key', { length: 128 }),
    payload: json('payload'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('machine_events_machine_time_idx').on(t.machineId, t.occurredAt),
    index('machine_events_type_time_idx').on(t.type, t.occurredAt),
    index('machine_events_dedupe_idx').on(t.dedupeKey),
  ],
);

export const machineEventsRelations = relations(machineEvents, ({ one }) => ({
  plant: one(plants, { fields: [machineEvents.plantId], references: [plants.id] }),
  machine: one(machines, { fields: [machineEvents.machineId], references: [machines.id] }),
}));
