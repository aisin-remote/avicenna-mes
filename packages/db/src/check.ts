import './load-env';
import { periksaMigrasi, cariFolderMigrasi, pesanPeriksaMigrasi } from './migration-check';
import { closeDb } from './client';

/**
 * `pnpm db:check` — memeriksa tanpa mengubah apa pun. Keluar 1 bila tidak
 * cocok, supaya bisa dipasang sebagai gerbang di CI atau skrip deploy.
 */
async function main() {
  const folder = cariFolderMigrasi();
  if (!folder) {
    console.error('[db:check] folder migrasi tidak ditemukan');
    process.exit(2);
  }
  const hasil = await periksaMigrasi(folder);
  await closeDb();
  if (hasil.cocok) {
    console.log('[db:check] skema cocok dengan kode.');
    return;
  }
  console.error('[db:check] TIDAK COCOK');
  for (const b of pesanPeriksaMigrasi(hasil)) console.error('  ' + b);
  process.exit(1);
}

main().catch(async (err) => {
  console.error('[db:check] gagal:', err);
  await closeDb();
  process.exit(1);
});
