import {
  mysqlTable,
  varchar,
  int,
  date,
  time,
  timestamp,
  mysqlEnum,
  json,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, customers } from './master';
import { plants, users } from './org';
import { locations } from './inventory';

/**
 * Loading list — dokumen muat satu truk.
 *
 * Kepala dan rencana item disalin read-only dari database staging SAP.
 * AVICENNA hanya menyimpan status operasional pulling/loading dan hasil scan;
 * nomor loading list, manifest, PDS, customer, serta rencananya tidak dibuat di sini.
 *
 * Alurnya: dokumen dibuat berisi rencana per part (berapa kanban), lalu saat
 * muat barang kanban discan satu per satu dan jumlah aktualnya bertambah.
 * Selisih rencana dan aktual sengaja disimpan berdampingan — itulah yang
 * ditanya pertama kali ketika kiriman tidak sesuai.
 */
export const deliveries = mysqlTable(
  'TT_DELIVERY',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id),
    /** Nomor surat jalan / DN. */
    documentNumber: varchar('CHR_DEL_NO', { length: 64 }).notNull(),
    manifestNumber: varchar('CHR_DOK_NO', { length: 64 }),
    /** Nomor PDS dari customer — rujukan ke dokumen mereka. */
    pdsNumber: varchar('CHR_PDS_NO', { length: 64 }),
    /** Nilai referensi dari staging SAP; belum dipakai mengendalikan workflow MES. */
    purchaseOrderNumber: varchar('CHR_PO_NO', { length: 64 }),
    salesOrganization: varchar('CHR_SORG', { length: 16 }),
    distributionChannel: varchar('CHR_DIS_CHANNEL', { length: 16 }),
    division: varchar('CHR_DIVISION', { length: 16 }),
    deliveryType: varchar('CHR_DEL_TYPE', { length: 16 }),
    sapGiStatus: varchar('CHR_GI_DEL', { length: 16 }),
    invoiceNumber: varchar('CHR_INV_NO', { length: 64 }),
    qcStatus: varchar('CHR_QC_STATUS', { length: 16 }),
    sapActualDeliveryDate: date('DTM_DEL_DATE_ACT', { mode: 'string' }),
    sapHeaderMovementStatus: varchar('CHR_SM_H_FLAG', { length: 16 }),
    sapLineMovementStatus: varchar('CHR_SM_L_FLAG', { length: 16 }),
    sapReceiveStatus: varchar('CHR_FLAG_RECEIVE', { length: 16 }),
    sapReceiveDate: date('DTM_DATE_RECEIVE', { mode: 'string' }),
    sapReceiveTime: time('DTM_TIME_RECEIVE'),
    deliveryDate: date('DTM_DEL_DATE', { mode: 'string' }).notNull(),
    cycle: int('INT_CYCLE').notNull().default(1),
    dock: varchar('CHR_CUS_DEST', { length: 32 }),
    planTime: time('DTM_PLAN_TIME'),
    departedAt: timestamp('DTM_DEPARTED_AT'),
    arrivedAt: timestamp('DTM_ARRIVED_AT'),
    /*
     * Tahapan dokumen, mengikuti rantai SLOC:
     *
     *   DRAFT    rencana tersusun, barang belum disentuh
     *   PICKING  sedang diambil dari gudang finish good (PP02)
     *   PICKED   sudah pindah ke staging (PP04), menunggu truk
     *   LOADING  sedang dimuat ke truk
     *   SHIPPED  berangkat — stok keluar dari PP04
     *
     * 'LOADED' dari versi sebelumnya dihapus: tidak pernah dipakai, dan
     * perannya kini diisi PICKED yang punya arti stok yang jelas.
     */
    status: mysqlEnum('CHR_STATUS', [
      'DRAFT',
      'PICKING',
      'PICKED',
      'LOADING',
      'SHIPPED',
      'RECEIVED',
      'CANCELLED',
    ])
      .notNull()
      .default('DRAFT'),
    /**
     * SLOC tempat barang jadi diambil saat pulling (PP02).
     *
     * Bukan lagi tempat stok dipotong saat berangkat — sejak model SLOC
     * diadopsi, barang lebih dulu berpindah ke staging, dan dari sanalah ia
     * keluar. Lihat docs/sap-integration.md.
     */
    locationId: fk('INT_LOCATION_ID').references(() => locations.id),
    /**
     * SLOC staging (PP04): tempat barang menunggu setelah dipick.
     *
     * Ada sebagai lokasi tersendiri karena barang yang sudah diambil dari
     * gudang tetapi belum naik truk memang bukan lagi stok finish good, dan
     * bukan pula barang yang sudah terkirim. Tanpa tempat ini, selisih di
     * antara keduanya tidak punya rumah.
     */
    stagingLocationId: fk('INT_STAGING_LOCATION_ID'),
    truckNumber: varchar('CHR_TRUCK_NUMBER', { length: 32 }),
    driverName: varchar('CHR_DRIVER_NAME', { length: 128 }),
    /** Status truk terpisah dari status dokumen — truk bisa datang sebelum muat. */
    truckStatus: mysqlEnum('CHR_TRUCK_STATUS', ['PENDING', 'ARRIVED', 'LOADING', 'DEPARTED'])
      .notNull()
      .default('PENDING'),
    truckPickedAt: timestamp('DTM_TRUCK_PICKED_AT'),
    truckPickedById: fk('INT_TRUCK_PICKED_BY_ID').references(() => users.id),
    createdById: fk('INT_CREATED_BY_ID').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_DELIVERY_PLANT_DOCUMENT_UNIQUE').on(t.plantId, t.documentNumber),
    index('TT_DELIVERY_DATE_CUSTOMER_IDX').on(t.deliveryDate, t.customerId),
    index('TT_DELIVERY_STATUS_IDX').on(t.status),
  ],
);

