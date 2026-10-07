import {
  mysqlTable,
  bigint,
  boolean,
  varchar,
  int,
  mysqlEnum,
  timestamp,
  json,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { plants } from './org';

export const SAP_OUTBOX_STATUSES = [
  'PENDING',
  'SENT',
  'CONFIRMED',
  'REJECTED',
  'FAILED',
  'HELD',
  'SKIPPED',
] as const;

/**
 * Antrean dokumen yang harus sampai ke SAP.
 *
 * Kita MENDORONG ke database jembatan (staging) di MS SQL, lalu SAP menariknya
 * dari sana. Tulisan ke MS SQL tidak bisa ikut dalam transaksi MySQL — dua
 * database berbeda — dan kalau MS SQL sedang mati, scan di lantai produksi
 * tidak boleh ikut gagal. Karena itu perpindahan barang dicatat dulu di sini,
 * lalu didorong terpisah.
 *
 * Statusnya:
 *   PENDING    belum didorong ke staging
 *   SENT       sudah masuk staging, MENUNGGU diproses SAP
 *   CONFIRMED  SAP sudah memproses dan berhasil — flag di staging bernilai OK
 *   REJECTED   SAP menolak — flag di staging bernilai gagal, perlu dilihat orang
 *   FAILED     gagal teknis saat mendorong ke staging, akan dicoba lagi
 *   HELD       movement type-nya belum diputuskan tim SAP — sengaja ditahan
 *   SKIPPED    memang tidak perlu dikirim (mis. hasil stock opname)
 *
 * SENT sengaja BUKAN status akhir. Barisnya sampai di staging bukan berarti SAP
 * sudah menerimanya; yang menentukan itu flag yang ditulis balik oleh SAP.
 * Menganggap SENT sebagai selesai berarti dokumen yang ditolak SAP menghilang
 * dari pandangan, dan selisihnya baru ketahuan saat tutup buku.
 *
 * HELD dan SKIPPED dibedakan dari FAILED. Dokumen yang tertahan karena menunggu
 * keputusan bukan kegagalan teknis, dan mencampurnya membuat layar pemantauan
 * penuh "error" yang tidak ada yang bisa memperbaikinya. REJECTED juga berdiri
 * sendiri: itu penolakan dari SAP, bukan gangguan jaringan, dan mencobanya lagi
 * tanpa memperbaiki datanya hanya akan ditolak lagi.
 */
export const sapOutbox = mysqlTable(
  'TT_SAP_OUTBOX',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),

    /*
     * Dokumen asal di sistem ini, BESERTA jenis dokumen SAP-nya.
     *
     * Ketiganya bersama yang membuat pengumpulan idempoten. Jenis dokumen ikut
     * menjadi kunci karena satu dokumen asal bisa menghasilkan dua perpindahan
     * yang berbeda di mata SAP: satu loading list memuat pulling (PP02 ke PP04,
     * movement 311) DAN pengiriman keluar (PP04, movement 601). Tanpa jenis
     * dokumen sebagai pembeda, keduanya tergabung menjadi satu baris dan salah
     * satu movement type-nya pasti hilang.
     */
    sourceTable: varchar('CHR_SOURCE_TABLE', { length: 64 }).notNull(),
    sourceId: fk('INT_SOURCE_ID').notNull(),

    docType: varchar('CHR_DOC_TYPE', { length: 32 }).notNull(),
    /** Movement type SAP. Kosong berarti belum diputuskan — lihat status HELD. */
    movementType: varchar('CHR_MOVEMENT_TYPE', { length: 8 }),

    /**
     * Kunci idempoten LINTAS SISTEM.
     *
     * Dikirim ikut ke MS SQL supaya sisi sana bisa mengenali kiriman ulang.
     * Tanpa ini, satu gangguan jaringan saat pengiriman berarti dokumen yang
     * sama diposting dua kali di SAP — dan koreksinya harus dilakukan manual
     * oleh orang finance.
     */
    idempotencyKey: varchar('CHR_IDEMPOTENCY_KEY', { length: 128 }).notNull(),

    /** Isi dokumen: kepala beserta barisnya, dalam bentuk yang dibaca SAP. */
    payload: json('CHR_PAYLOAD').notNull(),

    status: mysqlEnum('CHR_STATUS', SAP_OUTBOX_STATUSES).notNull().default('PENDING'),
    isSimulation: boolean('FLG_SIMULATION').notNull().default(false),
    attempts: int('INT_ATTEMPTS').notNull().default(0),
    lastError: varchar('CHR_LAST_ERROR', { length: 1000 }),
    /** Nomor dokumen material yang dikembalikan SAP, bila ada. */
    sapDocNumber: varchar('CHR_SAP_DOC_NUMBER', { length: 32 }),

    /**
     * Nomor dokumen yang DIBERIKAN staging saat baris ini didorong.
     *
     * `INT_NUMBER` di TT_GOODS_MOVEMENT_H dan TT_PRODUCTION_RESULT ternyata
     * kolom IDENTITY — SQL Server menolak nilai yang kita tentukan sendiri.
     * Jadi nomornya datang dari sana, dan disimpan di sini karena dialah yang
     * dipakai membaca balasan SAP dan mencegah dokumen yang sama terdorong
     * dua kali.
     */
    stagingNumber: bigint('INT_STAGING_NUMBER', { mode: 'number' }),

    /** Kapan perpindahan barangnya terjadi — bukan kapan barisnya dibuat. */
    occurredAt: timestamp('DTM_OCCURRED_AT').notNull(),

    /** Kapan barisnya mendarat di staging. Belum tentu sudah diproses SAP. */
    sentAt: timestamp('DTM_SENT_AT'),

    /**
     * Kapan SAP menutup barisnya — diisi dari flag yang dibaca balik dari
     * staging, bukan dari jam kita. Selisih SENT_AT ke CONFIRMED_AT adalah
     * berapa lama dokumen menunggu di jembatan, dan itu satu-satunya cara
     * melihat SAP mulai tertinggal sebelum tunggakannya menumpuk.
     */
    confirmedAt: timestamp('DTM_CONFIRMED_AT'),
    ...timestamps,
  },
  (t) => [
    // Satu dokumen asal + satu jenis dokumen SAP = satu baris. Inilah yang
    // menahan pengumpul supaya tidak pernah menggandakan.
    uniqueIndex('TT_SAP_OUTBOX_SOURCE_UNIQUE').on(t.sourceTable, t.sourceId, t.docType),
    uniqueIndex('TT_SAP_OUTBOX_IDEMPOTENCY_UNIQUE').on(t.idempotencyKey),
    index('TT_SAP_OUTBOX_STATUS_IDX').on(t.status, t.occurredAt),
  ],
);

export const sapOutboxRelations = relations(sapOutbox, ({ one }) => ({
  plant: one(plants, { fields: [sapOutbox.plantId], references: [plants.id] }),
}));
