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
import { parts, suppliers } from './master';
import { locations } from './inventory';
import { plants, users } from './org';
import { lines } from './master';

/**
 * ─── BOM ──────────────────────────────────────────────────────────────────
 *
 * Apa membutuhkan apa. Bersarang, sehingga ABC bisa diurai sampai raw material
 * tanpa tabel terpisah:
 *
 *   ABC → A ×1, B ×2, C ×4
 *   A   → D ×0,8 kg
 *
 * BERVERSI lewat effectiveFrom/effectiveTo. Tanpa itu, mengubah komposisi hari
 * ini akan ikut mengubah telusur produksi bulan lalu — dan jawaban atas
 * pertanyaan audit menjadi salah tanpa ada yang menyadarinya.
 */
export const bomLines = mysqlTable(
  'TM_BOM',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Part yang dibuat. */
    parentPartId: fk('PARENT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Part yang dibutuhkan. */
    componentPartId: fk('COMPONENT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /**
     * Jumlah komponen per satu induk. Desimal karena raw material dipakai
     * dalam kilogram, bukan pcs.
     */
    qtyPer: decimal('QTY_PER', { precision: 12, scale: 4 }).notNull(),
    uom: varchar('UOM', { length: 16 }).notNull().default('pcs'),
    /** Persentase susut yang wajar, dipakai saat menghitung kebutuhan material. */
    scrapPct: decimal('SCRAP_PCT', { precision: 5, scale: 2 }).notNull().default('0'),
    sequence: int('SEQUENCE').notNull().default(0),
    effectiveFrom: date('EFFECTIVE_FROM', { mode: 'string' }).notNull(),
    /** NULL berarti masih berlaku. */
    effectiveTo: date('EFFECTIVE_TO', { mode: 'string' }),
    note: varchar('NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('TM_BOM_PARENT_IDX').on(t.parentPartId, t.effectiveFrom),
    index('TM_BOM_COMPONENT_IDX').on(t.componentPartId),
  ],
);

/**
 * ─── Lot ──────────────────────────────────────────────────────────────────
 *
 * Identitas sekelompok barang yang tidak bisa diberi nomor seri satu per satu.
 *
 * `supplierLotNumber` disimpan apa adanya. Saat ada masalah kualitas, nomor
 * itulah yang dipakai customer dan supplier untuk saling merujuk — mengganti
 * atau menormalkannya akan memutus rujukan tersebut.
 */
export const lots = mysqlTable(
  'TT_LOT',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Nomor lot internal. */
    lotNumber: varchar('LOT_NUMBER', { length: 64 }).notNull(),
    /** Nomor lot dari supplier, apa adanya. */
    supplierLotNumber: varchar('SUPPLIER_LOT_NUMBER', { length: 64 }),
    supplierId: fk('SUPPLIER_ID').references(() => suppliers.id),
    receivedAt: timestamp('RECEIVED_AT'),
    expiresAt: date('EXPIRES_AT', { mode: 'string' }),
    /**
     * Jumlah yang tertulis saat barang datang. CATATAN SAJA, BUKAN SALDO.
     *
     * Sisa lot selalu dihitung sebagai jumlah seluruh mutasi yang menyentuh
     * lot ini. Menjumlahkan kolom ini dengan mutasi akan menghitung barang
     * yang sama dua kali.
     */
    initialQty: decimal('INITIAL_QTY', { precision: 14, scale: 4 }).notNull().default('0'),
    status: mysqlEnum('STATUS', ['OPEN', 'CONSUMED', 'BLOCKED', 'RETURNED'])
      .notNull()
      .default('OPEN'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_LOT_PLANT_NUMBER_UNIQUE').on(t.plantId, t.lotNumber),
    index('TT_LOT_PART_IDX').on(t.partId),
    index('TT_LOT_SUPPLIER_LOT_IDX').on(t.supplierLotNumber),
  ],
);

/**
 * ─── Penerimaan dari supplier ─────────────────────────────────────────────
 */
export const receipts = mysqlTable(
  'TT_PURCHASE_RECEIPT_H',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    supplierId: fk('SUPPLIER_ID')
      .notNull()
      .references(() => suppliers.id),
    documentNumber: varchar('DOCUMENT_NUMBER', { length: 64 }).notNull(),
    /** Nomor surat jalan supplier. */
    supplierDocNumber: varchar('SUPPLIER_DOC_NUMBER', { length: 64 }),
    receivedAt: timestamp('RECEIVED_AT').notNull(),
    locationId: fk('LOCATION_ID').references(() => locations.id),
    status: mysqlEnum('STATUS', ['DRAFT', 'RECEIVED', 'CANCELLED']).notNull().default('DRAFT'),
    receivedById: fk('RECEIVED_BY_ID').references(() => users.id),
    note: varchar('NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_PURCHASE_RECEIPT_H_PLANT_DOCUMENT_UNIQUE').on(t.plantId, t.documentNumber),
    index('TT_PURCHASE_RECEIPT_H_SUPPLIER_DATE_IDX').on(t.supplierId, t.receivedAt),
  ],
);

export const receiptLines = mysqlTable(
  'TT_PURCHASE_RECEIPT_L',
  {
    id: pk(),
    receiptId: fk('RECEIPT_ID')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Lot yang terbentuk dari baris ini. Kosong untuk part berseri. */
    lotId: fk('LOT_ID').references(() => lots.id),
    qty: decimal('QTY', { precision: 14, scale: 4 }).notNull(),
    uom: varchar('UOM', { length: 16 }).notNull().default('pcs'),
    ...timestamps,
  },
  (t) => [index('TT_PURCHASE_RECEIPT_L_RECEIPT_IDX').on(t.receiptId), index('TT_PURCHASE_RECEIPT_L_PART_IDX').on(t.partId)],
);

/**
 * ─── Pemakaian material ───────────────────────────────────────────────────
 *
 * Saat line memproduksi A, material D berkurang.
 *
 * `source` membedakan asal pencatatannya:
 *   BACKFLUSH  dihitung otomatis dari BOM setiap ada scan produksi. Praktis,
 *              tapi hanya seakurat BOM-nya.
 *   MANUAL     operator mencatat lot yang benar-benar dipakai. Inilah yang
 *              memberi ketertelusuran sesungguhnya.
 *
 * Keduanya didukung karena pilihan di antara keduanya adalah keputusan beban
 * kerja di lapangan, bukan keputusan teknis.
 */
export const consumptions = mysqlTable(
  'TT_CONSUMPTION',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('LINE_ID').references(() => lines.id),
    /** Part yang sedang diproduksi. */
    producedPartId: fk('PRODUCED_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Material yang terpakai. */
    componentPartId: fk('COMPONENT_PART_ID')
      .notNull()
      .references(() => parts.id),
    lotId: fk('LOT_ID').references(() => lots.id),
    qty: decimal('QTY', { precision: 14, scale: 4 }).notNull(),
    uom: varchar('UOM', { length: 16 }).notNull().default('pcs'),
    source: mysqlEnum('SOURCE', ['BACKFLUSH', 'MANUAL', 'ADJUSTMENT']).notNull(),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    userId: fk('USER_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('TT_CONSUMPTION_PRODUCED_IDX').on(t.producedPartId, t.occurredAt),
    index('TT_CONSUMPTION_COMPONENT_IDX').on(t.componentPartId, t.occurredAt),
    index('TT_CONSUMPTION_LOT_IDX').on(t.lotId),
  ],
);

/**
 * ─── Silsilah ─────────────────────────────────────────────────────────────
 *
 * Unit jadi ini terbuat dari komponen dan lot mana saja.
 *
 * INI INTI KETERTELUSURAN. Tanpa tabel ini, sistem hanya menghitung stok.
 * Dua pertanyaan yang selalu muncul saat ada masalah kualitas:
 *
 *   MAJU   lot D-2026-11 cacat — unit ABC mana saja yang memakainya?
 *          → cari berdasarkan componentLotId
 *   MUNDUR unit ABC nomor seri X bermasalah — isinya apa saja?
 *          → cari berdasarkan parentSerial
 *
 * Kedua arah itu sama pentingnya, jadi keduanya diberi index.
 */
export const genealogy = mysqlTable(
  'TT_GENEALOGY',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Nomor seri unit yang dibuat. */
    parentSerial: varchar('PARENT_SERIAL', { length: 64 }).notNull(),
    parentPartId: fk('PARENT_PART_ID')
      .notNull()
      .references(() => parts.id),
    componentPartId: fk('COMPONENT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Diisi untuk komponen berseri. */
    componentSerial: varchar('COMPONENT_SERIAL', { length: 64 }),
    /** Diisi untuk komponen ber-lot. */
    componentLotId: fk('COMPONENT_LOT_ID').references(() => lots.id),
    qty: decimal('QTY', { precision: 14, scale: 4 }).notNull().default('1'),
    /**
     * Seberapa kuat buktinya.
     *   SCANNED  operator benar-benar men-scan komponennya — bukti kuat.
     *   INFERRED disimpulkan dari lot yang sedang dipakai di line saat itu —
     *            cukup untuk kebanyakan kasus, tapi TIDAK cukup saat customer
     *            menuntut bukti. Bedanya harus terlihat, bukan disamarkan.
     */
    evidence: mysqlEnum('EVIDENCE', ['SCANNED', 'INFERRED']).notNull().default('INFERRED'),
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    /**
     * Ditandai saat komponen ini diganti lewat perbaikan.
     *
     * Barisnya TIDAK dihapus. Saat investigasi, pertanyaan "unit ini dulu
     * memakai lot apa sebelum diperbaiki" harus tetap bisa dijawab — dan
     * justru itu yang sering dicari ketika masalah muncul belakangan.
     * Tautan yang masih berlaku adalah yang superseded_at-nya kosong.
     */
    supersededAt: timestamp('SUPERSEDED_AT'),
    supersededByRepairId: fk('SUPERSEDED_BY_REPAIR_ID'),
    meta: json('META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_GENEALOGY_PARENT_IDX').on(t.parentSerial),
    index('TT_GENEALOGY_LOT_IDX').on(t.componentLotId),
    index('TT_GENEALOGY_COMPONENT_SERIAL_IDX').on(t.componentSerial),
    index('TT_GENEALOGY_PART_TIME_IDX').on(t.parentPartId, t.occurredAt),
  ],
);

/**
 * ─── Perpindahan antar lokasi / line ──────────────────────────────────────
 */
export const transfers = mysqlTable(
  'TT_GOODS_MOVEMENT_H',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    documentNumber: varchar('DOCUMENT_NUMBER', { length: 64 }).notNull(),
    fromLocationId: fk('FROM_LOCATION_ID').references(() => locations.id),
    toLocationId: fk('TO_LOCATION_ID').references(() => locations.id),
    fromLineId: fk('FROM_LINE_ID').references(() => lines.id),
    toLineId: fk('TO_LINE_ID').references(() => lines.id),
    movedAt: timestamp('MOVED_AT').notNull(),
    status: mysqlEnum('STATUS', ['DRAFT', 'MOVED', 'CANCELLED']).notNull().default('DRAFT'),
    userId: fk('USER_ID').references(() => users.id),
    note: varchar('NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_GOODS_MOVEMENT_H_PLANT_DOCUMENT_UNIQUE').on(t.plantId, t.documentNumber),
    index('TT_GOODS_MOVEMENT_H_MOVED_IDX').on(t.movedAt),
  ],
);

export const transferLines = mysqlTable(
  'TT_GOODS_MOVEMENT_L',
  {
    id: pk(),
    transferId: fk('TRANSFER_ID')
      .notNull()
      .references(() => transfers.id, { onDelete: 'cascade' }),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    lotId: fk('LOT_ID').references(() => lots.id),
    serialNumber: varchar('SERIAL_NUMBER', { length: 64 }),
    qty: decimal('QTY', { precision: 14, scale: 4 }).notNull(),
    ...timestamps,
  },
  (t) => [index('TT_GOODS_MOVEMENT_L_TRANSFER_IDX').on(t.transferId), index('TT_GOODS_MOVEMENT_L_PART_IDX').on(t.partId)],
);

// ─── Relasi ─────────────────────────────────────────────────────────────────

export const bomLinesRelations = relations(bomLines, ({ one }) => ({
  parent: one(parts, { fields: [bomLines.parentPartId], references: [parts.id] }),
  component: one(parts, { fields: [bomLines.componentPartId], references: [parts.id] }),
}));

export const lotsRelations = relations(lots, ({ one, many }) => ({
  part: one(parts, { fields: [lots.partId], references: [parts.id] }),
  supplier: one(suppliers, { fields: [lots.supplierId], references: [suppliers.id] }),
  consumptions: many(consumptions),
}));

export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [receipts.supplierId], references: [suppliers.id] }),
  location: one(locations, { fields: [receipts.locationId], references: [locations.id] }),
  lines: many(receiptLines),
}));

