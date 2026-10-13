import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Memeriksa panjang identifier di SQL hasil `drizzle-kit generate`.
 *
 * Postgres MEMOTONG identifier yang lebih dari 63 byte, dan memotongnya DIAM —
 * tanpa galat. Dua constraint yang 63 karakter pertamanya sama akan bertabrakan
 * sesudah dipotong, dan yang muncul adalah "already exists" pada nama yang di
 * berkas migrasi jelas-jelas berbeda.
 *
 * Drizzle membangun nama constraint FK dari gabungan nama tabel dan kolom,
 * sehingga tabel dengan nama panjang mudah menembus batas itu. Yang terpanjang
 * sekarang 62 karakter — hanya satu karakter dari batasnya.
 *
 * Jalankan setiap kali menambah tabel: pnpm db:check-names
 */
/*
 * 63, bukan 64: NAMEDATALEN Postgres bawaannya 64 BYTE termasuk penutup nol,
 * jadi yang muat hanyalah 63.
 */
const MAX_IDENTIFIER_LENGTH = 63;
const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

function main(): void {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch {
    console.log('[check-names] folder drizzle/ belum ada, lewati.');
    return;
  }

  const offenders: Array<{ file: string; name: string; length: number }> = [];

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    /*
     * Identifier di Postgres dikutip dengan tanda kutip ganda.
     *
     * Versi sebelumnya mencari backtick MySQL. Dibiarkan begitu, pemeriksaan
     * ini tidak menemukan apa pun sesudah pindah dialek lalu melaporkan "OK" —
     * penjaga yang selalu lulus justru lebih buruk daripada tidak ada penjaga.
     */
    const matches = sql.matchAll(/"([A-Za-z0-9_]+)"/g);
    const seen = new Set<string>();
    for (const m of matches) {
      const name = m[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (name.length > MAX_IDENTIFIER_LENGTH) {
        offenders.push({ file, name, length: name.length });
      }
    }
  }

  if (offenders.length === 0) {
    console.log(`[check-names] OK — semua identifier <= ${MAX_IDENTIFIER_LENGTH} karakter.`);
    return;
  }

  console.error(`[check-names] ${offenders.length} identifier melebihi batas Postgres:\n`);
  for (const o of offenders) {
    console.error(`  ${o.length} karakter  ${o.name}`);
    console.error(`     di ${o.file}\n`);
  }
  console.error('Perpendek nama tabel/kolomnya, lalu generate ulang migration-nya.');
  process.exit(1);
}

main();
