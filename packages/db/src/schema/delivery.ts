import {
  mysqlTable,
  varchar,
  int,
  date,
  time,
  timestamp,
  mysqlEnum,
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
 * Mengikuti `loading_lists` milik bella. Di sana dokumennya didorong masuk dari
 * sistem luar lewat URL; di sini dikelola sendiri, jadi nomornya dibuat sistem
 * dan `pdsNumber` menyimpan rujukan ke dokumen customer bila ada.
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
    plantId: fk('PLANT_ID')
      .notNull()
      .references(() => plants.id),
    customerId: fk('CUSTOMER_ID')
      .notNull()
      .references(() => customers.id),
    /** Nomor surat jalan / DN. */
    documentNumber: varchar('DOCUMENT_NUMBER', { length: 64 }).notNull(),
    manifestNumber: varchar('MANIFEST_NUMBER', { length: 64 }),
    /** Nomor PDS dari customer — rujukan ke dokumen mereka. */
    pdsNumber: varchar('PDS_NUMBER', { length: 64 }),
    deliveryDate: date('DELIVERY_DATE', { mode: 'string' }).notNull(),
    cycle: int('CYCLE').notNull().default(1),
    dock: varchar('DOCK', { length: 32 }),
    planTime: time('PLAN_TIME'),
    departedAt: timestamp('DEPARTED_AT'),
    arrivedAt: timestamp('ARRIVED_AT'),
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
    status: mysqlEnum('STATUS', [
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
    locationId: fk('LOCATION_ID').references(() => locations.id),
    /**
     * SLOC staging (PP04): tempat barang menunggu setelah dipick.
     *
     * Ada sebagai lokasi tersendiri karena barang yang sudah diambil dari
     * gudang tetapi belum naik truk memang bukan lagi stok finish good, dan
     * bukan pula barang yang sudah terkirim. Tanpa tempat ini, selisih di
     * antara keduanya tidak punya rumah.
     */
    stagingLocationId: fk('STAGING_LOCATION_ID'),
    truckNumber: varchar('TRUCK_NUMBER', { length: 32 }),
    driverName: varchar('DRIVER_NAME', { length: 128 }),
    /** Status truk terpisah dari status dokumen — truk bisa datang sebelum muat. */
    truckStatus: mysqlEnum('TRUCK_STATUS', ['PENDING', 'ARRIVED', 'LOADING', 'DEPARTED'])
      .notNull()
      .default('PENDING'),
    truckPickedAt: timestamp('TRUCK_PICKED_AT'),
    truckPickedById: fk('TRUCK_PICKED_BY_ID').references(() => users.id),
    createdById: fk('CREATED_BY_ID').references(() => users.id),
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
    deliveryId: fk('DELIVERY_ID')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    partId: fk('PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Penomoran customer untuk part ini, dipakai mencocokkan barcode saat muat. */
    customerPartId: fk('CUSTOMER_PART_ID'),
    /** Rencana: berapa kanban yang harus dimuat. */
    plannedKanban: int('PLANNED_KANBAN').notNull().default(0),
    plannedQty: int('PLANNED_QTY').notNull().default(0),
    qtyPerKanban: int('QTY_PER_KANBAN').notNull().default(0),
    /** Pulling: berapa kanban yang diambil dari PP02 ke PP04. */
    pickedKanban: int('PICKED_KANBAN').notNull().default(0),
    pickedQty: int('PICKED_QTY').notNull().default(0),
    /** Aktual: berapa kanban yang benar-benar naik truk. */
    actualKanban: int('ACTUAL_KANBAN').notNull().default(0),
    actualQty: int('ACTUAL_QTY').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_DELIVERY_ITEM_UNIQUE').on(t.deliveryId, t.partId),
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