/**
 * Baris loading list, dihitung dalam KANBAN.
 *
 * Bella menghitung muatan per kanban, bukan per pcs, karena itulah satuan yang
 * dipegang orang di lapangan: satu kartu = satu kemasan. Jumlah pcs-nya
 * diturunkan dari qtyPerKanban.
 *
 * `qtyPerKanban` disalin ke baris ini, tidak dibaca dari master saat
 * menghitung. Master bisa berubah sewaktu-waktu, dan dokumen yang sudah
 * dikirim tidak boleh ikut berubah angkanya.
 */
export const deliveryLines = mysqlTable(
  'TT_DELIVERY_ITEM',
  {
    id: pk(),
    deliveryId: fk('INT_DELIVERY_ID')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Penomoran customer untuk part ini, dipakai mencocokkan barcode saat muat. */
    customerPartId: fk('INT_CUSTOMER_PART_ID'),
    customerPartNumberSource: varchar('CHR_CUST_PART_NO', { length: 64 }),
    /** Nomor baris asli SAP. Part yang sama boleh muncul pada lebih dari satu item. */
    sapItemNumber: varchar('CHR_DEL_ITEM', { length: 16 }),
    /** Qty yang disediakan sumber, disimpan berdampingan dengan rencana MES. */
    sapDeliveryQty: int('INT_DEL_QTY').notNull().default(0),
    itemType: varchar('CHR_ITEM_TYPE', { length: 16 }),
    /** Rencana: berapa kanban yang harus dimuat. */
    plannedKanban: int('INT_PLANNED_KANBAN').notNull().default(0),
    plannedQty: int('INT_TOTAL_QTY').notNull().default(0),
    qtyPerKanban: int('INT_QTY_PER_BOX').notNull().default(0),
    /** Pulling: berapa kanban yang diambil dari PP02 ke PP04. */
    pickedKanban: int('INT_PICKED_KANBAN').notNull().default(0),
    pickedQty: int('INT_SCAN_QTY').notNull().default(0),
    /** Aktual: berapa kanban yang benar-benar naik truk. */
    actualKanban: int('INT_ACTUAL_KANBAN').notNull().default(0),
    actualQty: int('INT_ACTUAL_DEL').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_DELIVERY_ITEM_SOURCE_UNIQUE').on(t.deliveryId, t.sapItemNumber),
    index('TT_DELIVERY_ITEM_DELIVERY_PART_IDX').on(t.deliveryId, t.partId),
    index('TT_DELIVERY_ITEM_PART_IDX').on(t.partId),
  ],
);

export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  plant: one(plants, { fields: [deliveries.plantId], references: [plants.id] }),
  customer: one(customers, { fields: [deliveries.customerId], references: [customers.id] }),
  lines: many(deliveryLines),
}));

export const deliveryLinesRelations = relations(deliveryLines, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryLines.deliveryId], references: [deliveries.id] }),
  part: one(parts, { fields: [deliveryLines.partId], references: [parts.id] }),
}));

/** Hasil refresh terakhir per hari, termasuk dokumen yang belum bisa diimpor. */
export const deliverySyncs = mysqlTable(
  'TT_DELIVERY_SYNC',
  {
    id: pk(),
    operationalDate: date('DTM_OPERATIONAL_DATE', { mode: 'string' }).notNull(),
    syncedAt: timestamp('DTM_SYNCED_AT').notNull(),
    result: json('CHR_RESULT').notNull(),
  },
  (t) => [uniqueIndex('TT_DELIVERY_SYNC_DATE_UNIQUE').on(t.operationalDate)],
);
