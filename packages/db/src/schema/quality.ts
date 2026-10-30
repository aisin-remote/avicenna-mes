import { index, integer, jsonb, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  daftarNilai,
  enumCol,
  fk,
  pk,
  qualitySchema,
  timestamps,
  type ProcessType,
} from './_shared';
import { PROCESS_GROUPS } from '@avicenna/contracts';
import { parts, lines, machines, processTypes } from './master';
import { kanbans } from './kanban';
import { scanEvents } from './production';
import { plants, users } from './org';

/**
 * Master jenis NG (defect). Gabungan avi_trace_ng_master + master_item_checks bella.
 *
 * ── Lingkupnya GRUP proses, bukan jenis proses ──────────────────────────────
 *
 * "Crack" berlaku di lini Casting WIP maupun Casting FG; menyimpannya sebagai
 * CASTING_WIP akan membuat tombolnya hilang dari layar lini FG, dan orang di
 * situ tidak punya jenis NG apa pun untuk dipilih.
 *
 * Kosong berarti berlaku di semua proses — padanan "DLL" di layar lama.
 */
export const ngMasters = qualitySchema.table(
  'TM_NG',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    processGroup: enumCol('CHR_PROCESS_GROUP', PROCESS_GROUPS),
    category: varchar('CHR_CATEGORY', { length: 64 }),
    sortOrder: integer('INT_SORT_ORDER').notNull().default(0),
    isActive: enumCol('CHR_IS_ACTIVE', ['0', '1']).notNull().default('1'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_NG_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_NG_GROUP_IDX').on(t.plantId, t.processGroup, t.sortOrder),

    daftarNilai('TM_NG_CHR_PROCESS_GROUP_CHK', t.processGroup, PROCESS_GROUPS),
    daftarNilai('TM_NG_CHR_IS_ACTIVE_CHK', t.isActive, ['0', '1']),
  ],
);

/** Header pemeriksaan kualitas: satu sesi inspeksi. */
export const qualityInspections = qualitySchema.table(
  'TT_INSPECTION_H',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    machineId: fk('INT_MACHINE_ID').references(() => machines.id),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code)
      .notNull(),
    inspectedAt: timestamp('DTM_INSPECTED_AT', { withTimezone: true, mode: 'date' }).notNull(),
    shift: enumCol('CHR_SHIFT', ['1', '2', '3']),
    checkedQty: integer('INT_CHECKED_QTY').notNull().default(0),
    okQty: integer('INT_OK_QTY').notNull().default(0),
    ngQty: integer('INT_NG_QTY').notNull().default(0),
    inspectorId: fk('INT_INSPECTOR_ID').references(() => users.id),
    note: varchar('CHR_NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('TT_INSPECTION_H_PART_TIME_IDX').on(t.partId, t.inspectedAt),
    index('TT_INSPECTION_H_LINE_TIME_IDX').on(t.lineId, t.inspectedAt),
    daftarNilai('TT_INSPECTION_H_CHR_SHIFT_CHK', t.shift, ['1', '2', '3']),
  ],
);

/**
 * Rincian NG per jenis defect dalam satu inspeksi (anak dari quality_inspections).
 *
 * Nama tabelnya sengaja dipendekkan, bukan `quality_inspection_details`:
 * MySQL membatasi nama identifier 64 karakter, dan nama constraint FK yang
 * dibangkitkan Drizzle dari nama panjang itu menembus batas tersebut.
 * Jalankan `pnpm db:check-names` setelah menambah tabel baru.
 */
export const inspectionDetails = qualitySchema.table(
  'TT_INSPECTION_L',
  {
    id: pk(),
    inspectionId: fk('INT_INSPECTION_ID')
      .notNull()
      .references(() => qualityInspections.id, { onDelete: 'cascade' }),
    ngMasterId: fk('INT_NG_MASTER_ID')
      .notNull()
      .references(() => ngMasters.id),
    qty: integer('INT_QTY').notNull().default(0),
    meta: jsonb('CHR_META'),
    createdAt: timestamps.createdAt,
  },
  (t) => [index('TT_INSPECTION_L_INSPECTION_IDX').on(t.inspectionId)],
);

export const qualityInspectionsRelations = relations(qualityInspections, ({ one, many }) => ({
  plant: one(plants, { fields: [qualityInspections.plantId], references: [plants.id] }),
  part: one(parts, { fields: [qualityInspections.partId], references: [parts.id] }),
  line: one(lines, { fields: [qualityInspections.lineId], references: [lines.id] }),
  inspector: one(users, { fields: [qualityInspections.inspectorId], references: [users.id] }),
  details: many(inspectionDetails),
}));

export const inspectionDetailsRelations = relations(inspectionDetails, ({ one }) => ({
  inspection: one(qualityInspections, {
    fields: [inspectionDetails.inspectionId],
    references: [qualityInspections.id],
  }),
  ngMaster: one(ngMasters, {
    fields: [inspectionDetails.ngMasterId],
    references: [ngMasters.id],
  }),
}));

/* ────────────────────────────────────────────────────────────────────────────
 * CATATAN NG
 * ──────────────────────────────────────────────────────────────────────────── */

export const NG_ORIGINS = ['INLINE', 'OUTLINE'] as const;
export const NG_SOURCES = ['PART_CODE', 'KANBAN'] as const;

