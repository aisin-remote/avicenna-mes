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
  'scrap_rules',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    /** Part yang dinyatakan NG. */
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    disposition: mysqlEnum('disposition', DISPOSITIONS).notNull(),
    /** Untuk REMELT: part hasil peleburan. */
    convertsToPartId: fk('converts_to_part_id').references(() => parts.id),
    /** Untuk REMELT: berapa banyak part tujuan dihasilkan dari satu unit NG. */
    conversionQty: decimal('conversion_qty', { precision: 12, scale: 4 }),
    conversionUom: varchar('conversion_uom', { length: 16 }),
    note: varchar('note', { length: 255 }),
    isActive: mysqlEnum('is_active', ['0', '1']).notNull().default('1'),
    ...timestamps,
  },
  (t) => [uniqueIndex('scrap_rules_part_unique').on(t.plantId, t.partId)],
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
  'ng_dispositions',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    lineId: fk('line_id').references(() => lines.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    /** Diisi untuk part berseri. */
    serialNumber: varchar('serial_number', { length: 64 }),
    /** Diisi untuk part ber-lot. */
    lotId: fk('lot_id').references(() => lots.id),
    qty: decimal('qty', { precision: 14, scale: 4 }).notNull(),
    disposition: mysqlEnum('disposition', DISPOSITIONS).notNull(),

    /** Hasil peleburan — hanya untuk REMELT. */
    convertedToPartId: fk('converted_to_part_id').references(() => parts.id),
    convertedQty: decimal('converted_qty', { precision: 14, scale: 4 }),
    convertedLotId: fk('converted_lot_id').references(() => lots.id),

    reason: varchar('reason', { length: 255 }),
    occurredAt: timestamp('occurred_at').notNull(),
    userId: fk('user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('ng_dispositions_part_time_idx').on(t.partId, t.occurredAt),
    index('ng_dispositions_serial_idx').on(t.serialNumber),
    index('ng_dispositions_disposition_idx').on(t.disposition, t.occurredAt),
  ],
);

/**
 * ─── Perbaikan ────────────────────────────────────────────────────────────
 *
 * Unit barang jadi yang NG diperbaiki dengan mengganti komponen tertentu.
 */
export const repairs = mysqlTable(
  'repairs',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    lineId: fk('line_id').references(() => lines.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    /** Nomor seri unit yang diperbaiki. */
    serialNumber: varchar('serial_number', { length: 64 }).notNull(),
    reason: varchar('reason', { length: 255 }),
    status: mysqlEnum('status', ['OPEN', 'DONE', 'SCRAPPED']).notNull().default('OPEN'),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
    userId: fk('user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('repairs_serial_idx').on(t.serialNumber),
    index('repairs_status_idx').on(t.status, t.startedAt),
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
  'repair_lines',
  {
    id: pk(),
    repairId: fk('repair_id')
      .notNull()
      .references(() => repairs.id, { onDelete: 'cascade' }),
    componentPartId: fk('component_part_id')
      .notNull()
      .references(() => parts.id),

    /** Komponen yang dilepas. */
    removedSerial: varchar('removed_serial', { length: 64 }),
    removedLotId: fk('removed_lot_id').references(() => lots.id),
    /** Apa yang dilakukan terhadap komponen yang dilepas. */
    removedDisposition: mysqlEnum('removed_disposition', DISPOSITIONS),

    /** Komponen pengganti yang dipasang. */
    installedSerial: varchar('installed_serial', { length: 64 }),
    installedLotId: fk('installed_lot_id').references(() => lots.id),

    qty: decimal('qty', { precision: 14, scale: 4 }).notNull().default('1'),
    ...timestamps,
  },
  (t) => [
    index('repair_lines_repair_idx').on(t.repairId),
    index('repair_lines_component_idx').on(t.componentPartId),
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
