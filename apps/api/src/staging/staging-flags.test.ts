import assert from 'node:assert/strict';
import {
  AWAL,
  FLAG,
  LEBAR,
  TYPE_TRANS,
  tafsirStatus,
  typeTransUntuk,
  keTanggalStaging,
  keJamStaging,
  GOODS_MOVEMENT,
  PRODUCTION_RESULT,
} from './staging-tables';
import { PETA_GM_KEPALA, PETA_GM_BARIS } from './field-map';

/*
 * Nilai-nilai di bawah bukan pilihan kita; semuanya terbaca dari `WHERE`
 * program penjemput AII dan DEFAULT pada DDL staging. Uji ini ada supaya
 * perubahan yang tidak sengaja mengembalikannya ke tebakan lama tertangkap:
 * salahnya tidak menimbulkan galat apa pun, hanya dokumen yang tidak pernah
 * terjemput.
 */

// ── Keadaan awal per tabel ─────────────────────────────────────────────────
// TT_GOODS_MOVEMENT_L: CHR_STATUS DEFAULT 'N', CHR_UPLOAD DEFAULT '0'.
assert.equal(AWAL.perpindahan.status, 'N');
assert.equal(AWAL.perpindahan.upload, '0');
// TT_PRODUCTION_RESULT: CHR_STATUS DEFAULT '-', CHR_UPLOAD DEFAULT NULL.
assert.equal(AWAL.produksi.status, '-');
assert.equal(AWAL.produksi.upload, null);
assert.equal(AWAL.penerimaan.upload, '0');
// Jalur NG punya status sendiri, nilai awalnya '0'.
assert.equal(AWAL.produksi.statusNg, '0');
// Yang pernah salah: '-' pada CHR_UPLOAD baris perpindahan.
assert.notEqual(AWAL.perpindahan.upload, '-');

// ── Kedua kolom penentu IKUT ditulis ke baris perpindahan ──────────────────
const kolomBaris = PETA_GM_BARIS.map((f) => f.staging);
for (const kolom of [GOODS_MOVEMENT.kolomBaris.status, GOODS_MOVEMENT.kolomBaris.upload])
  assert.ok(kolomBaris.includes(kolom), `${kolom} harus ikut dalam INSERT baris perpindahan`);

// ── CHR_STATUS memuat message type ABAP ───────────────────────────────────
assert.equal(tafsirStatus('S'), 'BERHASIL');
assert.equal(tafsirStatus('s'), 'BERHASIL');
assert.equal(tafsirStatus('S '), 'BERHASIL');
// Kosong dan nilai awal: belum ada kesimpulan.
for (const nilai of [null, undefined, '', '   ', 'NULL', '-', 'N'])
  assert.equal(tafsirStatus(nilai), 'MENUNGGU', `"${nilai}" seharusnya MENUNGGU`);
// '5' ditulis middleware SEBELUM memanggil RFC — dokumennya belum tentu sampai.
assert.equal(tafsirStatus('5'), 'MENUNGGU');
// 'R' menandai baris yang direvisi dan akan didorong ulang.
assert.equal(tafsirStatus('R'), 'MENUNGGU');
// Message type ABAP selain S: gagal, termasuk yang tidak kita duga.
for (const nilai of ['E', 'W', 'A', 'I', 'Z'])
  assert.equal(tafsirStatus(nilai), 'GAGAL', `"${nilai}" seharusnya GAGAL`);
assert.equal(tafsirStatus(FLAG.gagal), 'GAGAL');

