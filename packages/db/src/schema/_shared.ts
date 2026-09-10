import { bigint, timestamp } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/** PK standar: BIGINT UNSIGNED AUTO_INCREMENT — sama dengan konvensi Laravel lama. */
export const pk = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

/** FK standar ke pk() di atas. */
export const fk = (name: string) => bigint(name, { mode: 'number', unsigned: true });

/** created_at / updated_at, penamaan snake_case supaya query SQL manual tetap familiar. */
export const timestamps = {
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
};

/**
 * Jenis proses produksi.
 *
 * INI generalisasi terpenting dari merge avicenna + bella:
 *   bella  -> model `Injection`      => INJECTION
 *   avicenna -> avi_trace_casting    => CASTING
 *               avi_trace_machining  => MACHINING
 *               avi_trace_assembling => ASSEMBLING
 *
 * Satu tabel proses, dibedakan kolom ini — bukan satu tabel per proses.
 */
export const PROCESS_TYPES = ['CASTING', 'MACHINING', 'ASSEMBLING', 'INJECTION'] as const;
export type ProcessType = (typeof PROCESS_TYPES)[number];

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
