import {
  mysqlTable,
  varchar,
  decimal,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, lines } from './master';
import { lots } from './supply';
import { plants, users } from './org';

/**
 * Perlakuan terhadap barang NG.
 *
 *   REMELT          dilebur ulang — identitasnya berubah menjadi part lain.
 *                   Part A yang NG kembali menjadi raw material D.
 *   REPAIR          diperbaiki dengan mengganti komponen tertentu.
 *   DISCARD         dibuang, nilainya hilang.
 *   RETURN_SUPPLIER dikembalikan ke supplier (untuk komponen beli).
 */
export const DISPOSITIONS = ['REMELT', 'REPAIR', 'DISCARD', 'RETURN_SUPPLIER'] as const;

/**
 * ─── Aturan perlakuan NG (master) ─────────────────────────────────────────
 *
 * Menentukan apa yang terjadi ketika sebuah part dinyatakan NG.
 *
 * Untuk REMELT, aturannya menyimpan part tujuan dan rasio konversinya:
 * 1 pcs A menjadi berapa kg D. Rasio ini BUKAN otomatis sama dengan qtyPer di
 * BOM — melebur ulang selalu kehilangan sebagian material karena terbakar dan
 * menempel di tungku. Memakai angka BOM apa adanya akan membuat stok D
 * terlihat lebih banyak daripada kenyataan.
 */
export const scrapRules = mysqlTable(
  'TM_SCRAP_RULE',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Part yang dinyatakan NG. */
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    disposition: mysqlEnum('DISPOSITION', DISPOSITIONS).notNull(),
    /** Untuk REMELT: part hasil peleburan. */
    convertsToPartId: fk('CONVERTS_TO_PART_ID').references(() => parts.id),
    /** Untuk REMELT: berapa banyak part tujuan dihasilkan dari satu unit NG. */
    conversionQty: decimal('CONVERSION_QTY', { precision: 12, scale: 4 }),
    conversionUom: varchar('CONVERSION_UOM', { length: 16 }),
    note: varchar('NOTE', { length: 255 }),
    isActive: mysqlEnum('IS_ACTIVE', ['0', '1']).notNull().default('1'),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_SCRAP_RULE_PART_UNIQUE').on(t.plantId, t.partId)],
);

/**
 * ─── Kejadian NG dan perlakuannya (transaksi) ─────────────────────────────
 *
 * Satu baris = satu keputusan atas barang NG yang nyata.
 *
 * Untuk REMELT, kolom converted* mencatat hasilnya. Stok part asal berkurang
 * dan stok part tujuan bertambah — dua baris di buku besar mutations, bukan
 * satu. Kalau hanya dicatat sebagai pengurangan, material yang sebenarnya
 * masih bernilai akan hilang dari pembukuan.
 */
export const ngDispositions = mysqlTable(
  'TT_NG_DISPOSITION',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('LINE_ID').references(() => lines.id),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Diisi untuk part berseri. */
    serialNumber: varchar('SERIAL_NUMBER', { length: 64 }),
    /** Diisi untuk part ber-lot. */
    lotId: fk('LOT_ID').references(() => lots.id),
    qty: decimal('QTY', { precision: 14, scale: 4 }).notNull(),
    disposition: mysqlEnum('DISPOSITION', DISPOSITIONS).notNull(),

    /** Hasil peleburan — hanya untuk REMELT. */
    convertedToPartId: fk('CONVERTED_TO_PART_ID').references(() => parts.id),
    convertedQty: decimal('CONVERTED_QTY', { precision: 14, scale: 4 }),
    convertedLotId: fk('CONVERTED_LOT_ID').references(() => lots.id),

    reason: varchar('REASON', { length: 255 }),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    userId: fk('USER_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('TT_NG_DISPOSITION_PART_TIME_IDX').on(t.partId, t.occurredAt),
    index('TT_NG_DISPOSITION_SERIAL_IDX').on(t.serialNumber),
    index('TT_NG_DISPOSITION_DISPOSITION_IDX').on(t.disposition, t.occurredAt),
  ],
);

