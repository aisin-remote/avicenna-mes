import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Memuat .env dari root repo, bukan dari direktori kerja.
 *
 * Script di paket ini (migrate, seed, drizzle-kit) dijalankan pnpm dengan cwd
 * di packages/db, sementara .env hanya ada satu di root dan dipakai bersama
 * web maupun api. `import 'dotenv/config'` saja akan mencari di cwd dan
 * diam-diam tidak menemukan apa-apa.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../.env');

if (existsSync(rootEnv)) {
  config({ path: rootEnv });
} else {
  // Jalan juga saat variabel di-set langsung dari luar (CI, docker, systemd).
  config();
}

export { rootEnv };
