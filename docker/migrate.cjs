/**
 * Menjalankan migrasi database di dalam wadah.
 *
 * ── Kenapa tidak memakai `pnpm db:migrate` ──────────────────────────────────
 *
 * Skrip itu dijalankan lewat tsx, yang merupakan devDependency. Image runtime
 * dibangun dengan `--prod` supaya kecil dan tidak membawa perkakas pengembangan
 * ke jaringan pabrik — jadi tsx memang tidak ada di sana.
 *
 * Berkas ini memakai hasil build @avicenna/db yang SUDAH ada di image, lewat
 * drizzle-orm yang memang dependensi produksi. Tidak ada yang perlu ditambahkan.
 *
 * ── Kenapa wadah tersendiri, bukan dijalankan API saat menyala ──────────────
 *
 * Drizzle tidak mengunci tabel migrasinya. Bila suatu saat API dijalankan lebih
 * dari satu replika, semuanya akan menjalankan migrasi yang sama bersamaan —
 * dan yang kalah balapan gagal dengan galat yang tidak menyebut sebabnya.
 * Satu wadah sekali-jalan menjamin tepat satu yang mengerjakannya.
 */
const { migrate } = require('drizzle-orm/mysql2/migrator');
const { getDb, closeDb } = require('@avicenna/db');

/*
 * Folder migrasi ditunjuk absolut.
 *
 * Versi aslinya memakai './drizzle' yang bergantung pada cwd — benar saat
 * dijalankan dari packages/db, tetapi di dalam wadah cwd-nya /app dan jalur
 * relatifnya menunjuk ke tempat yang berbeda. Kegagalannya diam: drizzle
 * menganggap tidak ada migrasi untuk dijalankan, lalu API menyala di atas
 * database kosong.
 */
const folder = process.env.MIGRATIONS_DIR || '/app/drizzle';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL belum diset untuk wadah migrate.');
  }
  const db = getDb();
  console.log(`[migrate] menjalankan migration dari ${folder} ...`);
  await migrate(db, { migrationsFolder: folder });
  console.log('[migrate] selesai.');
  await closeDb();
}

main().catch(async (err) => {
  console.error('[migrate] gagal:', err);
  await closeDb();
  // Keluar bukan-nol supaya compose menahan API: lebih baik aplikasi tidak
  // menyala sama sekali daripada menyala di atas skema yang belum lengkap.
  process.exit(1);
});
