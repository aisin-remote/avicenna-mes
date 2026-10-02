import { mysqlTable, int, json, uniqueIndex } from 'drizzle-orm/mysql-core';
import { pk, fk, timestamps } from './_shared';
import { customers } from './master';
import { users } from './org';

/** Master garis potong PDF Kanban per customer. Kolom ukuran lama dipertahankan untuk migrasi aman. */
export const kanbanCropProfiles = mysqlTable(
  'TM_KANBAN_CROP_PROFILE',
  {
    id: pk(),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    widthTenths: int('INT_WIDTH_TENTHS').notNull().default(900),
    heightTenths: int('INT_HEIGHT_TENTHS').notNull().default(620),
    offsetXTenths: int('INT_OFFSET_X_TENTHS').notNull().default(80),
    offsetYTenths: int('INT_OFFSET_Y_TENTHS').notNull().default(80),
    gapXTenths: int('INT_GAP_X_TENTHS').notNull().default(40),
    gapYTenths: int('INT_GAP_Y_TENTHS').notNull().default(40),
    columns: int('INT_COLUMNS').notNull().default(2),
    rows: int('INT_ROWS').notNull().default(4),
    horizontalLines: json('JSON_HORIZONTAL_LINES').$type<number[]>(),
    verticalLines: json('JSON_VERTICAL_LINES').$type<number[]>(),
    updatedById: fk('INT_UPDATED_BY_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_KANBAN_CROP_PROFILE_CUSTOMER_UNIQUE').on(t.customerId)],
);
