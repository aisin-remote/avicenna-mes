import './src/load-env';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://avicenna:avicenna@127.0.0.1:3306/avicenna',
  },
  /*
   * Hanya skema milik kita yang diurus drizzle-kit.
   *
   * Tanpa daftar ini, introspeksi dan `push` ikut melihat skema lain di server
   * yang sama — server ini dipakai bersama beberapa proyek — dan menawarkan
   * untuk menghapus tabel yang bukan milik aplikasi ini.
   */
  schemaFilter: [
    'org',
    'master',
    'production',
    'kanban',
    'inventory',
    'logistics',
    'quality',
    'machine',
    'sap',
  ],
  verbose: true,
  strict: true,
});
