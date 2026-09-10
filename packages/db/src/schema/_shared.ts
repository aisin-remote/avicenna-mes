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
