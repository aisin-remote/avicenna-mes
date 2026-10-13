import { integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { fk, kanbanSchema, pk, timestamps } from './_shared';
import { customers } from './master';
import { users } from './org';

/** Master garis potong PDF Kanban per customer. Kolom ukuran lama dipertahankan untuk migrasi aman. */
export const kanbanCropProfiles = kanbanSchema.table(
  'TM_KANBAN_CROP_PROFILE',
  {
    id: pk(),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    widthTenths: integer('INT_WIDTH_TENTHS').notNull().default(900),
    heightTenths: integer('INT_HEIGHT_TENTHS').notNull().default(620),
    offsetXTenths: integer('INT_OFFSET_X_TENTHS').notNull().default(80),
    offsetYTenths: integer('INT_OFFSET_Y_TENTHS').notNull().default(80),
    gapXTenths: integer('INT_GAP_X_TENTHS').notNull().default(40),
    gapYTenths: integer('INT_GAP_Y_TENTHS').notNull().default(40),
    columns: integer('INT_COLUMNS').notNull().default(2),
    rows: integer('INT_ROWS').notNull().default(4),
    horizontalLines: jsonb('JSON_HORIZONTAL_LINES').$type<number[]>(),
    verticalLines: jsonb('JSON_VERTICAL_LINES').$type<number[]>(),
    updatedById: fk('INT_UPDATED_BY_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_KANBAN_CROP_PROFILE_CUSTOMER_UNIQUE').on(t.customerId)],
);
