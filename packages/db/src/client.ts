import './load-env';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let dbInstance: Database | undefined;

function connectionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL belum diset. Salin .env.example menjadi .env di root repo.');
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      `DATABASE_URL bukan URL Postgres: "${url.split('://')[0]}://…". ` +
        'Sejak pindah ke Postgres bentuknya postgresql://user:sandi@host:5432/avicenna',
    );
  }
  return url;
}

/**
 * Pool dipakai bersama satu proses.
 *
 * Next.js dev me-reload modul tiap perubahan file; tanpa cache di globalThis
 * setiap reload membuka pool baru dan koneksi cepat habis.
 */
const globalForDb = globalThis as unknown as {
  __avicennaPool?: Pool;
  __avicennaDb?: Database;
};

export function getPool(): Pool {
  if (globalForDb.__avicennaPool) return globalForDb.__avicennaPool;
  if (pool) return pool;

  pool = new Pool({
    connectionString: connectionUrl(),
    max: Number(process.env.DB_POOL_SIZE ?? 10),
    /*
     * ── KONVENSI ZONA WAKTU — BACA SEBELUM MENULIS SQL MENTAH ──────────────
     *
     * Seluruh kolom waktu bertipe `timestamptz`: yang disimpan adalah MOMEN,
     * bukan angka jam tanpa keterangan. Menulis dan membaca Date dari Node
     * selalu utuh, apa pun zona sesinya — ini yang dulu tidak berlaku di MySQL,
     * tempat kolom isian aplikasi (UTC) dan kolom ber-DEFAULT CURRENT_TIMESTAMP
     * (waktu lokal server) bisa berselisih tujuh jam PADA BARIS YANG SAMA.
     *
     * Yang MASIH bergantung pada zona sesi adalah ekspresi yang memotong waktu
     * menjadi tanggal atau jam: `CURRENT_DATE`, `kolom::date`, `date_trunc`,
     * `extract(hour from ...)`. Karena itu sesinya dipatok ke Asia/Jakarta —
     * bukan UTC — sebab "hari produksi" dan "jam 06-07" yang dimaksud laporan
     * adalah jam dinding pabrik. Dengan UTC, seluruh shift malam akan jatuh ke
     * tanggal yang salah, dan tidak ada galat apa pun yang muncul.
     *
     * Dipatok di sini, bukan dititipkan pada konfigurasi server: server staging
     * dan server produksi tidak harus punya setelan yang sama, dan laporan
     * produksi tidak boleh bergantung pada hal yang tidak kita kendalikan.
     */
    options: `-c timezone=${process.env.DB_TIMEZONE ?? 'Asia/Jakarta'}`,
  });

  if (process.env.NODE_ENV !== 'production') globalForDb.__avicennaPool = pool;
  return pool;
}

export function getDb(): Database {
  if (globalForDb.__avicennaDb) return globalForDb.__avicennaDb;
  if (dbInstance) return dbInstance;

  dbInstance = drizzle(getPool(), { schema });
  if (process.env.NODE_ENV !== 'production') globalForDb.__avicennaDb = dbInstance;
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  const p = globalForDb.__avicennaPool ?? pool;
  if (p) await p.end();
  globalForDb.__avicennaPool = undefined;
  globalForDb.__avicennaDb = undefined;
  pool = undefined;
  dbInstance = undefined;
}
