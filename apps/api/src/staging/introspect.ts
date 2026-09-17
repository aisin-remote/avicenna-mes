/**
 * Membaca struktur database jembatan (staging) apa adanya, lalu mencetaknya.
 *
 *     pnpm staging:introspect              seluruh tabel
 *     pnpm staging:introspect NAMA_TABEL   satu tabel beserta kolom & indeksnya
 *
 * Gunanya satu: mengisi staging-tables.ts dari kenyataan, bukan dari dugaan.
 * Struktur di sisi SAP sudah ada, tetapi belum tertulis di repo ini — dan
 * menebak nama kolom berarti ratusan dokumen gagal terkirim karena salah satu
 * huruf, bukan karena datanya bermasalah.
 *
 * Perintah ini HANYA MEMBACA. Tidak ada satu pun perintah tulis di sini.
 */
// Memuat .env dari ROOT repo, bukan dari apps/api tempat perintah ini dijalankan.
import '@avicenna/db/load-env';
import * as sql from 'mssql';
import { bacaStagingConfig, kekuranganConfig, keMssqlConfig, ringkasanConfig } from './staging.config';

const garis = (judul: string) => `\n── ${judul} ${'─'.repeat(Math.max(0, 66 - judul.length))}`;

async function main(): Promise<void> {
  const cfg = bacaStagingConfig();
  const kurang = kekuranganConfig(cfg);

  if (kurang.length > 0) {
    console.error('Koneksi staging belum lengkap. Isi dulu di .env:\n');
    for (const k of kurang) console.error(`  ${k}=`);
    console.error('\nContohnya ada di .env.example, bagian "Database jembatan (staging) SAP".');
    process.exit(1);
  }

  const r = ringkasanConfig(cfg);
  console.log(
    `menyambung ke ${r.host}${r.instance ? '\\' + r.instance : ':' + r.port} / ${r.database} sebagai ${r.user} ...`,
  );

  const pool = new sql.ConnectionPool(keMssqlConfig(cfg));
  pool.on('error', (err: Error) => console.error(`kolam bermasalah: ${err.message}`));

  try {
    await pool.connect();
  } catch (err) {
    console.error(`\nGAGAL menyambung: ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      '\nYang biasanya jadi sebab:\n' +
        '  - named instance diisi TAPI STAGING_PORT juga diisi (kosongkan salah satu)\n' +
        '  - port 1433 tertutup firewall, atau SQL Browser (UDP 1434) mati untuk named instance\n' +
        '  - STAGING_ENCRYPT=true padahal server tidak menyediakan TLS',
    );
    process.exit(1);
  }

  const targetTabel = process.argv[2];

  if (!targetTabel) {
    const { recordset } = await pool.request().query<{
      skema: string;
      nama: string;
      kolom: number;
    }>(`
      SELECT t.TABLE_SCHEMA AS skema, t.TABLE_NAME AS nama, COUNT(c.COLUMN_NAME) AS kolom
      FROM INFORMATION_SCHEMA.TABLES t
      JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
    `);

    console.log(garis(`${recordset.length} tabel di ${cfg.database}`));
    for (const t of recordset) {
      console.log(`  ${t.skema}.${t.nama}`.padEnd(56) + `${t.kolom} kolom`);
    }
    console.log(
      `\nUntuk melihat kolom sebuah tabel:\n  pnpm staging:introspect ${recordset[0]?.nama ?? 'NAMA_TABEL'}`,
    );
    await pool.close();
    return;
  }

  const bersih = targetTabel.replace(/[[\]]/g, '');
  const [skema, nama] = bersih.includes('.') ? bersih.split('.') : ['dbo', bersih];

  const kolom = await pool
    .request()
    .input('skema', skema)
    .input('nama', nama)
    .query<{
      nama: string;
      tipe: string;
      panjang: number | null;
      bolehNull: string;
      bawaan: string | null;
    }>(`
      SELECT COLUMN_NAME AS nama, DATA_TYPE AS tipe, CHARACTER_MAXIMUM_LENGTH AS panjang,
             IS_NULLABLE AS bolehNull, COLUMN_DEFAULT AS bawaan
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @skema AND TABLE_NAME = @nama
      ORDER BY ORDINAL_POSITION
    `);

  if (kolom.recordset.length === 0) {
    console.error(`\nTabel "${skema}.${nama}" tidak ditemukan.`);
    console.error('Jalankan tanpa argumen untuk melihat daftar tabel yang ada.');
    await pool.close();
    process.exit(1);
  }

  console.log(garis(`${skema}.${nama}`));
  for (const c of kolom.recordset) {
    const tipe = c.panjang && c.panjang > 0 ? `${c.tipe}(${c.panjang})` : c.tipe;
    const nullable = c.bolehNull === 'YES' ? 'NULL' : 'NOT NULL';
    console.log(`  ${c.nama.padEnd(34)} ${tipe.padEnd(18)} ${nullable}`);
  }

  const indeks = await pool
    .request()
    .input('tabel', `${skema}.${nama}`)
    .query<{ indeks: string; unik: boolean; kolom: string }>(`
      SELECT i.name AS indeks, i.is_unique AS unik, c.name AS kolom
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(@tabel) AND i.is_hypothetical = 0
      ORDER BY i.name, ic.key_ordinal
    `);

  const perIndeks = new Map<string, { unik: boolean; kolom: string[] }>();
  for (const r of indeks.recordset) {
    const ada = perIndeks.get(r.indeks) ?? { unik: Boolean(r.unik), kolom: [] };
    ada.kolom.push(r.kolom);
    perIndeks.set(r.indeks, ada);
  }

  console.log(garis('indeks'));
  if (perIndeks.size === 0) {
    console.log('  (tidak ada)');
  } else {
    for (const [namaIdx, v] of perIndeks) {
      console.log(`  ${(v.unik ? 'UNIQUE ' : '       ') + namaIdx}`.padEnd(50) + v.kolom.join(', '));
    }
  }

  console.log(
    garis('langkah berikutnya') +
      '\n  Salin nama kolom di atas ke apps/api/src/staging/staging-tables.ts,' +
      '\n  atau timpa lewat variabel STAGING_COL_* di .env.' +
      '\n  Lalu periksa kecocokannya:  GET /staging/status\n',
  );

  await pool.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