/**
 * ─── Perbaikan ────────────────────────────────────────────────────────────
 *
 * Unit barang jadi yang NG diperbaiki dengan mengganti komponen tertentu.
 */
export const repairs = mysqlTable(
  'TT_REPAIR_H',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('LINE_ID').references(() => lines.id),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Nomor seri unit yang diperbaiki. */
    serialNumber: varchar('SERIAL_NUMBER', { length: 64 }).notNull(),
    reason: varchar('REASON', { length: 255 }),
    status: mysqlEnum('STATUS', ['OPEN', 'DONE', 'SCRAPPED']).notNull().default('OPEN'),
    startedAt: timestamp('STARTED_AT').notNull(),
    finishedAt: timestamp('FINISHED_AT'),
    userId: fk('USER_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('TT_REPAIR_H_SERIAL_IDX').on(t.serialNumber),
    index('TT_REPAIR_H_STATUS_IDX').on(t.status, t.startedAt),
  ],
);

/**
 * Komponen yang dilepas dan dipasang saat perbaikan.
 *
 * Baris ini yang membuat silsilah tetap benar setelah repair: tautan silsilah
 * ke komponen lama ditandai digantikan, lalu tautan baru dibuat. Riwayat lama
 * TIDAK dihapus — saat investigasi, pertanyaan "unit ini dulu pakai lot apa"
 * harus tetap bisa dijawab.
 */
export const repairLines = mysqlTable(
  'TT_REPAIR_L',
  {
    id: pk(),
    repairId: fk('REPAIR_ID')
      .notNull()
      .references(() => repairs.id, { onDelete: 'cascade' }),
    componentPartId: fk('COMPONENT_PART_ID')
      .notNull()
      .references(() => parts.id),

    /** Komponen yang dilepas. */
    removedSerial: varchar('REMOVED_SERIAL', { length: 64 }),
    removedLotId: fk('REMOVED_LOT_ID').references(() => lots.id),
    /** Apa yang dilakukan terhadap komponen yang dilepas. */
    removedDisposition: mysqlEnum('REMOVED_DISPOSITION', DISPOSITIONS),

    /** Komponen pengganti yang dipasang. */
    installedSerial: varchar('INSTALLED_SERIAL', { length: 64 }),
    installedLotId: fk('INSTALLED_LOT_ID').references(() => lots.id),

    qty: decimal('QTY', { precision: 14, scale: 4 }).notNull().default('1'),
    ...timestamps,
  },
  (t) => [
    index('TT_REPAIR_L_REPAIR_IDX').on(t.repairId),
    index('TT_REPAIR_L_COMPONENT_IDX').on(t.componentPartId),
  ],
);

export const scrapRulesRelations = relations(scrapRules, ({ one }) => ({
  part: one(parts, { fields: [scrapRules.partId], references: [parts.id] }),
  convertsTo: one(parts, { fields: [scrapRules.convertsToPartId], references: [parts.id] }),
}));

export const ngDispositionsRelations = relations(ngDispositions, ({ one }) => ({
  part: one(parts, { fields: [ngDispositions.partId], references: [parts.id] }),
  convertedTo: one(parts, { fields: [ngDispositions.convertedToPartId], references: [parts.id] }),
  lot: one(lots, { fields: [ngDispositions.lotId], references: [lots.id] }),
}));

export const repairsRelations = relations(repairs, ({ one, many }) => ({
  part: one(parts, { fields: [repairs.partId], references: [parts.id] }),
  lines: many(repairLines),
}));

export const repairLinesRelations = relations(repairLines, ({ one }) => ({
  repair: one(repairs, { fields: [repairLines.repairId], references: [repairs.id] }),
  component: one(parts, { fields: [repairLines.componentPartId], references: [parts.id] }),
}));
