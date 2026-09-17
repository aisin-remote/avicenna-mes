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
  'TT_MACHINE_EVENT',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    machineId: fk('INT_MACHINE_ID').references(() => machines.id),
    type: mysqlEnum('CHR_TYPE', MACHINE_EVENT_TYPES).notNull(),
    /** Sumber data: mesin kirim sendiri (MQTT) atau hasil tarikan dari J922. */
    source: mysqlEnum('CHR_SOURCE', ['MQTT', 'J922_SYNC', 'MANUAL']).notNull(),
    status: varchar('CHR_STATUS', { length: 64 }),
    shotCount: int('INT_SHOT_COUNT'),
    occurredAt: timestamp('DTM_OCCURRED_AT').notNull(),
    /** Idempotensi: MQTT at-least-once dan sync bisa mengirim ulang baris yang sama. */
    dedupeKey: varchar('CHR_DEDUPE_KEY', { length: 128 }),
    payload: json('CHR_PAYLOAD'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_MACHINE_EVENT_MACHINE_TIME_IDX').on(t.machineId, t.occurredAt),
    index('TT_MACHINE_EVENT_TYPE_TIME_IDX').on(t.type, t.occurredAt),
    index('TT_MACHINE_EVENT_DEDUPE_IDX').on(t.dedupeKey),
  ],
);

export const machineEventsRelations = relations(machineEvents, ({ one }) => ({
  plant: one(plants, { fields: [machineEvents.plantId], references: [plants.id] }),
  machine: one(machines, { fields: [machineEvents.machineId], references: [machines.id] }),
}));
