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
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    processType: mysqlEnum('CHR_PROCESS_TYPE', PROCESS_TYPES).notNull(),
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
    inputLocationId: fk('INT_INPUT_LOCATION_ID'),
    outputLocationId: fk('INT_OUTPUT_LOCATION_ID'),
    sortOrder: int('INT_SORT_ORDER').notNull().default(0),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
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
    code: varchar('CHR_CUST_NO', { length: 32 }).notNull(),
    name: varchar('CHR_CUST_NAME', { length: 128 }).notNull(),
    /** Dock tujuan pengiriman (TMMIN dsb). */
    dock: varchar('CHR_DOCK', { length: 32 }),
    /**
     * Aturan penulisan nomor part pada barcode customer.
     *
     * Di bella aturan ini dipilih berdasarkan ID customer yang di-hardcode
     * (14 dan 22 untuk SUZUKI, 6/23/24/28 untuk MMKI). ID itu tidak akan sama
     * setelah data dipindah, dan aturan yang bergantung pada nomor baris
     * database akan diam-diam salah begitu urutannya berubah.
     */
    partNumberFormat: mysqlEnum('CHR_PART_NUMBER_FORMAT', [
      'TMMIN',
      'SUZUKI',
      'MMKI',
      'TBINA',
      'NONE',
    ])
      .notNull()
      .default('NONE'),
    /**
     * Customer yang memakai kanban miliknya sendiri.
     *
     * Bedanya di dua tempat:
     *   lini FG   yang ditempel kartu customer, bukan kartu internal
     *   delivery  tidak scan apa pun — pasangannya sudah terbentuk sejak lini FG
     *
     * Customer biasa menempel kartu internal di lini FG, lalu di delivery
     * dicocokkan tiga arah: loading list, kanban internal, kanban customer.
     */
    directKanban: boolean('FLG_DIRECT_KANBAN').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_CUST_CODE_UNIQUE').on(t.code)],
);

export const suppliers = mysqlTable(
  'TM_VENDOR',
  {
    id: pk(),
    code: varchar('CHR_SUPPLIER_ID', { length: 32 }).notNull(),
    name: varchar('CHR_SUPPLIER_NAME', { length: 128 }).notNull(),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
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
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    partNumber: varchar('CHR_PART_NO', { length: 64 }).notNull(),
    backNumber: varchar('CHR_BACK_NO', { length: 64 }),
    /**
     * Proyek/model tempat part ini dipakai — TCC, OPN, CSH, 4L45W, 660A.
     *
     * Kolom biasa, bukan tabel master: dipakai untuk mengelompokkan laporan dan
     * layar monitor, dan tidak punya atribut lain yang perlu disimpan.
     *
     * Proyek TIDAK menentukan rute. Pada proyek 660A, GARNISH melewati Injection
     * lalu langsung Assembling sedangkan HANDLE melewati Painting lebih dulu —
     * jadi rute tetap melekat pada part, lihat TM_PROCESS_PARTS.
     */
    project: varchar('CHR_PROJECT', { length: 32 }),
    name: varchar('CHR_PART_NAME', { length: 191 }).notNull(),
    processType: mysqlEnum('CHR_PROCESS_TYPE', PROCESS_TYPES).notNull(),
    /** Posisi part di rantai pasok — menentukan aturan apa yang berlaku baginya. */
    partType: mysqlEnum('CHR_PART_TYPE', PART_TYPES).notNull().default('FINISHED_GOOD'),
    /** Dibeli atau diproduksi sendiri. */
    sourceType: mysqlEnum('CHR_SOURCE_TYPE', SOURCE_TYPES).notNull().default('MANUFACTURED'),
    /**
     * Cara part ini ditelusuri. Lihat docs/traceability-model.md.
     * Raw material yang dilebur tidak mungkin berseri; part casting justru
     * sudah discan satu per satu.
     */
    trackingMode: mysqlEnum('CHR_TRACKING_MODE', TRACKING_MODES).notNull().default('SERIAL'),
    /** Satuan. Raw material sering kilogram, bukan pcs. */
    uom: varchar('CHR_PART_UOM', { length: 16 }).notNull().default('pcs'),
    /** Jumlah pcs per kanban standar (bisa dioverride per customer di customer_parts). */
    qtyPerKanban: int('INT_QTY_PER_BOX'),
    standardStock: int('INT_STANDARD_STOCK').notNull().default(0),
    photoPath: varchar('CHR_PHOTO_PATH', { length: 255 }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PARTS_PLANT_PARTNUMBER_UNIQUE').on(t.plantId, t.partNumber),
    index('TM_PARTS_BACK_NUMBER_IDX').on(t.backNumber),
    index('TM_PARTS_LINE_IDX').on(t.lineId),
  ],
);

/**
 * RUTE PROSES PER PART — proses apa saja yang harus dilalui sebuah part, dan
 * dalam urutan yang mana.
 *
 * ── Kenapa tabel, bukan aturan di kode ──────────────────────────────────────
 *
 * Sebelumnya urutan proses adalah satu rantai global di process-chain.ts, sama
 * untuk semua part. Kenyataannya di AIIA tiap part punya rutenya sendiri:
 *
 *   TCC A   Melting -> Casting -> Machining -> Assembling -> Delivery
 *   OPN A   Melting -> Casting -> Machining -> Delivery
 *   CSH A   Melting -> Casting -> Delivery
 *   HANDLE  Injection -> Painting -> Assembling -> Delivery
 *   GARNISH Injection -> Assembling -> Delivery
 *
 * Satu rantai global tidak bisa menyatakan bahwa proses sebelum Delivery adalah
 * Casting untuk CSH A, Machining untuk OPN A, dan Assembling untuk TCC A. Dan
 * karena rutenya bertambah setiap kali ada part baru, ia harus jadi data yang
 * bisa diubah lewat master — bukan kode yang menuntut deploy.
 *
 * ── Kenapa berkunci part, bukan proyek ──────────────────────────────────────
 *
 * Dua part dalam proyek yang sama bisa berbeda rute. Pada proyek 660A, GARNISH
 * tidak melewati Painting sedangkan HANDLE melewatinya. Mengikat rute ke proyek
 * akan membuat salah satunya selalu keliru.
 */
export const partProcesses = mysqlTable(
  'TM_PROCESS_PARTS',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    processType: mysqlEnum('CHR_PROCESS_TYPE', PROCESS_TYPES).notNull(),
    /**
     * Urutan dalam rute part ini. Bukan urutan global.
     *
     * Dipakai menentukan proses sebelumnya saat memvalidasi scan: yang dicari
     * adalah seqNo terbesar yang lebih kecil dari seqNo proses sekarang, DI
     * DALAM rute part itu sendiri.
     */
    seqNo: int('INT_SEQ_NO').notNull(),
    /**
     * Lini yang mengerjakannya, bila sudah pasti satu.
     *
     * Boleh kosong: sebuah proses bisa dikerjakan beberapa lini yang setara, dan
     * memaksa satu lini di sini akan menolak scan dari lini kembarannya.
     */
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // Satu part tidak melewati proses yang sama dua kali. Kalau suatu saat itu
    // terjadi (mis. dua kali painting), yang berubah adalah kunci ini — dan
    // perubahannya akan terlihat, bukan diam-diam menimpa baris lama.
    uniqueIndex('TM_PROCESS_PARTS_PART_PROCESS_UNIQUE').on(t.partId, t.processType),
    uniqueIndex('TM_PROCESS_PARTS_PART_SEQ_UNIQUE').on(t.partId, t.seqNo),
    index('TM_PROCESS_PARTS_PLANT_PROCESS_IDX').on(t.plantId, t.processType),
  ],
);

