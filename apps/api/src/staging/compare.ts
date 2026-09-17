/**
 * Membandingkan field Avicenna dengan field di database jembatan.
 *
 *     pnpm staging:compare          peta field saja (tidak perlu koneksi)
 *     pnpm staging:compare --live   dibandingkan dengan staging sungguhan
 *
 * Menjawab dua pertanyaan yang selama ini hanya bisa dijawab dengan membaca
 * kode baris per baris:
 *
 *   1. Kolom staging ini diisi dari kolom mana di Avicenna?
 *   2. Kolom mana di staging yang belum kita isi — dan mana yang NOT NULL?
 *
 * Perintah ini HANYA MEMBACA, baik dari MySQL maupun dari staging.
 */
// Memuat .env dari ROOT repo, bukan dari apps/api tempat perintah ini dijalankan.
import '@avicenna/db/load-env';
import * as sql from 'mssql';
import {
  bacaStagingConfig,
  kekuranganConfig,
  keMssqlConfig,
  ringkasanConfig,
} from './staging.config';
import { GOODS_MOVEMENT, FLAG } from './staging-tables';
import {
  PETA_GM_KEPALA,
  PETA_GM_BARIS,
  PETA_GM_BALASAN,
  PETA_LENGKAP,
  BELUM_DIDUKUNG,
  tulisAsal,
  statusPenyamaan,
  type PetaField,
} from './field-map';

const LEBAR = 82;
const garis = (judul: string) =>
  `\n── ${judul} ${'─'.repeat(Math.max(2, LEBAR - judul.length - 4))}`;
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

function cetakBagian(judul: string, daftar: PetaField[]): void {
  console.log(garis(judul));
  console.log(`  ${pad('KOLOM DI STAGING', 22)}${pad('ASAL DI AVICENNA', 42)}PENYAMAAN`);
  console.log(`  ${'─'.repeat(LEBAR - 4)}`);
  for (const f of daftar) {
    const st = statusPenyamaan(f);
    const tanda = st === 'sama' ? 'sudah sama' : st === 'beda' ? '→ beda nama' : '—';
    console.log(`  ${pad(f.staging, 22)}${pad(tulisAsal(f.asal), 42)}${tanda}`);
  }
}

function cetakPeta(): void {
  cetakBagian(`Kepala dokumen → ${GOODS_MOVEMENT.kepala}`, PETA_GM_KEPALA);
  cetakBagian(`Baris dokumen → ${GOODS_MOVEMENT.baris}`, PETA_GM_BARIS);
  cetakBagian('Diisi SAP, kita baca balik', PETA_GM_BALASAN);

  console.log(
    `\n  Flag: "${FLAG.baru}" ditulis kita · "${FLAG.berhasil}" berhasil · "${FLAG.gagal}" gagal` +
      '  (nilainya BELUM dikonfirmasi tim SAP)',
  );

  const beda = PETA_LENGKAP.filter((f) => statusPenyamaan(f) === 'beda');
  if (beda.length > 0) {
    console.log(garis('Nama yang masih berbeda'));
    for (const f of beda) {
      if (f.asal.jenis !== 'kolom') continue;
      console.log(`  ${pad(`${f.asal.tabel}.${f.asal.kolom}`, 44)}→  ${f.staging}`);
    }
  }

  console.log(garis('Jenis dokumen yang belum punya pendorong'));
  for (const [jenis, tujuan] of Object.entries(BELUM_DIDUKUNG)) {
    console.log(`  ${pad(jenis, 16)}${tujuan}`);
  }
  console.log('\n  Dokumen berjenis ini DITAHAN, bukan didorong ke tabel perpindahan.');
}

async function bandingkanLangsung(): Promise<void> {
  const cfg = bacaStagingConfig();
  const kurang = kekuranganConfig(cfg);
  if (kurang.length > 0) {
    console.log(garis('Perbandingan langsung dilewati'));
    console.log(`  Koneksi staging belum lengkap: ${kurang.join(', ')}`);
    return;
  }

  const r = ringkasanConfig(cfg);
  console.log(
    garis('Dibandingkan dengan staging sungguhan') +
      `\n  ${r.host}${r.instance ? '\\' + r.instance : ':' + r.port} / ${r.database}`,
  );

  const pool = new sql.ConnectionPool(keMssqlConfig(cfg));
  pool.on('error', (err: Error) => console.error(`  kolam bermasalah: ${err.message}`));
  try {
    await pool.connect();
  } catch (err) {
    console.error(`  GAGAL menyambung: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const [tabel, dipakai] of [
    [GOODS_MOVEMENT.kepala, PETA_GM_KEPALA.map((f) => f.staging)],
    [GOODS_MOVEMENT.baris, [...PETA_GM_BARIS, ...PETA_GM_BALASAN].map((f) => f.staging)],
  ] as [string, string[]][]) {
    const bersih = tabel.replace(/[[\]]/g, '');
    const [skema, nama] = bersih.includes('.') ? bersih.split('.') : ['dbo', bersih];

    const { recordset } = await pool
      .request()
      .input('skema', skema)
      .input('nama', nama)
      .query<{ nama: string; tipe: string; panjang: number | null; bolehNull: string }>(`
        SELECT COLUMN_NAME AS nama, DATA_TYPE AS tipe,
               CHARACTER_MAXIMUM_LENGTH AS panjang, IS_NULLABLE AS bolehNull
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @skema AND TABLE_NAME = @nama
        ORDER BY ORDINAL_POSITION
      `);

    console.log(garis(`${tabel} — ${recordset.length} kolom di staging`));
    if (recordset.length === 0) {
      console.error('  tabel tidak ditemukan');
      continue;
    }

    const adaDiStaging = new Set(recordset.map((c) => c.nama.toUpperCase()));
    const set = new Set(dipakai.map((c) => c.toUpperCase()));
    const hilang = dipakai.filter((c) => !adaDiStaging.has(c.toUpperCase()));
    const belumDiisi = recordset.filter((c) => !set.has(c.nama.toUpperCase()));

    console.log(`  ${pad('kita isi & ada di staging', 36)}${dipakai.length - hilang.length}`);
    console.log(`  ${pad('kita konfigurasikan, TIDAK ADA', 36)}${hilang.length}`);
    console.log(`  ${pad('ada di staging, belum kita isi', 36)}${belumDiisi.length}`);

    if (hilang.length > 0) {
      console.log('\n  TIDAK ADA di staging — preflight akan menolak pendorongan:');
      for (const c of hilang) console.log(`    ${c}`);
    }

    const wajib = belumDiisi.filter((c) => c.bolehNull !== 'YES');
    if (wajib.length > 0) {
      console.log('\n  NOT NULL tetapi belum kita isi — setiap INSERT akan gagal:');
      for (const c of wajib) {
        const t = c.panjang && c.panjang > 0 ? `${c.tipe}(${c.panjang})` : c.tipe;
        console.log(`    ${pad(c.nama, 30)}${t}`);
      }
    }

    const opsional = belumDiisi.filter((c) => c.bolehNull === 'YES');
    if (opsional.length > 0) {
      console.log(`\n  Nullable, belum kita isi (${opsional.length}): ` +
        opsional.map((c) => c.nama).join(', '));
      console.log('  Tanyakan tim SAP mana di antaranya yang benar-benar mereka baca.');
    }
  }

  await pool.close();
}

async function main(): Promise<void> {
  cetakPeta();
  if (process.argv.includes('--live')) {
    await bandingkanLangsung();
  } else {
    console.log(
      garis('Berikutnya') +
        '\n  Bandingkan dengan database staging sungguhan:' +
        '\n      pnpm staging:compare --live\n',
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
