import {
  mysqlTable,
  varchar,
  int,
  mysqlEnum,
  timestamp,
  uniqueIndex,
  index,
  json,
  boolean,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { parts, customers, lines } from './master';
import { plants, users, devices } from './org';

export const KANBAN_STATUSES = [
  'CREATED',
  'PRODUCED',
  'STORED',
  'PULLED',
  'LOADED',
  'DELIVERED',
  'CANCELLED',
] as const;

/** Jenis kartu. Mengikuti `jenis_kanban` di sistem lama. */
export const KANBAN_TYPES = ['REGULER', 'SPARE'] as const;

/**
 * Pemilik kartu.
 *
 * INTERNAL kartu terbitan kita sendiri
 * CUSTOMER kartu milik customer, dipakai customer yang direct kanban
 *
 * Ditulis eksplisit, bukan disimpulkan dari ada-tidaknya customerId: kartu
 * internal pun boleh diperuntukkan bagi satu customer tertentu, dan menyimpulkan
 * kepemilikan dari situ akan salah pada kartu-kartu itu.
 */
export const KANBAN_OWNERS = ['INTERNAL', 'CUSTOMER'] as const;

/**
 * MASTER KANBAN — satu baris = satu KARTU FISIK.
 *
 * Kartu ini dipakai berulang: ditempel ke barang jadi di lini FG, ikut sampai
 * pengiriman, lalu kembali dan ditempel ke barang berikutnya. Isinya yang
 * berganti, kartunya tidak.
 *
 * ── Kenapa seri unik per PART, bukan per pabrik ─────────────────────────────
 *
 * Di sistem lama kartu selalu dicari dengan `no_seri` DAN `master_id` sekaligus
 * — seri "1456" bisa ada pada beberapa part yang berbeda. Membuat seri unik
 * se-pabrik akan menolak kartu sah yang serinya kebetulan sama, dan itu baru
 * ketahuan saat kartu dicetak dan dibagikan ke lini.
 *
 * Akibat langsungnya di lapangan: seri saja TIDAK cukup mengenali kartu. Karena
 * itu lini FG men-scan part code LEBIH DULU, baru kanbannya.
 */
export const kanbans = mysqlTable(
  'TM_KANBAN',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Nomor kanban menurut penomoran SAP. Boleh kosong sampai disepakati. */
    kanbanNo: int('INT_KANBAN_NO'),
    kanbanType: mysqlEnum('CHR_KANBAN_TYPE', KANBAN_TYPES).notNull().default('REGULER'),
    owner: mysqlEnum('CHR_OWNER', KANBAN_OWNERS).notNull().default('INTERNAL'),
    /** Nomor seri tercetak di kartu. Unik per part, bukan per pabrik. */
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }).notNull(),
    /** Isi satu kemasan. Dipakai menghitung qty saat kanban dikirim. */
    qtyPerBox: int('INT_QTY_PER_BOX').notNull().default(1),
    /**
     * Berapa unit yang ditempel ke kartu ini.
     *
     * Umumnya satu. Assembling tertentu menempelkan dua sekaligus — di sistem
     * lama itu ditangani dengan menambah kolom `code_part_2` lewat migrasi
     * susulan, dan kolom ketiga akan menuntut migrasi berikutnya. Di sini
     * isinya tabel tersendiri, jadi angka berapa pun tidak mengubah skema.
     */
    unitPerKanban: int('INT_UNIT_PER_KANBAN').notNull().default(1),
    /** LH / RH untuk part yang berpasangan kiri-kanan. */
    side: varchar('CHR_SIDE', { length: 8 }),
    boxType: varchar('CHR_BOX_TYPE', { length: 8 }),
    customerId: fk('INT_CUSTOMER_ID').references(() => customers.id),
    status: mysqlEnum('CHR_STATUS', KANBAN_STATUSES).notNull().default('CREATED'),
    producedAt: timestamp('DTM_PRODUCED_AT'),
    deliveredAt: timestamp('DTM_DELIVERED_AT'),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_KANBAN_PART_SERIAL_UNIQUE').on(t.partId, t.serialNumber),
    index('TM_KANBAN_PLANT_PART_IDX').on(t.plantId, t.partId),
    index('TM_KANBAN_STATUS_IDX').on(t.status, t.createdAt),
  ],
);

/**
 * Unit yang SEDANG menempel pada sebuah kartu kanban.
 *
 * Satu baris per unit, bukan kolom tetap. Sistem lama memakai `code_part` lalu
 * terpaksa menambah `code_part_2` lewat migrasi susulan ketika assembling mulai
 * menempelkan dua unit — dan kolom ketiga akan menuntut migrasi ketiga.
 *
 * ── Isi sekarang, bukan riwayat ─────────────────────────────────────────────
 *
 * Baris di sini DIHAPUS saat kartunya dikosongkan (barangnya terkirim). Yang
 * menyimpan riwayat adalah TT_KANBAN_EVENT yang append-only. Memisahkannya
 * membuat pertanyaan "apa isi kartu ini sekarang" tetap satu query sederhana,
 * bukan pelipatan seluruh riwayat.
 */
