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
  'bom_lines',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    /** Part yang dibuat. */
    parentPartId: fk('parent_part_id')
      .notNull()
      .references(() => parts.id),
    /** Part yang dibutuhkan. */
    componentPartId: fk('component_part_id')
      .notNull()
      .references(() => parts.id),
    /**
     * Jumlah komponen per satu induk. Desimal karena raw material dipakai
     * dalam kilogram, bukan pcs.
     */
    qtyPer: decimal('qty_per', { precision: 12, scale: 4 }).notNull(),
    uom: varchar('uom', { length: 16 }).notNull().default('pcs'),
    /** Persentase susut yang wajar, dipakai saat menghitung kebutuhan material. */
    scrapPct: decimal('scrap_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    sequence: int('sequence').notNull().default(0),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    /** NULL berarti masih berlaku. */
    effectiveTo: date('effective_to', { mode: 'string' }),
    note: varchar('note', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('bom_lines_parent_idx').on(t.parentPartId, t.effectiveFrom),
    index('bom_lines_component_idx').on(t.componentPartId),
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
  'lots',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    /** Nomor lot internal. */
    lotNumber: varchar('lot_number', { length: 64 }).notNull(),
    /** Nomor lot dari supplier, apa adanya. */
    supplierLotNumber: varchar('supplier_lot_number', { length: 64 }),
    supplierId: fk('supplier_id').references(() => suppliers.id),
    receivedAt: timestamp('received_at'),
    expiresAt: date('expires_at', { mode: 'string' }),
    initialQty: decimal('initial_qty', { precision: 14, scale: 4 }).notNull().default('0'),
    status: mysqlEnum('status', ['OPEN', 'CONSUMED', 'BLOCKED', 'RETURNED'])
      .notNull()
      .default('OPEN'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('lots_plant_number_unique').on(t.plantId, t.lotNumber),
    index('lots_part_idx').on(t.partId),
    index('lots_supplier_lot_idx').on(t.supplierLotNumber),
  ],
);

/**
 * ─── Penerimaan dari supplier ─────────────────────────────────────────────
 */
export const receipts = mysqlTable(
  'receipts',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    supplierId: fk('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    /** Nomor surat jalan supplier. */
    supplierDocNumber: varchar('supplier_doc_number', { length: 64 }),
    receivedAt: timestamp('received_at').notNull(),
    locationId: fk('location_id').references(() => locations.id),
    status: mysqlEnum('status', ['DRAFT', 'RECEIVED', 'CANCELLED']).notNull().default('DRAFT'),
    receivedById: fk('received_by_id').references(() => users.id),
    note: varchar('note', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('receipts_plant_document_unique').on(t.plantId, t.documentNumber),
    index('receipts_supplier_date_idx').on(t.supplierId, t.receivedAt),
  ],
);

export const receiptLines = mysqlTable(
  'receipt_lines',
  {
    id: pk(),
    receiptId: fk('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    /** Lot yang terbentuk dari baris ini. Kosong untuk part berseri. */
    lotId: fk('lot_id').references(() => lots.id),
    qty: decimal('qty', { precision: 14, scale: 4 }).notNull(),
    uom: varchar('uom', { length: 16 }).notNull().default('pcs'),
    ...timestamps,
  },
  (t) => [index('receipt_lines_receipt_idx').on(t.receiptId), index('receipt_lines_part_idx').on(t.partId)],
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
  'consumptions',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    lineId: fk('line_id').references(() => lines.id),
    /** Part yang sedang diproduksi. */
    producedPartId: fk('produced_part_id')
      .notNull()
      .references(() => parts.id),
    /** Material yang terpakai. */
    componentPartId: fk('component_part_id')
      .notNull()
      .references(() => parts.id),
    lotId: fk('lot_id').references(() => lots.id),
    qty: decimal('qty', { precision: 14, scale: 4 }).notNull(),
    uom: varchar('uom', { length: 16 }).notNull().default('pcs'),
    source: mysqlEnum('source', ['BACKFLUSH', 'MANUAL', 'ADJUSTMENT']).notNull(),
    occurredAt: timestamp('occurred_at').notNull(),
    userId: fk('user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('consumptions_produced_idx').on(t.producedPartId, t.occurredAt),
    index('consumptions_component_idx').on(t.componentPartId, t.occurredAt),
    index('consumptions_lot_idx').on(t.lotId),
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
  'genealogy',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    /** Nomor seri unit yang dibuat. */
    parentSerial: varchar('parent_serial', { length: 64 }).notNull(),
    parentPartId: fk('parent_part_id')
      .notNull()
      .references(() => parts.id),
    componentPartId: fk('component_part_id')
      .notNull()
      .references(() => parts.id),
    /** Diisi untuk komponen berseri. */
    componentSerial: varchar('component_serial', { length: 64 }),
    /** Diisi untuk komponen ber-lot. */
    componentLotId: fk('component_lot_id').references(() => lots.id),
    qty: decimal('qty', { precision: 14, scale: 4 }).notNull().default('1'),
    /**
     * Seberapa kuat buktinya.
     *   SCANNED  operator benar-benar men-scan komponennya — bukti kuat.
     *   INFERRED disimpulkan dari lot yang sedang dipakai di line saat itu —
     *            cukup untuk kebanyakan kasus, tapi TIDAK cukup saat customer
     *            menuntut bukti. Bedanya harus terlihat, bukan disamarkan.
     */
    evidence: mysqlEnum('evidence', ['SCANNED', 'INFERRED']).notNull().default('INFERRED'),
    occurredAt: timestamp('occurred_at').notNull(),
    /**
     * Ditandai saat komponen ini diganti lewat perbaikan.
     *
     * Barisnya TIDAK dihapus. Saat investigasi, pertanyaan "unit ini dulu
     * memakai lot apa sebelum diperbaiki" harus tetap bisa dijawab — dan
     * justru itu yang sering dicari ketika masalah muncul belakangan.
     * Tautan yang masih berlaku adalah yang superseded_at-nya kosong.
     */
    supersededAt: timestamp('superseded_at'),
    supersededByRepairId: fk('superseded_by_repair_id'),
    meta: json('meta'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('genealogy_parent_idx').on(t.parentSerial),
    index('genealogy_lot_idx').on(t.componentLotId),
    index('genealogy_component_serial_idx').on(t.componentSerial),
    index('genealogy_part_time_idx').on(t.parentPartId, t.occurredAt),
  ],
);

/**
 * ─── Perpindahan antar lokasi / line ──────────────────────────────────────
 */
export const transfers = mysqlTable(
  'transfers',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    fromLocationId: fk('from_location_id').references(() => locations.id),
    toLocationId: fk('to_location_id').references(() => locations.id),
    fromLineId: fk('from_line_id').references(() => lines.id),
    toLineId: fk('to_line_id').references(() => lines.id),
    movedAt: timestamp('moved_at').notNull(),
    status: mysqlEnum('status', ['DRAFT', 'MOVED', 'CANCELLED']).notNull().default('DRAFT'),
    userId: fk('user_id').references(() => users.id),
    note: varchar('note', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('transfers_plant_document_unique').on(t.plantId, t.documentNumber),
    index('transfers_moved_idx').on(t.movedAt),
  ],
);

export const transferLines = mysqlTable(
  'transfer_lines',
  {
    id: pk(),
    transferId: fk('transfer_id')
      .notNull()
      .references(() => transfers.id, { onDelete: 'cascade' }),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    lotId: fk('lot_id').references(() => lots.id),
    serialNumber: varchar('serial_number', { length: 64 }),
    qty: decimal('qty', { precision: 14, scale: 4 }).notNull(),
    ...timestamps,
  },
  (t) => [index('transfer_lines_transfer_idx').on(t.transferId), index('transfer_lines_part_idx').on(t.partId)],
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
