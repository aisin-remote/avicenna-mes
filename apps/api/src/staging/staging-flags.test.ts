import assert from 'node:assert/strict';
import { AWAL, FLAG, TYPE_TRANS, tafsirStatus, typeTransUntuk } from './staging-tables';
import { PETA_GM_BARIS } from './field-map';
import { GOODS_MOVEMENT } from './staging-tables';

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

console.log('SAP staging flag checks passed');
