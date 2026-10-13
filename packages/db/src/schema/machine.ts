import { index, integer, jsonb, timestamp, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { daftarNilai, enumCol, fk, machineSchema, pk, timestamps } from './_shared';
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
export const machineEvents = machineSchema.table(
  'TT_MACHINE_EVENT',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    machineId: fk('INT_MACHINE_ID').references(() => machines.id),
    type: enumCol('CHR_TYPE', MACHINE_EVENT_TYPES).notNull(),
    /** Sumber data: mesin kirim sendiri (MQTT) atau hasil tarikan dari J922. */
    source: enumCol('CHR_SOURCE', ['MQTT', 'J922_SYNC', 'MANUAL']).notNull(),
    status: varchar('CHR_STATUS', { length: 64 }),
    shotCount: integer('INT_SHOT_COUNT'),
    occurredAt: timestamp('DTM_OCCURRED_AT', { withTimezone: true, mode: 'date' }).notNull(),
    /** Idempotensi: MQTT at-least-once dan sync bisa mengirim ulang baris yang sama. */
    dedupeKey: varchar('CHR_DEDUPE_KEY', { length: 128 }),
    payload: jsonb('CHR_PAYLOAD'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_MACHINE_EVENT_MACHINE_TIME_IDX').on(t.machineId, t.occurredAt),
    index('TT_MACHINE_EVENT_TYPE_TIME_IDX').on(t.type, t.occurredAt),
    index('TT_MACHINE_EVENT_DEDUPE_IDX').on(t.dedupeKey),
  
    daftarNilai('TT_MACHINE_EVENT_CHR_TYPE_CHK', t.type, MACHINE_EVENT_TYPES),
    daftarNilai('TT_MACHINE_EVENT_CHR_SOURCE_CHK', t.source, ['MQTT', 'J922_SYNC', 'MANUAL']),
  ],
);

export const machineEventsRelations = relations(machineEvents, ({ one }) => ({
  plant: one(plants, { fields: [machineEvents.plantId], references: [plants.id] }),
  machine: one(machines, { fields: [machineEvents.machineId], references: [machines.id] }),
}));
