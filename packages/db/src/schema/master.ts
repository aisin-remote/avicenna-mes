import {
  mysqlTable,
  varchar,
  int,
  boolean,
  mysqlEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps, PROCESS_TYPES } from './_shared';
import { plants } from './org';

/** Line produksi. Satu line terikat pada satu pabrik dan satu jenis proses. */
export const lines = mysqlTable(
  'lines',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    processType: mysqlEnum('process_type', PROCESS_TYPES).notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('lines_plant_code_unique').on(t.plantId, t.code),
    index('lines_process_idx').on(t.processType),
  ],
);

export const customers = mysqlTable(
  'customers',
  {
    id: pk(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    /** Dock tujuan pengiriman (TMMIN dsb). */
    dock: varchar('dock', { length: 32 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('customers_code_unique').on(t.code)],
);

export const suppliers = mysqlTable(
  'suppliers',
  {
    id: pk(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('suppliers_code_unique').on(t.code)],
);

/**
 * Part versi internal — penggabungan `internal_parts` (bella) dan `avi_parts` (avicenna).
 * `back_number` dipertahankan karena dipakai di seluruh proses scan kedua pabrik.
 */
export const parts = mysqlTable(
  'parts',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    lineId: fk('line_id').references(() => lines.id),
    partNumber: varchar('part_number', { length: 64 }).notNull(),
    backNumber: varchar('back_number', { length: 64 }),
    name: varchar('name', { length: 191 }).notNull(),
    processType: mysqlEnum('process_type', PROCESS_TYPES).notNull(),
    /** Jumlah pcs per kanban standar (bisa dioverride per customer di customer_parts). */
    qtyPerKanban: int('qty_per_kanban'),
    standardStock: int('standard_stock').notNull().default(0),
    photoPath: varchar('photo_path', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('parts_plant_partnumber_unique').on(t.plantId, t.partNumber),
    index('parts_back_number_idx').on(t.backNumber),
    index('parts_line_idx').on(t.lineId),
  ],
);

/** Pemetaan part internal -> penomoran milik customer. */
export const customerParts = mysqlTable(
  'customer_parts',
  {
    id: pk(),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    customerId: fk('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    customerPartNumber: varchar('customer_part_number', { length: 64 }).notNull(),
    customerBackNumber: varchar('customer_back_number', { length: 64 }),
    qtyPerKanban: int('qty_per_kanban'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customer_parts_unique').on(t.customerId, t.customerPartNumber),
    index('customer_parts_part_idx').on(t.partId),
  ],
);

/** Mesin produksi. `externalRef` menautkan ke ID mesin di SQL Server J922. */
export const machines = mysqlTable(
  'machines',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    lineId: fk('line_id').references(() => lines.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    externalRef: varchar('external_ref', { length: 64 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('machines_plant_code_unique').on(t.plantId, t.code),
    index('machines_external_ref_idx').on(t.externalRef),
  ],
);

/** Tooling: mold (injection) dan dies (casting) disatukan di sini. */
export const toolings = mysqlTable(
  'toolings',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    kind: mysqlEnum('kind', ['MOLD', 'DIES', 'JIG']).notNull(),
    cavity: int('cavity').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('toolings_plant_code_unique').on(t.plantId, t.code)],
);

export const toolingParts = mysqlTable(
  'tooling_parts',
  {
    id: pk(),
    toolingId: fk('tooling_id')
      .notNull()
      .references(() => toolings.id, { onDelete: 'cascade' }),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('tooling_parts_unique').on(t.toolingId, t.partId)],
);

export const linesRelations = relations(lines, ({ one, many }) => ({
  plant: one(plants, { fields: [lines.plantId], references: [plants.id] }),
  parts: many(parts),
  machines: many(machines),
}));

export const partsRelations = relations(parts, ({ one, many }) => ({
  plant: one(plants, { fields: [parts.plantId], references: [plants.id] }),
  line: one(lines, { fields: [parts.lineId], references: [lines.id] }),
  customerParts: many(customerParts),
}));

export const customerPartsRelations = relations(customerParts, ({ one }) => ({
  part: one(parts, { fields: [customerParts.partId], references: [parts.id] }),
  customer: one(customers, { fields: [customerParts.customerId], references: [customers.id] }),
}));

export const machinesRelations = relations(machines, ({ one }) => ({
  plant: one(plants, { fields: [machines.plantId], references: [plants.id] }),
  line: one(lines, { fields: [machines.lineId], references: [lines.id] }),
}));
