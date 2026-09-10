import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Memeriksa panjang identifier di SQL hasil `drizzle-kit generate`.
 *
 * MySQL menolak nama tabel, index, atau constraint yang lebih dari 64 karakter.
 * Drizzle membangun nama constraint FK dari gabungan nama tabel dan kolom,
 * sehingga tabel dengan nama panjang bisa menembus batas itu — dan kesalahannya
 * baru muncul saat migration dijalankan, bukan saat generate.
 *
 * Jalankan setiap kali menambah tabel: pnpm db:check-names
 */
const MAX_IDENTIFIER_LENGTH = 64;
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
    // Identifier di MySQL dikutip dengan backtick.
    const matches = sql.matchAll(/`([A-Za-z0-9_]+)`/g);
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

  console.error(`[check-names] ${offenders.length} identifier melebihi batas MySQL:\n`);
  for (const o of offenders) {
    console.error(`  ${o.length} karakter  ${o.name}`);
    console.error(`     di ${o.file}\n`);
  }
  console.error('Perpendek nama tabel/kolomnya, lalu generate ulang migration-nya.');
  process.exit(1);
}

main();
