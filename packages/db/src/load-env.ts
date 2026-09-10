import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Memuat .env dari root monorepo, dari mana pun proses dijalankan.
 *
 * Repo ini memakai SATU .env di root, dipakai bersama web, api, dan script
 * database. Tapi setiap konsumen mencarinya di tempat berbeda:
 *   - script db  -> cwd ada di packages/db
 *   - Next.js    -> hanya memuat .env di apps/web
 *   - NestJS     -> sudah diarahkan lewat envFilePath
 * Akibatnya web gagal dengan "DATABASE_URL belum diset" walau file-nya ada.
 *
 * Root ditemukan dengan menelusuri ke atas mencari pnpm-workspace.yaml, bukan
 * lewat import.meta.url — supaya tetap benar pada build CJS maupun ESM.
 *
 * dotenv tidak menimpa variabel yang sudah ada, jadi ini aman di produksi
 * (docker, systemd, CI) tempat nilainya datang dari environment sungguhan.
 */
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

let sudahDimuat = false;

export function loadRootEnv(): void {
  if (sudahDimuat) return;
  sudahDimuat = true;

  const root = findRepoRoot(process.cwd());
  const envPath = root ? join(root, '.env') : undefined;

  if (envPath && existsSync(envPath)) {
    config({ path: envPath });
  } else {
    config();
  }
}

loadRootEnv();
