import 'dotenv/config';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { getDb, closeDb } from './client';

/** Menjalankan file SQL hasil `pnpm db:generate` terhadap DATABASE_URL. */
async function main() {
  const db = getDb();
  console.log('[migrate] menjalankan migration dari ./drizzle ...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[migrate] selesai.');
  await closeDb();
}

main().catch(async (err) => {
  console.error('[migrate] gagal:', err);
  await closeDb();
  process.exit(1);
});
