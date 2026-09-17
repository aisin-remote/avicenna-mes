import {
  mysqlTable,
  varchar,
  int,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
  json,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps, PROCESS_TYPES } from './_shared';
import { parts, lines, machines } from './master';
import { plants, users } from './org';

/** Master jenis NG (defect). Gabungan avi_trace_ng_master + master_item_checks bella. */
export const ngMasters = mysqlTable(
  'TM_NG',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    processType: mysqlEnum('CHR_PROCESS_TYPE', PROCESS_TYPES),
    category: varchar('CHR_CATEGORY', { length: 64 }),
    sortOrder: int('INT_SORT_ORDER').notNull().default(0),
    isActive: mysqlEnum('CHR_IS_ACTIVE', ['0', '1']).notNull().default('1'),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_NG_PLANT_CODE_UNIQUE').on(t.plantId, t.code)],
);

/** Header pemeriksaan kualitas: satu sesi inspeksi. */
export const qualityInspections = mysqlTable(
  'TT_INSPECTION_H',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    machineId: fk('INT_MACHINE_ID').references(() => machines.id),
    processType: mysqlEnum('CHR_PROCESS_TYPE', PROCESS_TYPES).notNull(),
    inspectedAt: timestamp('DTM_INSPECTED_AT').notNull(),
    shift: mysqlEnum('CHR_SHIFT', ['1', '2', '3']),
    checkedQty: int('INT_CHECKED_QTY').notNull().default(0),
    okQty: int('INT_OK_QTY').notNull().default(0),
    ngQty: int('INT_NG_QTY').notNull().default(0),
    inspectorId: fk('INT_INSPECTOR_ID').references(() => users.id),
    note: varchar('CHR_NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('TT_INSPECTION_H_PART_TIME_IDX').on(t.partId, t.inspectedAt),
    index('TT_INSPECTION_H_LINE_TIME_IDX').on(t.lineId, t.inspectedAt),
  ],
);

/**
 * Rincian NG per jenis defect dalam satu inspeksi (anak dari quality_inspections).
 *
 * Nama tabelnya sengaja dipendekkan, bukan `quality_inspection_details`:
 * MySQL membatasi nama identifier 64 karakter, dan nama constraint FK yang
 * dibangkitkan Drizzle dari nama panjang itu menembus batas tersebut.
 * Jalankan `pnpm db:check-names` setelah menambah tabel baru.
 */
export const inspectionDetails = mysqlTable(
  'TT_INSPECTION_L',
  {
    id: pk(),
    inspectionId: fk('INT_INSPECTION_ID')
      .notNull()
      .references(() => qualityInspections.id, { onDelete: 'cascade' }),
    ngMasterId: fk('INT_NG_MASTER_ID')
      .notNull()
      .references(() => ngMasters.id),
    qty: int('INT_QTY').notNull().default(0),
    meta: json('CHR_META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('TT_INSPECTION_L_INSPECTION_IDX').on(t.inspectionId)],
);

export const qualityInspectionsRelations = relations(qualityInspections, ({ one, many }) => ({
  plant: one(plants, { fields: [qualityInspections.plantId], references: [plants.id] }),
  part: one(parts, { fields: [qualityInspections.partId], references: [parts.id] }),
  line: one(lines, { fields: [qualityInspections.lineId], references: [lines.id] }),
  inspector: one(users, { fields: [qualityInspections.inspectorId], references: [users.id] }),
  details: many(inspectionDetails),
}));

export const inspectionDetailsRelations = relations(inspectionDetails, ({ one }) => ({
  inspection: one(qualityInspections, {
    fields: [inspectionDetails.inspectionId],
    references: [qualityInspections.id],
  }),
  ngMaster: one(ngMasters, {
    fields: [inspectionDetails.ngMasterId],
    references: [ngMasters.id],
  }),
}));
