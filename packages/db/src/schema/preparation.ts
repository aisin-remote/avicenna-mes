import { boolean, integer, time, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { fk, logisticsSchema, pk, timestamps } from './_shared';
import { customers } from './master';

/** Jam mentah SAP dipisahkan dari deadline PPIC: artinya belum boleh diasumsikan sama. */
export const preparationSchedules = logisticsSchema.table(
  'TM_PREPARATION_CYCLE',
  {
    id: pk(),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id),
    destination: varchar('CHR_DEST_NO', { length: 32 }).notNull().default(''),
    gate: varchar('CHR_GATE_NO', { length: 32 }).notNull().default(''),
    cycle: integer('INT_CYCLE').notNull(),
    preparationStart: time('DTM_PREP_START'),
    preparationEnd: time('DTM_PREP_END'),
    dayOffset: integer('INT_DAY_OFFSET').notNull().default(0),
    truckTime: time('DTM_TRUCK_TIME'),
    sapPickTime: time('DTM_SAP_PICK_TIME'),
    sapLoadingTime: time('DTM_SAP_LOADING_TIME'),
    sapDeliveryTime: time('DTM_SAP_DELIVERY_TIME'),
    syncedAt: timestamp('DTM_SYNCED_AT', { withTimezone: true, mode: 'date' }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_PREPARATION_CYCLE_KEY').on(t.customerId, t.destination, t.gate, t.cycle)],
);