/**
 * Satu baris = satu jenis NG pada satu barang.
 *
 * Sebuah barang bisa punya beberapa jenis NG sekaligus (retak DAN kotor), jadi
 * kuncinya (barang, jenis NG) — bukan barang saja. Itu mengikuti avi_trace_ngs
 * yang memang menyimpan satu baris per (code, id_ng).
 *
 * ── Tidak pernah DIHAPUS ────────────────────────────────────────────────────
 *
 * Sistem lama membatalkan NG dengan `$partNg->delete()`, dan pada NG machining
 * juga menghapus baris produksinya (`avi_trace_machining::delete()`). Barang
 * yang benar-benar dibuat lalu hilang dari catatan membuat hasil produksi hari
 * itu tidak pernah bisa dicocokkan lagi, dan tidak ada jejak siapa yang
 * menghapus apa.
 *
 * Di sini pembatalan mengisi DTM_CANCELLED_AT. Barisnya tetap ada.
 *
 * ── CHR_ACTIVE_KEY: kenapa ada kolom yang isinya gabungan kolom lain ────────
 *
 * Yang ingin dijaga: satu barang tidak boleh punya DUA catatan NG aktif untuk
 * jenis yang sama — kalau bisa, angka NG-nya menggelembung tanpa ada barang
 * tambahan yang rusak. MySQL tidak punya unique index bersyarat, sedangkan
 * unique index biasa pada (barang, jenis) akan ikut menghitung baris yang sudah
 * dibatalkan, sehingga NG yang dibatalkan tidak akan pernah bisa dicatat lagi.
 *
 * Kolom ini berisi "<barang>|<jenis>" selama catatannya aktif, dan dikosongkan
 * (NULL) saat dibatalkan. MySQL mengizinkan NULL berulang pada unique index,
 * jadi hasilnya persis "unik selama aktif" — ditegakkan database, bukan oleh
 * pemeriksaan di aplikasi yang bisa kalah balapan saat dua orang men-scan
 * barang yang sama bersamaan.
 *
 * Panjangnya 320 supaya muat CHR_RAW_CODE terpanjang (255) + pemisah + id.
 */
export const ngRecords = qualitySchema.table(
  'TT_NG',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code),
    ngMasterId: fk('INT_NG_MASTER_ID')
      .notNull()
      .references(() => ngMasters.id),
    origin: enumCol('CHR_ORIGIN', NG_ORIGINS).notNull(),
    source: enumCol('CHR_SOURCE', NG_SOURCES).notNull(),
    /** Isi barcode yang discan, apa adanya — part code atau kartu kanban. */
    rawCode: varchar('CHR_RAW_CODE', { length: 255 }).notNull(),
    /** Identitas barangnya. Untuk NG lewat kanban, ini seri unit yang menempel. */
    serialNumber: varchar('CHR_SERIAL_NUMBER', { length: 64 }),
    /** Kartu yang dikosongkan, bila NG-nya dinyatakan lewat kanban. */
    kanbanId: fk('INT_KANBAN_ID').references(() => kanbans.id),
    /**
     * Scan produksi yang dibalik.
     *
     * Kosong berarti barangnya memang belum pernah tercatat sebagai hasil baik
     * di proses itu — NG di lini sering ketemu sebelum barangnya sempat discan.
     * Membedakan keduanya penting: hanya yang pernah tercatat yang boleh
     * dikurangi dari stok.
     */
    scanEventId: fk('INT_SCAN_EVENT_ID').references(() => scanEvents.id),
    qty: integer('INT_QTY').notNull().default(1),
    occurredAt: timestamp('DTM_OCCURRED_AT', { withTimezone: true, mode: 'date' }).notNull(),
    npk: varchar('CHR_NPK', { length: 32 }),
    userId: fk('INT_USER_ID').references(() => users.id),

    cancelledAt: timestamp('DTM_CANCELLED_AT', { withTimezone: true, mode: 'date' }),
    cancelledById: fk('INT_CANCELLED_BY_ID').references(() => users.id),
    cancelReason: varchar('CHR_CANCEL_REASON', { length: 255 }),

    activeKey: varchar('CHR_ACTIVE_KEY', { length: 320 }),
    meta: jsonb('CHR_META'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TT_NG_ACTIVE_UNIQUE').on(t.activeKey),
    index('TT_NG_PART_TIME_IDX').on(t.partId, t.occurredAt),
    index('TT_NG_MASTER_TIME_IDX').on(t.ngMasterId, t.occurredAt),
    index('TT_NG_LINE_TIME_IDX').on(t.lineId, t.occurredAt),
    index('TT_NG_SERIAL_IDX').on(t.serialNumber),
    index('TT_NG_KANBAN_IDX').on(t.kanbanId),
    daftarNilai('TT_NG_CHR_ORIGIN_CHK', t.origin, NG_ORIGINS),
    daftarNilai('TT_NG_CHR_SOURCE_CHK', t.source, NG_SOURCES),
  ],
);

export const ngMastersRelations = relations(ngMasters, ({ one, many }) => ({
  plant: one(plants, { fields: [ngMasters.plantId], references: [plants.id] }),
  records: many(ngRecords),
}));

export const ngRecordsRelations = relations(ngRecords, ({ one }) => ({
  plant: one(plants, { fields: [ngRecords.plantId], references: [plants.id] }),
  part: one(parts, { fields: [ngRecords.partId], references: [parts.id] }),
  line: one(lines, { fields: [ngRecords.lineId], references: [lines.id] }),
  ngMaster: one(ngMasters, { fields: [ngRecords.ngMasterId], references: [ngMasters.id] }),
  kanban: one(kanbans, { fields: [ngRecords.kanbanId], references: [kanbans.id] }),
  scanEvent: one(scanEvents, { fields: [ngRecords.scanEventId], references: [scanEvents.id] }),
  user: one(users, { fields: [ngRecords.userId], references: [users.id] }),
}));
