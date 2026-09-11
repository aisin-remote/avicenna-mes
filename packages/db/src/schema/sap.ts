import {
  mysqlTable,
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

export const SAP_OUTBOX_STATUSES = ['PENDING', 'SENT', 'FAILED', 'HELD', 'SKIPPED'] as const;

/**
 * Antrean dokumen yang harus sampai ke SAP.
 *
 * Kita MENDORONG ke tabel di MS SQL, lalu SAP membacanya dari sana. Tulisan ke
 * MS SQL tidak bisa ikut dalam transaksi MySQL — dua database berbeda — dan
 * kalau MS SQL sedang mati, scan di lantai produksi tidak boleh ikut gagal.
 * Karena itu perpindahan barang dicatat dulu di sini, lalu dikirim terpisah.
 *
 * Statusnya:
 *   PENDING  belum dikirim
 *   SENT     sudah masuk MS SQL
 *   FAILED   pengiriman gagal, akan dicoba lagi
 *   HELD     movement type-nya belum diputuskan tim SAP — sengaja ditahan
 *   SKIPPED  memang tidak perlu dikirim (mis. hasil stock opname)
 *
 * HELD dan SKIPPED sengaja dibedakan dari FAILED. Dokumen yang tertahan karena
 * menunggu keputusan bukan kegagalan teknis, dan mencampurnya membuat layar
 * pemantauan penuh "error" yang tidak ada yang bisa memperbaikinya.
 */
export const sapOutbox = mysqlTable(
  'TT_SAP_OUTBOX',
  {
    id: pk(),
    plantId: fk('PLANT_ID')
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
    sourceTable: varchar('SOURCE_TABLE', { length: 64 }).notNull(),
    sourceId: fk('SOURCE_ID').notNull(),

    docType: varchar('DOC_TYPE', { length: 32 }).notNull(),
    /** Movement type SAP. Kosong berarti belum diputuskan — lihat status HELD. */
    movementType: varchar('MOVEMENT_TYPE', { length: 8 }),

    /**
     * Kunci idempoten LINTAS SISTEM.
     *
     * Dikirim ikut ke MS SQL supaya sisi sana bisa mengenali kiriman ulang.
     * Tanpa ini, satu gangguan jaringan saat pengiriman berarti dokumen yang
     * sama diposting dua kali di SAP — dan koreksinya harus dilakukan manual
     * oleh orang finance.
     */
    idempotencyKey: varchar('IDEMPOTENCY_KEY', { length: 128 }).notNull(),

    /** Isi dokumen: kepala beserta barisnya, dalam bentuk yang dibaca SAP. */
    payload: json('PAYLOAD').notNull(),

    status: mysqlEnum('STATUS', SAP_OUTBOX_STATUSES).notNull().default('PENDING'),
    attempts: int('ATTEMPTS').notNull().default(0),
    lastError: varchar('LAST_ERROR', { length: 1000 }),
    /** Nomor dokumen material yang dikembalikan SAP, bila ada. */
    sapDocNumber: varchar('SAP_DOC_NUMBER', { length: 32 }),

    /** Kapan perpindahan barangnya terjadi — bukan kapan barisnya dibuat. */
    occurredAt: timestamp('OCCURRED_AT').notNull(),
    sentAt: timestamp('SENT_AT'),
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
