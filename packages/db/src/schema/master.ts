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
import {
  pk,
  fk,
  timestamps,
  PROCESS_TYPES,
  PART_TYPES,
  SOURCE_TYPES,
  TRACKING_MODES,
} from './_shared';
import { plants } from './org';

/** Line produksi. Satu line terikat pada satu pabrik dan satu jenis proses. */
export const lines = mysqlTable(
  'TM_LINE',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    processType: mysqlEnum('PROCESS_TYPE', PROCESS_TYPES).notNull(),
    /*
     * SLOC asal dan tujuan line ini.
     *
     * Produksi adalah perpindahan barang, bukan sekadar penambahan: komponen
     * KELUAR dari gudang WIP dan barang jadi MASUK ke gudang finish good. Tanpa
     * kedua kolom ini sistem tidak tahu SLOC mana yang harus dipotong dan mana
     * yang ditambah, sehingga saldo totalnya benar tetapi saldo per SLOC —
     * justru angka yang dicocokkan dengan SAP — tidak akan pernah cocok.
     *
     * Disimpan per line, bukan diturunkan dari jenis lokasi, karena satu pabrik
     * bisa punya beberapa gudang WIP dan tebakan berdasarkan jenis akan salah
     * begitu gudang kedua dibuat.
     *
     * Tanpa .references(): `locations` didefinisikan di inventory.ts yang
     * sendirinya mengimpor berkas ini, jadi menambahkan rujukannya membuat
     * impor berputar. Keutuhannya dijaga di service — lokasi wajib milik pabrik
     * yang sama, dan itu memang pemeriksaan yang tidak bisa dilakukan FK.
     */
    inputLocationId: fk('INPUT_LOCATION_ID'),
    outputLocationId: fk('OUTPUT_LOCATION_ID'),
    sortOrder: int('SORT_ORDER').notNull().default(0),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_LINE_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_LINE_PROCESS_IDX').on(t.processType),
  ],
);

export const customers = mysqlTable(
  'TM_CUST',
  {
    id: pk(),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    /** Dock tujuan pengiriman (TMMIN dsb). */
    dock: varchar('DOCK', { length: 32 }),
    /**
     * Aturan penulisan nomor part pada barcode customer.
     *
     * Di bella aturan ini dipilih berdasarkan ID customer yang di-hardcode
     * (14 dan 22 untuk SUZUKI, 6/23/24/28 untuk MMKI). ID itu tidak akan sama
     * setelah data dipindah, dan aturan yang bergantung pada nomor baris
     * database akan diam-diam salah begitu urutannya berubah.
     */
    partNumberFormat: mysqlEnum('PART_NUMBER_FORMAT', [
      'TMMIN',
      'SUZUKI',
      'MMKI',
      'TBINA',
      'NONE',
    ])
      .notNull()
      .default('NONE'),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_CUST_CODE_UNIQUE').on(t.code)],
);

export const suppliers = mysqlTable(
  'TM_VENDOR',
  {
    id: pk(),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_VENDOR_CODE_UNIQUE').on(t.code)],
);

/**
 * Part versi internal — penggabungan `internal_parts` (bella) dan `avi_parts` (avicenna).
 * `back_number` dipertahankan karena dipakai di seluruh proses scan kedua pabrik.
 */
export const parts = mysqlTable(
  'TM_PARTS',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('LINE_ID').references(() => lines.id),
    partNumber: varchar('PART_NUMBER', { length: 64 }).notNull(),
    backNumber: varchar('BACK_NUMBER', { length: 64 }),
    name: varchar('NAME', { length: 191 }).notNull(),
    processType: mysqlEnum('PROCESS_TYPE', PROCESS_TYPES).notNull(),
    /** Posisi part di rantai pasok — menentukan aturan apa yang berlaku baginya. */
    partType: mysqlEnum('PART_TYPE', PART_TYPES).notNull().default('FINISHED_GOOD'),
    /** Dibeli atau diproduksi sendiri. */
    sourceType: mysqlEnum('SOURCE_TYPE', SOURCE_TYPES).notNull().default('MANUFACTURED'),
    /**
     * Cara part ini ditelusuri. Lihat docs/traceability-model.md.
     * Raw material yang dilebur tidak mungkin berseri; part casting justru
     * sudah discan satu per satu.
     */
    trackingMode: mysqlEnum('TRACKING_MODE', TRACKING_MODES).notNull().default('SERIAL'),
    /** Satuan. Raw material sering kilogram, bukan pcs. */
    uom: varchar('UOM', { length: 16 }).notNull().default('pcs'),
    /** Jumlah pcs per kanban standar (bisa dioverride per customer di customer_parts). */
    qtyPerKanban: int('QTY_PER_KANBAN'),
    standardStock: int('STANDARD_STOCK').notNull().default(0),
    photoPath: varchar('PHOTO_PATH', { length: 255 }),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PARTS_PLANT_PARTNUMBER_UNIQUE').on(t.plantId, t.partNumber),
    index('TM_PARTS_BACK_NUMBER_IDX').on(t.backNumber),
    index('TM_PARTS_LINE_IDX').on(t.lineId),
  ],
);

/** Pemetaan part internal -> penomoran milik customer. */
export const customerParts = mysqlTable(
  'TM_SHIPPING_PARTS',
  {
    id: pk(),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    customerId: fk('CUSTOMER_ID')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    customerPartNumber: varchar('CUSTOMER_PART_NUMBER', { length: 64 }).notNull(),
    customerBackNumber: varchar('CUSTOMER_BACK_NUMBER', { length: 64 }),
    qtyPerKanban: int('QTY_PER_KANBAN'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_SHIPPING_PARTS_UNIQUE').on(t.customerId, t.customerPartNumber),
    index('TM_SHIPPING_PARTS_PART_IDX').on(t.partId),
  ],
);

/** Mesin produksi. `externalRef` menautkan ke ID mesin di SQL Server J922. */
export const machines = mysqlTable(
  'TM_MACHINE',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('LINE_ID').references(() => lines.id),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    externalRef: varchar('EXTERNAL_REF', { length: 64 }),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_MACHINE_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_MACHINE_EXTERNAL_REF_IDX').on(t.externalRef),
  ],
);

/** Tooling: mold (injection) dan dies (casting) disatukan di sini. */
export const toolings = mysqlTable(
  'TM_TOOLING',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    kind: mysqlEnum('KIND', ['MOLD', 'DIES', 'JIG']).notNull(),
    cavity: int('CAVITY').notNull().default(1),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_TOOLING_PLANT_CODE_UNIQUE').on(t.plantId, t.code)],
);

export const toolingParts = mysqlTable(
  'TM_TOOLING_PARTS',
  {
    id: pk(),
    toolingId: fk('TOOLING_ID')
      .notNull()
      .references(() => toolings.id, { onDelete: 'cascade' }),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_TOOLING_PARTS_UNIQUE').on(t.toolingId, t.partId)],
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
