import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from './client';

/**
 * ─── Pemeriksaan migrasi saat aplikasi menyala ──────────────────────────────
 *
 * Membandingkan berkas migrasi di folder dengan yang tercatat di
 * `__drizzle_migrations`. Ketidakcocokan ke dua arah, dan keduanya nyata:
 *
 *   belumJalan     ada berkas yang belum dijalankan ke database ini
 *                  -> kode baru, database lama. Kolom yang diminta kode tidak
 *                     ada; setiap query ke tabel itu jatuh 500.
 *
 *   tidakDikenal   database mencatat migrasi yang tidak ada di kode ini
 *                  -> kode lama, database baru. Kolom yang diminta kode sudah
 *                     dihapus; gejalanya sama: 500 tanpa menyebut sebab.
 *
 * Kedua keadaan itu pernah terjadi di proyek ini dalam satu minggu, dan
 * masing-masing menghabiskan waktu untuk ditemukan karena galatnya muncul di
 * halaman acak, bukan di tempat sebabnya. Menolak menyala dengan pesan yang
 * menyebut nama berkasnya jauh lebih murah.
 *
 * Hash-nya sha256 dari isi berkas .sql — cara yang sama persis dengan
 * `readMigrationFiles` milik drizzle-orm, jadi yang dibandingkan adalah nilai
 * yang memang ditulis migrator ke tabel itu.
 */

export interface HasilPeriksaMigrasi {
  /** Nama berkas (tag) yang ada di folder tetapi belum tercatat di database. */
  belumJalan: string[];
  /** Jumlah hash di database yang tidak ada di folder — kode lebih lama dari database. */
  tidakDikenal: number;
  /** Folder yang diperiksa, untuk disebut di pesan. */
  folder: string;
  cocok: boolean;
}

interface Jurnal {
  entries: Array<{ tag: string }>;
}

/**
 * Menemukan folder migrasi.
 *
 * Tiga tempat, berurutan: MIGRATIONS_DIR (di dalam wadah Docker diset ke
 * /app/drizzle), akar repo saat pengembangan (dicari lewat
 * pnpm-workspace.yaml, sama seperti load-env), lalu /app/drizzle sebagai
 * bawaan wadah. Mengembalikan undefined bila tidak satu pun ada — pemanggil
 * yang memutuskan apakah itu fatal.
 */
export function cariFolderMigrasi(): string | undefined {
  const dariEnv = process.env.MIGRATIONS_DIR;
  if (dariEnv && existsSync(join(dariEnv, 'meta', '_journal.json'))) return dariEnv;

  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const kandidat = join(dir, 'packages', 'db', 'drizzle');
      if (existsSync(join(kandidat, 'meta', '_journal.json'))) return kandidat;
      break;
    }
    const induk = dirname(dir);
    if (induk === dir) break;
    dir = induk;
  }

  const bawaan = '/app/drizzle';
  if (existsSync(join(bawaan, 'meta', '_journal.json'))) return bawaan;
  return undefined;
}

export async function periksaMigrasi(folder: string): Promise<HasilPeriksaMigrasi> {
  const jurnal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Jurnal;

  const diFolder = jurnal.entries.map((e) => {
    const isi = readFileSync(join(folder, `${e.tag}.sql`));
    return { tag: e.tag, hash: createHash('sha256').update(isi).digest('hex') };
  });

  const db = getDb();
  /*
   * Tabel ini dibuat migrator saat migrasi pertama. Kalau belum ada, database
   * benar-benar kosong — semuanya belum jalan, dan itu yang dilaporkan.
   */
  let tercatat: string[] = [];
  try {
    const rows = await db.execute(sql`SELECT hash FROM __drizzle_migrations`);
    tercatat = ((rows as unknown as Array<Array<{ hash: string }>>)[0] ?? []).map((r) => r.hash);
  } catch (err) {
    const e = err as { errno?: number; cause?: { errno?: number } };
    const errno = e?.errno ?? e?.cause?.errno;
    // 1146 = tabel tidak ada
    if (errno !== 1146) throw err;
  }

  const hashDb = new Set(tercatat);
  const hashFolder = new Set(diFolder.map((m) => m.hash));

  const belumJalan = diFolder.filter((m) => !hashDb.has(m.hash)).map((m) => m.tag);
  const tidakDikenal = tercatat.filter((h) => !hashFolder.has(h)).length;

  return { belumJalan, tidakDikenal, folder, cocok: belumJalan.length === 0 && tidakDikenal === 0 };
}

/**
 * Pesan untuk manusia — disusun di sini supaya API dan skrip CLI berkata hal
 * yang sama persis, termasuk perintah yang harus dijalankan.
 */
export function pesanPeriksaMigrasi(h: HasilPeriksaMigrasi): string[] {
  const baris: string[] = [];
  if (h.belumJalan.length > 0) {
    baris.push(`${h.belumJalan.length} migrasi BELUM dijalankan ke database ini:`);
    for (const t of h.belumJalan) baris.push(`    ${t}.sql`);
    baris.push('  Jalankan:  pnpm db:migrate');
  }
  if (h.tidakDikenal > 0) {
    baris.push(
      `database mencatat ${h.tidakDikenal} migrasi yang TIDAK ADA di kode ini — ` +
        'kode yang berjalan lebih lama daripada databasenya.',
    );
    baris.push('  Perbarui kodenya (git pull, lalu bangun ulang / nyalakan ulang prosesnya).');
  }
  baris.push(`  Folder migrasi: ${h.folder}`);
  return baris;
}
