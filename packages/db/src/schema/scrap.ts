import { decimal, index, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { daftarNilai, enumCol, fk, pk, qualitySchema, timestamps } from './_shared';
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
export const scrapRules = qualitySchema.table(
  'TM_SCRAP_RULE',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Part yang dinyatakan NG. */
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    disposition: enumCol('CHR_DISPOSITION', DISPOSITIONS).notNull(),
    /** Untuk REMELT: part hasil peleburan. */
    convertsToPartId: fk('INT_CONVERTS_TO_PART_ID').references(() => parts.id),
    /** Untuk REMELT: berapa banyak part tujuan dihasilkan dari satu unit NG. */
    conversionQty: decimal('FLT_CONVERSION_QTY', { precision: 12, scale: 4 }),
    conversionUom: varchar('CHR_CONVERSION_UOM', { length: 16 }),
    note: varchar('CHR_NOTE', { length: 255 }),
    isActive: enumCol('CHR_IS_ACTIVE', ['0', '1']).notNull().default('1'),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_SCRAP_RULE_PART_UNIQUE').on(t.plantId, t.partId),
    daftarNilai('TM_SCRAP_RULE_CHR_DISPOSITION_CHK', t.disposition, DISPOSITIONS),
    daftarNilai('TM_SCRAP_RULE_CHR_IS_ACTIVE_CHK', t.isActive, ['0', '1']),
  ],
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
export const ngDispositions = qualitySchema.table(
  'TT_NG_DISPOSITION',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Diisi untuk part berseri. */
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }),
    /** Diisi untuk part ber-lot. */
    lotId: fk('INT_LOT_ID').references(() => lots.id),
    qty: decimal('FLT_QTY', { precision: 14, scale: 4 }).notNull(),
    disposition: enumCol('CHR_DISPOSITION', DISPOSITIONS).notNull(),

    /** Hasil peleburan — hanya untuk REMELT. */
    convertedToPartId: fk('INT_CONVERTED_TO_PART_ID').references(() => parts.id),
    convertedQty: decimal('FLT_CONVERTED_QTY', { precision: 14, scale: 4 }),
    convertedLotId: fk('INT_CONVERTED_LOT_ID').references(() => lots.id),

    reason: varchar('CHR_REASON', { length: 255 }),
    occurredAt: timestamp('DTM_OCCURRED_AT', { withTimezone: true, mode: 'date' }).notNull(),
    userId: fk('INT_USER_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('TT_NG_DISPOSITION_PART_TIME_IDX').on(t.partId, t.occurredAt),
    index('TT_NG_DISPOSITION_SERIAL_IDX').on(t.serialNumber),
    index('TT_NG_DISPOSITION_DISPOSITION_IDX').on(t.disposition, t.occurredAt),
  
    daftarNilai('TT_NG_DISPOSITION_CHR_DISPOSITION_CHK', t.disposition, DISPOSITIONS),
  ],
);

/**
 * ─── Perbaikan ────────────────────────────────────────────────────────────
 *
 * Unit barang jadi yang NG diperbaiki dengan mengganti komponen tertentu.
 */
export const repairs = qualitySchema.table(
  'TT_REPAIR_H',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Nomor seri unit yang diperbaiki. */
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }).notNull(),
    reason: varchar('CHR_REASON', { length: 255 }),
    status: enumCol('CHR_STATUS', ['OPEN', 'DONE', 'SCRAPPED']).notNull().default('OPEN'),
    startedAt: timestamp('DTM_STARTED_AT', { withTimezone: true, mode: 'date' }).notNull(),
    finishedAt: timestamp('DTM_FINISHED_AT', { withTimezone: true, mode: 'date' }),
    userId: fk('INT_USER_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('TT_REPAIR_H_SERIAL_IDX').on(t.serialNumber),
    index('TT_REPAIR_H_STATUS_IDX').on(t.status, t.startedAt),
  
    daftarNilai('TT_REPAIR_H_CHR_STATUS_CHK', t.status, ['OPEN', 'DONE', 'SCRAPPED']),
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
export const repairLines = qualitySchema.table(
  'TT_REPAIR_L',
  {
    id: pk(),
    repairId: fk('INT_REPAIR_ID')
      .notNull()
      .references(() => repairs.id, { onDelete: 'cascade' }),
    componentPartId: fk('INT_COMPONENT_PART_ID')
      .notNull()
      .references(() => parts.id),

    /** Komponen yang dilepas. */
    removedSerial: varchar('CHR_REMOVED_SERIAL', { length: 64 }),
    removedLotId: fk('INT_REMOVED_LOT_ID').references(() => lots.id),
    /** Apa yang dilakukan terhadap komponen yang dilepas. */
    removedDisposition: enumCol('CHR_REMOVED_DISPOSITION', DISPOSITIONS),

    /** Komponen pengganti yang dipasang. */
    installedSerial: varchar('CHR_INSTALLED_SERIAL', { length: 64 }),
    installedLotId: fk('INT_INSTALLED_LOT_ID').references(() => lots.id),

    qty: decimal('FLT_QTY', { precision: 14, scale: 4 }).notNull().default('1'),
    ...timestamps,
  },
  (t) => [
    index('TT_REPAIR_L_REPAIR_IDX').on(t.repairId),
    index('TT_REPAIR_L_COMPONENT_IDX').on(t.componentPartId),
  
    daftarNilai('TT_REPAIR_L_CHR_REMOVED_DISPOSITION_CHK', t.removedDisposition, DISPOSITIONS),
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
