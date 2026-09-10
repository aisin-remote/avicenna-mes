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
  'deliveries',
  {
    id: pk(),
    plantId: fk('plant_id')
      .notNull()
      .references(() => plants.id),
    customerId: fk('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Nomor surat jalan / DN. */
    documentNumber: varchar('document_number', { length: 64 }).notNull(),
    manifestNumber: varchar('manifest_number', { length: 64 }),
    /** Nomor PDS dari customer — rujukan ke dokumen mereka. */
    pdsNumber: varchar('pds_number', { length: 64 }),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    cycle: int('cycle').notNull().default(1),
    dock: varchar('dock', { length: 32 }),
    planTime: time('plan_time'),
    departedAt: timestamp('departed_at'),
    arrivedAt: timestamp('arrived_at'),
    status: mysqlEnum('status', ['DRAFT', 'LOADING', 'LOADED', 'SHIPPED', 'RECEIVED', 'CANCELLED'])
      .notNull()
      .default('DRAFT'),
    /**
     * Lokasi asal barang. Mutasi DELIVERY_OUT mengurangi stok di lokasi ini —
     * tanpa itu saldo total benar tetapi saldo per lokasi diam-diam melenceng.
     */
    locationId: fk('location_id').references(() => locations.id),
    truckNumber: varchar('truck_number', { length: 32 }),
    driverName: varchar('driver_name', { length: 128 }),
    /** Status truk terpisah dari status dokumen — truk bisa datang sebelum muat. */
    truckStatus: mysqlEnum('truck_status', ['PENDING', 'ARRIVED', 'LOADING', 'DEPARTED'])
      .notNull()
      .default('PENDING'),
    truckPickedAt: timestamp('truck_picked_at'),
    truckPickedById: fk('truck_picked_by_id').references(() => users.id),
    createdById: fk('created_by_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('deliveries_plant_document_unique').on(t.plantId, t.documentNumber),
    index('deliveries_date_customer_idx').on(t.deliveryDate, t.customerId),
    index('deliveries_status_idx').on(t.status),
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
  'delivery_lines',
  {
    id: pk(),
    deliveryId: fk('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    partId: fk('part_id')
      .notNull()
      .references(() => parts.id),
    /** Penomoran customer untuk part ini, dipakai mencocokkan barcode saat muat. */
    customerPartId: fk('customer_part_id'),
    /*
     * Nama kolom lama dipertahankan (plan_qty, kanban_count) meski nama di
     * TypeScript diperjelas. Mengganti nama kolom membuat drizzle-kit tidak
     * bisa membedakan "rename" dari "hapus lalu tambah" tanpa dikonfirmasi
     * manusia, dan itu bukan keputusan yang boleh diambil alat secara diam-diam
     * pada tabel yang kelak berisi data pengiriman.
     */
    /** Rencana: berapa kanban yang harus dimuat. */
    plannedKanban: int('kanban_count').notNull().default(0),
    plannedQty: int('plan_qty').notNull().default(0),
    qtyPerKanban: int('qty_per_kanban').notNull().default(0),
    /** Aktual: berapa kanban yang benar-benar discan saat muat. */
    actualKanban: int('actual_kanban').notNull().default(0),
    actualQty: int('actual_qty').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('delivery_lines_unique').on(t.deliveryId, t.partId),
    index('delivery_lines_part_idx').on(t.partId),
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
