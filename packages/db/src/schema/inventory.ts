import {
  mysqlTable,
  varchar,
  int,
  decimal,
  date,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
  json,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, lines } from './master';
import { plants, users } from './org';

export const locations = mysqlTable(
  'TM_LOCATION',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    /*
     * Jenis lokasi. Mengikuti SLOC pada rantai yang dipakai SAP:
     *   WAREHOUSE  gudang komponen & raw material  (WH00)
     *   WIP        barang setengah jadi di line    (WP01)
     *   FINISH_GOOD barang jadi                    (PP02)
     *   STAGING    sudah dipick, menunggu truk     (PP04)
     * CHUTE, NG, dan TRANSIT tidak punya padanan SLOC dan tidak dikirim ke SAP.
     */
    kind: mysqlEnum('CHR_KIND', [
      'WAREHOUSE',
      'WIP',
      'FINISH_GOOD',
      'STAGING',
      'CHUTE',
      'NG',
      'TRANSIT',
    ]).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_LOCATION_PLANT_CODE_UNIQUE').on(t.plantId, t.code)],
);

export const MUTATION_TYPES = [
  'PRODUCTION_IN',
  'DELIVERY_OUT',
  'NG_OUT',
  'ADJUSTMENT',
  'STOCK_TAKE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RECEIVING_IN',
  // Material terpakai saat produksi — lihat tabel consumptions.
  'CONSUMPTION_OUT',
] as const;

/**
 * Buku besar pergerakan stok — append-only.
 *
 * `qty` bertanda: positif menambah, negatif mengurangi. Saldo tidak pernah
 * di-UPDATE di sini; koreksi dicatat sebagai baris ADJUSTMENT baru sehingga
 * jejak audit untuk customer tetap utuh.
 */
export const mutations = mysqlTable(
  'TT_STOCK_MUTATION',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    locationId: fk('INT_LOCATION_ID').references(() => locations.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    /**
     * Lot yang bergerak. Kosong untuk part yang dilacak per butir atau hanya
     * per jumlah.
     *
     * Tanpa kolom ini, sisa per lot tidak bisa dihitung — dan alokasi FIFO
     * saat backflush jadi mustahil dilakukan dengan benar.
     */
    lotId: fk('INT_LOT_ID'),
    type: mysqlEnum('CHR_TYPE', MUTATION_TYPES).notNull(),
    /**
     * Bertanda: + masuk, - keluar.
     *
     * DESIMAL, bukan integer. Raw material yang dilebur dipakai dalam kilogram
     * dengan pecahan — 8,4 kg yang dibulatkan menjadi 8 akan menumpuk menjadi
     * selisih stok besar dalam hitungan bulan, dan penyebabnya tidak akan
     * ketahuan karena tiap barisnya sendiri terlihat wajar.
     */
    qty: decimal('FLT_QTY', { precision: 14, scale: 4 }).notNull(),
    /** Tabel + id asal (scan_events, quality_inspections, deliveries, ...). */
    sourceTable: varchar('CHR_SOURCE_TABLE', { length: 64 }),
    sourceId: fk('INT_SOURCE_ID'),
    npk: varchar('CHR_NPK', { length: 32 }),
    userId: fk('INT_USER_ID').references(() => users.id),
    occurredAt: timestamp('DTM_OCCURRED_AT').notNull(),
    note: varchar('CHR_NOTE', { length: 255 }),
    meta: json('CHR_META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_STOCK_MUTATION_PART_TIME_IDX').on(t.partId, t.occurredAt),
    index('TT_STOCK_MUTATION_TYPE_TIME_IDX').on(t.type, t.occurredAt),
    index('TT_STOCK_MUTATION_SOURCE_IDX').on(t.sourceTable, t.sourceId),
    index('TT_STOCK_MUTATION_LOT_IDX').on(t.lotId, t.occurredAt),
  ],
);

/**
 * Saldo stok harian — turunan (cache) dari `mutations`, bukan sumber kebenaran.
 * Bisa dibangun ulang kapan saja dari ledger. Diperbarui worker, bukan request web.
 */
export const stockBalances = mysqlTable(
  'TT_STOCK_BALANCE',
  {
    id: pk(),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    locationId: fk('INT_LOCATION_ID').references(() => locations.id),
    balanceDate: date('DTM_BALANCE_DATE', { mode: 'string' }).notNull(),
    // Desimal mengikuti mutations — saldo tidak boleh kehilangan presisi yang
    // sudah dijaga di buku besarnya.
    openingQty: decimal('FLT_OPENING_QTY', { precision: 14, scale: 4 }).notNull().default('0'),
    inQty: decimal('FLT_IN_QTY', { precision: 14, scale: 4 }).notNull().default('0'),
    outQty: decimal('FLT_OUT_QTY', { precision: 14, scale: 4 }).notNull().default('0'),
    closingQty: decimal('FLT_CLOSING_QTY', { precision: 14, scale: 4 }).notNull().default('0'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_STOCK_BALANCE_UNIQUE').on(t.partId, t.locationId, t.balanceDate),
    index('TT_STOCK_BALANCE_DATE_IDX').on(t.balanceDate),
  ],
);

export const mutationsRelations = relations(mutations, ({ one }) => ({
  plant: one(plants, { fields: [mutations.plantId], references: [plants.id] }),
  part: one(parts, { fields: [mutations.partId], references: [parts.id] }),
  location: one(locations, { fields: [mutations.locationId], references: [locations.id] }),
  user: one(users, { fields: [mutations.userId], references: [users.id] }),
}));

export const stockBalancesRelations = relations(stockBalances, ({ one }) => ({
  part: one(parts, { fields: [stockBalances.partId], references: [parts.id] }),
  location: one(locations, { fields: [stockBalances.locationId], references: [locations.id] }),
}));