export const receiptLinesRelations = relations(receiptLines, ({ one }) => ({
  receipt: one(receipts, { fields: [receiptLines.receiptId], references: [receipts.id] }),
  part: one(parts, { fields: [receiptLines.partId], references: [parts.id] }),
  lot: one(lots, { fields: [receiptLines.lotId], references: [lots.id] }),
}));

export const consumptionsRelations = relations(consumptions, ({ one }) => ({
  producedPart: one(parts, { fields: [consumptions.producedPartId], references: [parts.id] }),
  componentPart: one(parts, { fields: [consumptions.componentPartId], references: [parts.id] }),
  lot: one(lots, { fields: [consumptions.lotId], references: [lots.id] }),
}));

export const genealogyRelations = relations(genealogy, ({ one }) => ({
  parentPart: one(parts, { fields: [genealogy.parentPartId], references: [parts.id] }),
  componentPart: one(parts, { fields: [genealogy.componentPartId], references: [parts.id] }),
  componentLot: one(lots, { fields: [genealogy.componentLotId], references: [lots.id] }),
}));

export const transfersRelations = relations(transfers, ({ one, many }) => ({
  fromLocation: one(locations, { fields: [transfers.fromLocationId], references: [locations.id] }),
  toLocation: one(locations, { fields: [transfers.toLocationId], references: [locations.id] }),
  lines: many(transferLines),
}));

export const transferLinesRelations = relations(transferLines, ({ one }) => ({
  transfer: one(transfers, { fields: [transferLines.transferId], references: [transfers.id] }),
  part: one(parts, { fields: [transferLines.partId], references: [parts.id] }),
  lot: one(lots, { fields: [transferLines.lotId], references: [lots.id] }),
}));
