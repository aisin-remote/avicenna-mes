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
  'ng_masters',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    processType: mysqlEnum('process_type', PROCESS_TYPES),
    category: varchar('category', { length: 64 }),
    sortOrder: int('sort_order').notNull().default(0),
    isActive: mysqlEnum('is_active', ['0', '1']).notNull().default('1'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ng_masters_plant_code_unique').on(t.plantId, t.code)],
);

/** Header pemeriksaan kualitas: satu sesi inspeksi. */
export const qualityInspections = mysqlTable(
  'quality_inspections',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    lineId: fk('line_id').references(() => lines.id),
    machineId: fk('machine_id').references(() => machines.id),
    processType: mysqlEnum('process_type', PROCESS_TYPES).notNull(),
    inspectedAt: timestamp('inspected_at').notNull(),
    shift: mysqlEnum('shift', ['1', '2', '3']),
    checkedQty: int('checked_qty').notNull().default(0),
    okQty: int('ok_qty').notNull().default(0),
    ngQty: int('ng_qty').notNull().default(0),
    inspectorId: fk('inspector_id').references(() => users.id),
    note: varchar('note', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('quality_inspections_part_time_idx').on(t.partId, t.inspectedAt),
    index('quality_inspections_line_time_idx').on(t.lineId, t.inspectedAt),
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
  'inspection_details',
  {
    id: pk(),
    inspectionId: fk('inspection_id')
      .notNull()
      .references(() => qualityInspections.id, { onDelete: 'cascade' }),
    ngMasterId: fk('ng_master_id')
      .notNull()
      .references(() => ngMasters.id),
    qty: int('qty').notNull().default(0),
    meta: json('meta'),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('inspection_details_inspection_idx').on(t.inspectionId)],
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
