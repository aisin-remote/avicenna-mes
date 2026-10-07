import {
  mysqlTable,
  varchar,
  int,
  time,
  date,
  timestamp,
  boolean,
  mysqlEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { plants, users } from './org';
import { lines, parts } from './master';

/**
 * ─── JAM KERJA DAN WAKTU BERHENTI ───────────────────────────────────────────
 *
 * Tiga hal yang harus ada lebih dulu sebelum laporan produksi apa pun bisa
 * dipercaya: KAPAN lini seharusnya berproduksi, KAPAN ia direncanakan berhenti,
 * dan KAPAN ia berhenti di luar rencana beserta alasannya.
 *
 * Ketiganya DATA, bukan tetapan di kode. Jam kerja UNIT dan BODY berbeda, dan
 * keduanya berubah mengikuti kebutuhan produksi — jam mulai hari produksi yang
 * ditanam di kode (dulu 07:00) membuat penghitung per jam di satu pabrik selalu
 * meleset tanpa ada yang bisa membetulkannya sendiri.
 */

/**
 * Jam kerja sebuah pabrik: satu baris per shift.
 *
 * Shift malam melewati tengah malam (23:00-07:00), jadi `endTime` boleh lebih
 * kecil dari `startTime`. Yang membaca harus memperlakukannya sebagai rentang
 * yang menyeberang hari — lihat `jamKerjaMenyeberang()` di domain.
 */
export const workTimes = mysqlTable(
  'TM_WORK_TIME',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Kode shift: "1", "2", "3", atau apa pun yang dipakai pabrik itu. */
    code: varchar('CHR_CODE', { length: 16 }).notNull(),
    name: varchar('CHR_NAME', { length: 64 }).notNull(),
    startTime: time('DTM_START_TIME').notNull(),
    endTime: time('DTM_END_TIME').notNull(),
    /**
     * Shift yang MEMULAI hari produksi di pabrik ini.
     *
     * Hari produksi dimulai pada jam mulai shift ini, bukan tengah malam:
     * scan pukul 02:00 masih masuk hari kemarin. Tepat satu shift per pabrik
     * yang boleh ditandai — kalau tidak ada, hari produksi jatuh ke bawaan.
     */
    startsProductionDay: boolean('FLG_STARTS_PRODUCTION_DAY').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_WORK_TIME_PLANT_CODE_UNIQUE').on(t.plantId, t.code)],
);

/**
 * Istirahat terjadwal di dalam sebuah shift.
 *
 * Dipotong dari waktu kerja saat menghitung efisiensi: lini yang berhenti
 * karena jam istirahat bukan lini yang bermasalah, dan memasukkannya sebagai
 * kerugian membuat angka efisiensi selalu terlihat buruk tanpa sebab yang bisa
 * ditindaklanjuti.
 */
export const workBreaks = mysqlTable(
  'TM_WORK_BREAK',
  {
    id: pk(),
    workTimeId: fk('INT_WORK_TIME_ID')
      .notNull()
      .references(() => workTimes.id, { onDelete: 'cascade' }),
    name: varchar('CHR_NAME', { length: 64 }).notNull(),
    startTime: time('DTM_START_TIME').notNull(),
    endTime: time('DTM_END_TIME').notNull(),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('TM_WORK_BREAK_SHIFT_IDX').on(t.workTimeId)],
);

/**
 * Kategori alasan berhenti.
 *
 * Yang membedakan bukan sekadar namanya, melainkan apakah ia DIRENCANAKAN.
 * Setup dan pemeriksaan kualitas memang bagian dari pekerjaan; kerusakan mesin
 * tidak. Laporan efisiensi memisahkan keduanya, dan tanpa pembedaan ini satu
 * angka besar "loss" tidak memberi tahu apa pun tentang apa yang harus
 * diperbaiki.
 */
export const STOP_REASON_CATEGORIES = [
  'PROBLEM',
  'SETUP',
  'QC',
  'CHANGEOVER',
  'MATERIAL',
  'LAINNYA',
] as const;

/**
 * Master alasan berhenti — menempel pada lini.
 *
 * `lineId` kosong berarti alasan itu berlaku untuk SEMUA lini di pabrik
 * tersebut. Alasan yang khas satu lini (mis. "ganti nozzle" di injection) cukup
 * dibuat untuk lini itu saja, sehingga daftar di layar operator tetap pendek —
 * daftar panjang berisi alasan yang tidak relevan akan selalu diisi asal pilih.
 */
export const stopReasons = mysqlTable(
  'TM_STOP_REASON',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Kosong = berlaku untuk semua lini di pabrik ini. */
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    category: mysqlEnum('CHR_CATEGORY', STOP_REASON_CATEGORIES).notNull().default('PROBLEM'),
    /** Direncanakan = tidak dihitung sebagai kerugian yang harus ditindaklanjuti. */
    isPlanned: boolean('FLG_IS_PLANNED').notNull().default(false),
    /** Urutan tampil di layar operator — yang paling sering dipakai di atas. */
    sortOrder: int('INT_SORT_ORDER').notNull().default(0),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_STOP_REASON_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_STOP_REASON_LINE_IDX').on(t.lineId, t.isActive),
  ],
);

