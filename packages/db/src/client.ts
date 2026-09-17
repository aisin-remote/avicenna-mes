import './load-env';
import mysql from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from './schema/index';

export type Database = MySql2Database<typeof schema>;

let pool: mysql.Pool | undefined;
let dbInstance: Database | undefined;

function connectionUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL belum diset. Salin .env.example menjadi .env di root repo.');
  }
  return url;
}

/**
 * Pool dipakai bersama satu proses.
 *
 * Next.js dev me-reload modul tiap perubahan file; tanpa cache di globalThis
 * setiap reload membuka pool baru dan koneksi MySQL cepat habis.
 */
const globalForDb = globalThis as unknown as {
  __avicennaPool?: mysql.Pool;
  __avicennaDb?: Database;
};

export function getPool(): mysql.Pool {
  if (globalForDb.__avicennaPool) return globalForDb.__avicennaPool;
  if (pool) return pool;

  pool = mysql.createPool({
    uri: connectionUrl(),
    connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
    waitForConnections: true,
    enableKeepAlive: true,
    /*
     * ── KONVENSI ZONA WAKTU — BACA SEBELUM MENULIS SQL MENTAH ──────────────
     *
     * 'Z' berarti setiap Date yang ditulis dari Node disimpan sebagai UTC, dan
     * dibaca balik sebagai UTC pula. Bolak-baliknya UTUH: tulis 14:30 WIB,
     * baca 14:30 WIB.
     *
     * TETAPI kolom yang diisi MySQL sendiri — CURRENT_TIMESTAMP, NOW() —
     * memakai waktu LOKAL sesi. Akibatnya dalam SATU baris yang sama,
     * DTM_CREATED_AT dan DTM_SCANNED_AT berselisih 7 jam meski menandai momen
     * yang sama.
     *
     * Yang harus diingat saat menulis SQL mentah:
     *
     *   BOLEH   membandingkan kolom yang ditulis Node dengan parameter Date
     *           (drivernya yang mengonversi)
     *   BOLEH   membandingkan kolom isian MySQL dengan NOW()/CURDATE()
     *   JANGAN  mencampur keduanya — mis. DATE(DTM_SCANNED_AT) = CURDATE().
     *           Perbandingan seperti itu meleset 7 jam dan menghilangkan
     *           seluruh shift malam tanpa error apa pun.
     */
    timezone: 'Z',
    // Angka besar (BIGINT) dikembalikan sebagai string kalau melebihi Number.
    // supportBigNumbers menjaga id tidak terpotong diam-diam.
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: ['DATE'],
  });

  if (process.env.NODE_ENV !== 'production') globalForDb.__avicennaPool = pool;
  return pool;
}

export function getDb(): Database {
  if (globalForDb.__avicennaDb) return globalForDb.__avicennaDb;
  if (dbInstance) return dbInstance;

  dbInstance = drizzle(getPool(), { schema, mode: 'default' });
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
