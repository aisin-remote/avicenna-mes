import {
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  varchar,
  check,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fk, logisticsSchema, pk, timestamps } from './_shared';
import { plants, users } from './org';
import { customers } from './master';
import { deliveryOrders } from './delivery';

export const driverDestinations = logisticsSchema.table(
  'TM_DRIVER_DESTINATION',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    dock: varchar('CHR_DOCK', { length: 32 }).notNull(),
    logistic: varchar('CHR_LOGISTIC', { length: 128 }).notNull(),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_DRIVER_DESTINATION_CODE_UNIQUE').on(t.plantId, t.code)],
);

export const driverAttendances = logisticsSchema.table(
  'TT_DRIVER_ATTENDANCE',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    slot: integer('INT_SLOT').notNull(),
    destinationId: fk('INT_DESTINATION_ID').notNull(),
    destinationName: varchar('CHR_DESTINATION_NAME', { length: 128 }).notNull(),
    dock: varchar('CHR_DOCK', { length: 32 }).notNull(),
    logistic: varchar('CHR_LOGISTIC', { length: 128 }).notNull(),
    cycle: integer('INT_CYCLE').notNull(),
    helmet: boolean('FLG_HELMET').notNull(),
    vest: boolean('FLG_VEST').notNull(),
    shoes: boolean('FLG_SHOES').notNull(),
    photo: varchar('CHR_PHOTO', { length: 64 }).notNull(),
    startedAt: timestamp('DTM_STARTED_AT', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('DTM_ENDED_AT', { withTimezone: true, mode: 'date' }),
    startedById: fk('INT_STARTED_BY_ID').references(() => users.id),
    endedById: fk('INT_ENDED_BY_ID').references(() => users.id),
  },
  (t) => [
    foreignKey({
      name: 'TT_DRIVER_ATTENDANCE_DEST_FK',
      columns: [t.destinationId],
      foreignColumns: [driverDestinations.id],
    }),
    uniqueIndex('TT_DRIVER_ATTENDANCE_ACTIVE_SLOT_UNIQUE')
      .on(t.plantId, t.slot)
      .where(sql`${t.endedAt} IS NULL`),
    check('TT_DRIVER_ATTENDANCE_SLOT_CHK', sql`${t.slot} IN (1, 2)`),
    check('TT_DRIVER_ATTENDANCE_CYCLE_CHK', sql`${t.cycle} BETWEEN 1 AND 10`),
    check('TT_DRIVER_ATTENDANCE_SAFETY_CHK', sql`${t.helmet} AND ${t.vest} AND ${t.shoes}`),
    check(
      'TT_DRIVER_ATTENDANCE_TIME_CHK',
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    index('TT_DRIVER_ATTENDANCE_STARTED_IDX').on(t.plantId, t.startedAt),
  ],
);

export const driverAttendanceOrders = logisticsSchema.table(
  'TT_DRIVER_ATTENDANCE_DO',
  {
    id: pk(),
    attendanceId: fk('INT_ATTENDANCE_ID').notNull(),
    orderId: fk('INT_DO_ID')
      .notNull()
      .references(() => deliveryOrders.id),
  },
  (t) => [
    foreignKey({
      name: 'TT_DRIVER_ATTENDANCE_DO_ATT_FK',
      columns: [t.attendanceId],
      foreignColumns: [driverAttendances.id],
    }),
    uniqueIndex('TT_DRIVER_ATTENDANCE_DO_UNIQUE').on(t.orderId),
  ],
);
