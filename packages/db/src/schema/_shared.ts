import { bigint, timestamp } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/** PK standar: BIGINT UNSIGNED AUTO_INCREMENT — sama dengan konvensi Laravel lama. */
export const pk = () => bigint('INT_ID', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

/** FK standar ke pk() di atas. */
export const fk = (name: string) => bigint(name, { mode: 'number', unsigned: true });

/**
 * created_at / updated_at.
 *
 * Prefiks DTM_ mengikuti konvensi database staging (CHR_/INT_/FLT_), tetapi
 * dengan prefiks yang JUJUR soal tipe: staging menyimpan tanggal sebagai
 * CHR_ char(8) + char(6) terpisah, sedangkan kolom ini timestamp sungguhan.
 * Menamainya CHR_ akan menyesatkan tanpa menambah kejelasan apa pun.
 */
export const timestamps = {
  createdAt: timestamp('DTM_CREATED_AT').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('DTM_UPDATED_AT')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
};

/**
 * Jenis proses produksi.
 *
 * Diambil dari rute nyata part di AIIA, bukan dikarang. Dua alur yang berbeda
 * sepenuhnya berjalan di pabrik yang berbeda:
 *
 *   UNIT  MELTING -> CASTING -> MACHINING -> ASSEMBLING_UNIT -> DELIVERY
 *   BODY  INJECTION -> PAINTING -> ASSEMBLING_BODY -> DELIVERY
 *
 * Casting dan machining masing-masing punya lini WIP dan lini FG yang TERPISAH
 * secara fisik — lihat FINISH_GOOD_PROCESSES di bawah.
 *
 * ── Kenapa ASSEMBLING dipecah dua ───────────────────────────────────────────
 *
 * Di tabel rute AIIA, "Assembling" muncul sebagai DUA kolom terpisah: satu
 * setelah Machining di alur UNIT, satu setelah Painting di alur BODY. Keduanya
 * proses yang berlainan, dikerjakan di lini yang berbeda. Menyatukannya menjadi
 * satu nilai membuat hasil kedua pabrik tercampur di laporan, dan tidak ada cara
 * memisahkannya kembali setelah datanya terlanjur masuk.
 *
 * ── Urutan di daftar ini TIDAK menentukan rute ──────────────────────────────
 *
 * Rute melekat pada PART, bukan pada jenis prosesnya — lihat TM_PROCESS_PARTS.
 * Dua part di proyek yang sama pun bisa berbeda rute: pada proyek 660A, GARNISH
 * melewati Injection lalu langsung Assembling, sedangkan HANDLE melewati
 * Painting lebih dulu. Daftar ini hanya kosakata yang sah, bukan urutannya.
 */
/*
 * Diimpor dari @avicenna/contracts, TIDAK didefinisikan ulang di sini.
 *
 * Kolom enum di database dan pilihan di formulir harus selalu sama persis;
 * dua daftar terpisah pernah menyimpang dua kali.
 */
export {
  PROCESS_TYPES,
  FINISH_GOOD_PROCESSES,
  PROCESS_LABELS,
  menghasilkanFinishGood,
  type ProcessType,
} from '@avicenna/contracts';

/**
 * Jenis part menurut posisinya di rantai pasok.
 *
 * Diperlukan karena `parts` sebelumnya tidak membedakan raw material, komponen
 * beli, dan barang jadi — padahal aturannya berbeda: raw material tidak punya
 * BOM, barang jadi tidak dibeli, dan WIP tidak dikirim ke customer.
 */
export const PART_TYPES = ['RAW_MATERIAL', 'COMPONENT', 'WIP', 'FINISHED_GOOD'] as const;
export type PartType = (typeof PART_TYPES)[number];

/** Dibeli dari supplier, atau diproduksi sendiri. */
export const SOURCE_TYPES = ['PURCHASED', 'MANUFACTURED'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Cara part ditelusuri.
 *
 * KEPUTUSAN PALING MENENTUKAN di seluruh skema ini — lihat
 * docs/traceability-model.md.
 *
 *   SERIAL   satu barcode = satu barang. Part hasil casting dan barang jadi.
 *   LOT      sekelompok barang satu batch. Raw material dan komponen beli.
 *   QUANTITY hanya jumlah, tanpa identitas. Consumable.
 *
 * Raw material yang dilebur mustahil diberi nomor seri, sementara part hasil
 * casting justru sudah discan satu per satu. Memaksa satu cara untuk semuanya
 * akan mematahkan salah satunya.
 */
export const TRACKING_MODES = ['SERIAL', 'LOT', 'QUANTITY'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];