/** Bagaimana sebuah baris berhenti ditutup. */
export const STOP_CLOSED_BY = ['TOMBOL', 'SCAN', 'SISTEM'] as const;

/**
 * Satu kali lini berhenti.
 *
 * `endedAt` kosong berarti lini SEDANG berhenti — dan dari situlah status
 * RUNNING/STOP di dashboard diturunkan. Status tidak disimpan sebagai kolom
 * tersendiri: kolom seperti itu pasti melenceng dari kenyataan begitu ada satu
 * proses yang lupa memperbaruinya, dan yang terlihat di layar monitor lantai
 * produksi menjadi bohong tanpa ada yang menyadarinya.
 *
 * Ditutup lewat tombol "Mulai", atau OTOMATIS oleh scan berikutnya: operator
 * yang lupa menekan tombol tetap berproduksi, dan menolak scan-nya berarti
 * hasil produksi hilang hanya karena tombol terlewat. Penutupnya dicatat supaya
 * selisih keduanya bisa diperiksa.
 */
export const lineStops = mysqlTable(
  'TT_LINE_STOP',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID')
      .notNull()
      .references(() => lines.id),
    /** Part yang sedang dikerjakan saat berhenti — untuk laporan per model. */
    partId: fk('INT_PART_ID').references(() => parts.id),
    reasonId: fk('INT_STOP_REASON_ID').references(() => stopReasons.id),
    /** Hari produksi, bukan tanggal kalender. Berhenti pukul 02:00 milik hari kemarin. */
    productionDate: date('DTM_PRODUCTION_DATE', { mode: 'string' }).notNull(),
    startedAt: timestamp('DTM_STARTED_AT').notNull(),
    /** Kosong = masih berhenti sampai sekarang. */
    endedAt: timestamp('DTM_ENDED_AT'),
    closedBy: mysqlEnum('CHR_CLOSED_BY', STOP_CLOSED_BY),
    npk: varchar('CHR_NPK', { length: 32 }),
    userId: fk('INT_USER_ID').references(() => users.id),
    note: varchar('CHR_NOTE', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    index('TT_LINE_STOP_LINE_TIME_IDX').on(t.lineId, t.startedAt),
    index('TT_LINE_STOP_DATE_IDX').on(t.productionDate, t.lineId),
    /*
     * Mencari baris yang masih terbuka adalah kueri paling sering di layar
     * operator maupun dashboard — tiap kali layar dimuat, untuk tiap lini.
     */
    index('TT_LINE_STOP_OPEN_IDX').on(t.lineId, t.endedAt),
  ],
);

export const workTimesRelations = relations(workTimes, ({ one, many }) => ({
  plant: one(plants, { fields: [workTimes.plantId], references: [plants.id] }),
  breaks: many(workBreaks),
}));

export const workBreaksRelations = relations(workBreaks, ({ one }) => ({
  workTime: one(workTimes, { fields: [workBreaks.workTimeId], references: [workTimes.id] }),
}));

export const stopReasonsRelations = relations(stopReasons, ({ one, many }) => ({
  plant: one(plants, { fields: [stopReasons.plantId], references: [plants.id] }),
  line: one(lines, { fields: [stopReasons.lineId], references: [lines.id] }),
  stops: many(lineStops),
}));

export const lineStopsRelations = relations(lineStops, ({ one }) => ({
  plant: one(plants, { fields: [lineStops.plantId], references: [plants.id] }),
  line: one(lines, { fields: [lineStops.lineId], references: [lines.id] }),
  part: one(parts, { fields: [lineStops.partId], references: [parts.id] }),
  reason: one(stopReasons, { fields: [lineStops.reasonId], references: [stopReasons.id] }),
}));