export const partProcessesRelations = relations(partProcesses, ({ one }) => ({
  plant: one(plants, { fields: [partProcesses.plantId], references: [plants.id] }),
  part: one(parts, { fields: [partProcesses.partId], references: [parts.id] }),
  line: one(lines, { fields: [partProcesses.lineId], references: [lines.id] }),
}));

/**
 * PROGRAM NUMBER — dua digit pertama pada barcode part.
 *
 * Diambil dari `avi_trace_program_number` sistem lama (944 baris). Dua digit itu
 * yang menerjemahkan barcode menjadi part: sisa barcode tidak memuat nomor part
 * sama sekali, hanya identitas unitnya.
 *
 * ── Kenapa berdiri sendiri, bukan kolom di TM_PARTS ─────────────────────────
 *
 * Satu part bisa punya BEBERAPA program number, satu per model. Pada data lama,
 * kode "10" dan "15" sama-sama menunjuk part 243202-10630 tetapi model
 * "OPN 889F" dan "OPN D81F". Menyimpannya sebagai kolom di part memaksa memilih
 * salah satu, dan modelnya hilang.
 *
 * ── Dipakai untuk apa ───────────────────────────────────────────────────────
 *
 * 1. Menerjemahkan barcode 15 karakter menjadi part saat scan produksi.
 * 2. Mencocokkan model part dengan kanban — kartu kanban terikat pada back
 *    number, dan back number itu datang dari sini.
 */
export const programNumbers = mysqlTable(
  'TM_PROGRAM_NUMBER',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Dua digit pertama barcode. Unik per pabrik. */
    code: varchar('CHR_CODE', { length: 4 }).notNull(),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Model, mis. "OPN 889F". Inilah yang membedakan dua kode pada part yang sama. */
    product: varchar('CHR_PRODUCT', { length: 64 }),
    customerId: fk('INT_CUSTOMER_ID').references(() => customers.id),
    /** Part rakitan — dipakai sistem lama membedakan perlakuan scan. */
    isAssy: boolean('FLG_IS_ASSY').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PROGRAM_NUMBER_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_PROGRAM_NUMBER_PART_IDX').on(t.partId),
  ],
);

export const programNumbersRelations = relations(programNumbers, ({ one }) => ({
  plant: one(plants, { fields: [programNumbers.plantId], references: [plants.id] }),
  part: one(parts, { fields: [programNumbers.partId], references: [parts.id] }),
  customer: one(customers, { fields: [programNumbers.customerId], references: [customers.id] }),
}));

/** Pemetaan part internal -> penomoran milik customer. */
export const customerParts = mysqlTable(
  'TM_SHIPPING_PARTS',
  {
    id: pk(),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    customerPartNumber: varchar('CHR_CUS_PART_NO', { length: 64 }).notNull(),
    customerBackNumber: varchar('CHR_CUS_BACK_NO', { length: 64 }),
    qtyPerKanban: int('INT_QTY_PER_BOX'),
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
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    externalRef: varchar('CHR_EXTERNAL_REF', { length: 64 }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
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
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    kind: mysqlEnum('CHR_KIND', ['MOLD', 'DIES', 'JIG']).notNull(),
    cavity: int('INT_CAVITY').notNull().default(1),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_TOOLING_PLANT_CODE_UNIQUE').on(t.plantId, t.code)],
);

export const toolingParts = mysqlTable(
  'TM_TOOLING_PARTS',
  {
    id: pk(),
    toolingId: fk('INT_TOOLING_ID')
      .notNull()
      .references(() => toolings.id, { onDelete: 'cascade' }),
    partId: fk('INT_PART_ID')
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