export const kanbanItems = mysqlTable(
  'TT_KANBAN_ITEM',
  {
    id: pk(),
    kanbanId: fk('INT_KANBAN_ID')
      .notNull()
      .references(() => kanbans.id, { onDelete: 'cascade' }),
    /** Nomor seri unit yang menempel — isi barcode yang discan operator. */
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }).notNull(),
    /** Scan produksi yang menempelkannya, untuk penelusuran balik. */
    scanEventId: fk('INT_SCAN_EVENT_ID'),
    attachedAt: timestamp('DTM_ATTACHED_AT').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    // Satu unit tidak bisa menempel dua kali pada kartu yang sama.
    uniqueIndex('TT_KANBAN_ITEM_KANBAN_SERIAL_UNIQUE').on(t.kanbanId, t.serialNumber),
    /*
     * Satu unit hanya boleh menempel pada SATU kartu. Tanpa ini, barang yang
     * sama bisa ikut dua kanban dan terkirim dua kali — selisihnya baru
     * ketahuan saat customer menghitung.
     */
    uniqueIndex('TT_KANBAN_ITEM_SERIAL_UNIQUE').on(t.serialNumber),
    index('TT_KANBAN_ITEM_KANBAN_IDX').on(t.kanbanId),
  ],
);

export const kanbanItemsRelations = relations(kanbanItems, ({ one }) => ({
  kanban: one(kanbans, { fields: [kanbanItems.kanbanId], references: [kanbans.id] }),
}));

export const KANBAN_EVENT_TYPES = [
  'PRODUCED',
  'PULLED',
  'PAIRED',
  'STORED',
  'LOADED',
  'DELIVERED',
  'CANCELLED',
  'ADJUSTED',
  /**
   * Isi kartu dikosongkan karena dinyatakan NG, bukan karena terkirim.
   *
   * Dibedakan dari CANCELLED yang membatalkan kartunya sendiri: di sini
   * kartunya tetap sah dan kembali ke lini, yang gugur adalah isinya.
   */
  'VOIDED',
] as const;

/**
 * Log append-only perjalanan kanban.
 *
 * Ini menggantikan tiga tabel terpisah di bella:
 *   kanban_after_prods + kanban_after_pulls + body_kanban_pairings
 * menjadi satu tabel dengan diskriminator `type`.
 *
 * Alasannya: tiga tabel itu strukturnya hampir identik dan setiap penambahan
 * tahap baru memaksa bikin tabel baru. Dengan event log, tahap baru cukup
 * menambah nilai enum.
 *
 * ATURAN: baris di sini tidak pernah di-UPDATE atau di-DELETE. Koreksi
 * dilakukan dengan menambah event ADJUSTED.
 */
export const kanbanEvents = mysqlTable(
  'TT_KANBAN_EVENT',
  {
    id: pk(),
    kanbanId: fk('INT_KANBAN_ID')
      .notNull()
      .references(() => kanbans.id, { onDelete: 'cascade' }),
    type: mysqlEnum('CHR_TYPE', KANBAN_EVENT_TYPES).notNull(),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    /** Kanban pasangan, dipakai saat type = PAIRED (body <-> part). */
    pairedKanbanId: fk('INT_PAIRED_KANBAN_ID'),
    qty: int('INT_QTY'),
    userId: fk('INT_USER_ID').references(() => users.id),
    deviceId: fk('INT_DEVICE_ID').references(() => devices.id),
    occurredAt: timestamp('DTM_OCCURRED_AT').notNull(),
    /** Payload tambahan spesifik per tipe event. Jangan taruh data yang perlu di-query di sini. */
    meta: json('CHR_META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index('TT_KANBAN_EVENT_KANBAN_IDX').on(t.kanbanId, t.occurredAt),
    index('TT_KANBAN_EVENT_TYPE_TIME_IDX').on(t.type, t.occurredAt),
  ],
);

export const kanbansRelations = relations(kanbans, ({ one, many }) => ({
  plant: one(plants, { fields: [kanbans.plantId], references: [plants.id] }),
  part: one(parts, { fields: [kanbans.partId], references: [parts.id] }),
  customer: one(customers, { fields: [kanbans.customerId], references: [customers.id] }),
  events: many(kanbanEvents),
}));

export const kanbanEventsRelations = relations(kanbanEvents, ({ one }) => ({
  kanban: one(kanbans, { fields: [kanbanEvents.kanbanId], references: [kanbans.id] }),
  line: one(lines, { fields: [kanbanEvents.lineId], references: [lines.id] }),
  user: one(users, { fields: [kanbanEvents.userId], references: [users.id] }),
  device: one(devices, { fields: [kanbanEvents.deviceId], references: [devices.id] }),
}));
