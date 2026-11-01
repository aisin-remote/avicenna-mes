import { integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { fk, logisticsSchema, pk, timestamps } from './_shared';
import { plants, users } from './org';
import { deliveryLines } from './delivery';

/** Konteks operator bertahan saat reload; hitungan packing tidak memakai hitungan pulling. */
export const pisSessions = logisticsSchema.table(
  'TT_PIS_SESSION',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    userId: fk('INT_USER_ID')
      .notNull()
      .references(() => users.id),
    state: jsonb('CHR_STATE').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('TT_PIS_SESSION_USER_PLANT_UNIQUE').on(t.userId, t.plantId)],
);

export const pisPacking = logisticsSchema.table(
  'TT_PIS_PACKING',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    deliveryLineId: fk('INT_DELIVERY_ITEM_ID')
      .notNull()
      .references(() => deliveryLines.id, { onDelete: 'cascade' }),
    packedQty: integer('INT_PACKED_QTY').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('TT_PIS_PACKING_ITEM_UNIQUE').on(t.deliveryLineId)],
);