// ── CHR_TYPE_TRANS ────────────────────────────────────────────────────────
// Kosakata SAP, bukan nama jenis dokumen kita yang dipotong empat huruf.
assert.equal(typeTransUntuk('TRANSFER'), 'STRM');
assert.notEqual(typeTransUntuk('TRANSFER'), 'TRAN');
// Hasil produksi memakai tabel lain, yang tidak punya kolom ini.
assert.equal(typeTransUntuk('PRODUCTION'), null);
// Yang belum diputuskan harus `undefined`, supaya dokumennya DITAHAN —
// nilai yang tidak dikenal tersaring penjemput tanpa jejak.
for (const jenis of ['DELIVERY', 'GOODS_RECEIPT', 'SCRAP', 'ADJUSTMENT'])
  assert.equal(typeTransUntuk(jenis), undefined, `${jenis} belum punya CHR_TYPE_TRANS`);
// Seluruh nilai yang terpeta harus empat huruf: kolomnya char(4).
for (const [jenis, nilai] of Object.entries(TYPE_TRANS))
  if (nilai !== null) assert.equal(nilai.length, 4, `${jenis} → "${nilai}" bukan 4 karakter`);

// ── Format tanggal dan jam ────────────────────────────────────────────────
/*
 * CHR_DATE pada TT_PRODUCTION_RESULT bertipe char(10), dan lebar itu sempat
 * membuat kita menyimpulkan formatnya YYYY-MM-DD. Data AII membantahnya:
 * isinya "20260930  " — delapan angka dengan padding. Penjemput meneruskan
 * nilai ini apa adanya sebagai POSTING_DATE ke RFC, jadi tanda hubung berarti
 * konversi tanggal ABAP yang gagal.
 */
const contohTanggal = keTanggalStaging(new Date(2026, 8, 30, 13, 45, 7));
assert.equal(contohTanggal, '20260930');
assert.match(contohTanggal, /^\d{8}$/);
assert.ok(!contohTanggal.includes('-'), 'CHR_DATE tidak boleh memakai tanda hubung');
assert.equal(keJamStaging(new Date(2026, 8, 30, 13, 45, 7)), '134507');
// Nilainya 8 karakter meski kolomnya 10 — itu memang keadaan di AII.
assert.equal(LEBAR.produksi.CHR_DATE, 10);
assert.ok(contohTanggal.length <= LEBAR.produksi.CHR_DATE);
assert.ok(contohTanggal.length <= LEBAR.gmKepala.CHR_DATE);

// ── Setiap kolom char yang kita tulis harus punya lebar tercatat ──────────
/*
 * Lebar yang tidak tercatat berarti nilainya dipotong diam-diam oleh SQL
 * Server, atau INSERT-nya ditolak. Uji ini menangkap kolom baru yang ikut
 * ditulis tanpa lebarnya dicatat lebih dulu.
 */
const cek = (
  kolom: readonly string[],
  lebar: Readonly<Record<string, number>>,
  label: string,
) => {
  for (const k of kolom) {
    if (!k.startsWith('CHR_')) continue;
    const n = lebar[k];
    assert.ok(n !== undefined, `${label}: lebar ${k} belum dicatat di LEBAR`);
    assert.ok(n > 0, `${label}: lebar ${k} tidak masuk akal`);
  }
};
cek(PETA_GM_KEPALA.map((f) => f.staging), LEBAR.gmKepala, 'TT_GOODS_MOVEMENT_H');
cek(PETA_GM_BARIS.map((f) => f.staging), LEBAR.gmBaris, 'TT_GOODS_MOVEMENT_L');
cek(Object.values(PRODUCTION_RESULT.kolom), LEBAR.produksi, 'TT_PRODUCTION_RESULT');

// CHR_PLANT memang berbeda lebarnya antar tabel; itu bukan salah tulis.
assert.equal(LEBAR.gmKepala.CHR_PLANT, 3);
assert.equal(LEBAR.produksi.CHR_PLANT, 4);

// Nilai flag harus muat di kolom char(1)-nya.
for (const nilai of [FLAG.validasi, FLAG.berhasil, AWAL.perpindahan.status, AWAL.perpindahan.upload])
  assert.equal(nilai.length, LEBAR.gmBaris.CHR_STATUS);

console.log('SAP staging flag checks passed');
