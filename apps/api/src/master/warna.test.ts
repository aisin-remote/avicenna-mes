import assert from 'node:assert/strict';
import {
  BATAS_TERANG,
  buildCreateSchema,
  buildUpdateSchema,
  getEntityDef,
  luminansi,
  nadaTombol,
} from '@avicenna/contracts';

/*
 * Warna tombol berhenti dipilih orang lewat color picker, dan dari satu warna
 * itu diturunkan tiga nada. Yang dijaga uji ini bukan angka hasilnya — itu
 * boleh berubah — melainkan dua jaminan yang kalau hilang tidak menimbulkan
 * galat apa pun, hanya tombol yang tidak terbaca di lantai:
 *
 *   1. Tulisan SELALU cukup gelap, berapa pun mudanya warna yang dipilih.
 *   2. Warna yang tidak berbentuk hex tidak pernah menghasilkan gaya separuh
 *      jadi — ia mengembalikan null supaya pemanggil jatuh ke gaya bawaannya.
 */

// ── Jaminan 1: tulisan selalu terbaca ─────────────────────────────────────
const UJI = [
  '#FDE047', // kuning muda — kasus terburuk di latar terang
  '#86EFAC', // hijau muda
  '#FFFFFF', // putih, sepenuhnya
  '#FFFF00',
  '#00FFFF',
  '#DC2626', // merah; sudah cukup gelap, tidak boleh diubah berlebihan
  '#2563EB',
  '#000000',
];

for (const hex of UJI) {
  const nada = nadaTombol(hex);
  assert.ok(nada, `${hex} harus menghasilkan nada`);

  const cocok = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(nada.teks);
  assert.ok(cocok, `${hex}: warna tulisan tidak berbentuk rgb() — "${nada.teks}"`);
  const rgb: [number, number, number] = [Number(cocok[1]), Number(cocok[2]), Number(cocok[3])];
  assert.ok(
    luminansi(rgb) <= BATAS_TERANG + 1e-9,
    `${hex}: tulisan terlalu terang (luminansi ${luminansi(rgb).toFixed(3)}) — tidak terbaca di latar terang`,
  );

  // Latar dan tepi TETAP memakai warna yang dipilih, hanya alfanya berbeda.
  // Kalau ikut digelapkan, tombolnya berhenti terlihat seperti warna pilihan
  // orang dan layar pengaturannya jadi terasa berbohong.
  assert.ok(nada.bg.includes('/ 0.09'), `${hex}: latar harus beralfa rendah`);
  assert.ok(nada.border.includes('/ 0.32'), `${hex}: tepi harus beralfa sedang`);
}

// Yang sudah cukup gelap TIDAK boleh digelapkan lagi — warna merah perusahaan
// harus keluar persis seperti yang diketik orang.
assert.equal(nadaTombol('#DC2626')?.teks, 'rgb(220 38 38)');
assert.equal(nadaTombol('#000000')?.teks, 'rgb(0 0 0)');

// ── Jaminan 2: masukan tak sah menghasilkan null, bukan gaya separuh ──────
for (const buruk of [
  null,
  undefined,
  '',
  '   ',
  'merah',
  '#f00', // bentuk tiga digit sengaja ditolak
  '#GGGGGG',
  '#12345',
  '#1234567',
  'rgb(1,2,3)',
])
  assert.equal(nadaTombol(buruk as string | null), null, `"${String(buruk)}" harus null`);

// Spasi di tepi masih diterima — orang menempel dari dokumen standar warna.
assert.ok(nadaTombol(' #DC2626 '));
// Huruf kecil diterima; yang menyeragamkannya ke huruf besar adalah validasi.
assert.deepEqual(nadaTombol('#dc2626'), nadaTombol('#DC2626'));

// ── Validasi kolom warna di master ────────────────────────────────────────
const def = getEntityDef('stop-reasons');
const warna = def.fields.find((f) => f.name === 'color');
assert.ok(warna, 'alasan berhenti harus punya kolom warna');
assert.equal(warna.kind, 'color');
/*
 * WAJIB saat menambah, boleh kosong saat menyunting.
 *
 * Itu bukan kelonggaran: 15 baris yang dibuat sebelum kolom ini ada bernilai
 * kosong, dan mewajibkannya saat menyunting membuat baris-baris itu tidak bisa
 * disentuh sama sekali — termasuk untuk memperbaiki namanya.
 */
assert.equal(warna.required, true);

const buat = buildCreateSchema('stop-reasons');
const dasar = { plantId: 1, code: 'STP-99', name: 'Uji', category: 'PROBLEM', sortOrder: 1 };
assert.equal(buat.safeParse({ ...dasar, color: '#DC2626' }).success, true);
assert.equal(buat.safeParse({ ...dasar, color: '#f00' }).success, false, '3 digit harus ditolak');
assert.equal(buat.safeParse({ ...dasar, color: 'merah' }).success, false);
assert.equal(buat.safeParse(dasar).success, false, 'warna wajib saat menambah');

const sunting = buildUpdateSchema('stop-reasons');
assert.equal(
  sunting.safeParse({ name: 'Ganti nama' }).success,
  true,
  'warna tidak wajib saat menyunting',
);
assert.equal(sunting.safeParse({ color: '#2563EB' }).success, true);
assert.equal(sunting.safeParse({ color: 'biru' }).success, false);

// Disimpan huruf besar, berapa pun yang diketik — supaya dua baris berwarna
// sama tidak terbaca berbeda saat dikelompokkan di laporan.
const hasil = buat.safeParse({ ...dasar, color: '#dc2626' });
assert.equal(hasil.success && (hasil.data as { color: string }).color, '#DC2626');

console.log('warna.test.ts: semua pemeriksaan lolos');
