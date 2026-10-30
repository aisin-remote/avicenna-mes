import assert from 'node:assert/strict';
import { PENGATURAN, definisiPengaturan, grupPengaturan, tafsirSaklar } from '@avicenna/contracts';

/*
 * Layar Pengaturan Sistem bisa MENGUBAH apakah sistem ini menulis ke SAP.
 * Dua hal yang harus dijaga uji ini, karena keduanya gagal tanpa menimbulkan
 * galat apa pun:
 *
 *   1. Tidak ada kredensial yang bocor ke daftar. Satu entri baru yang tidak
 *      hati-hati membuat password SAP bisa dibaca kembali dari browser oleh
 *      siapa pun yang bisa membuka halaman itu.
 *
 *   2. "false" dari .env tetap berarti MATI. Memakai aturan truthy JavaScript
 *      membuat string "false" bernilai true — saklar yang dimatikan di .env
 *      justru menyala, dan dorong ke SAP hidup di lingkungan yang seharusnya
 *      diam.
 */

// ── Tidak ada kredensial di daftar ─────────────────────────────────────────
const TERLARANG = [
  'PASSWORD',
  'SECRET',
  'TOKEN',
  'USER',
  'HOST',
  'PORT',
  'DATABASE',
  'URL',
  'KEY',
  'CERT',
];
for (const def of PENGATURAN) {
  for (const kata of TERLARANG) {
    assert.ok(
      !def.key.toUpperCase().includes(kata),
      `pengaturan "${def.key}" memuat "${kata}" — kredensial dan alamat tidak boleh bisa diubah ` +
        'atau dibaca dari layar; tempatnya .env di server',
    );
    assert.ok(
      !def.env.toUpperCase().includes(kata),
      `pengaturan "${def.key}" membaca env "${def.env}" yang memuat "${kata}"`,
    );
  }
  // Hanya saklar. Nilai bebas berarti ada yang bisa diketik, dan yang diketik
  // bisa berupa alamat server atau kredensial.
  assert.equal(def.jenis, 'boolean', `pengaturan "${def.key}" bukan saklar`);
}

// ── Bentuk daftar ─────────────────────────────────────────────────────────
const kunci = PENGATURAN.map((p) => p.key);
assert.equal(new Set(kunci).size, kunci.length, 'ada kunci pengaturan yang kembar');
for (const def of PENGATURAN) {
  assert.ok(def.label.trim().length > 0, `${def.key}: label kosong`);
  assert.ok(def.deskripsi.trim().length > 20, `${def.key}: deskripsi terlalu pendek untuk dibaca`);
  assert.ok(def.grup.trim().length > 0, `${def.key}: tanpa grup`);
  assert.ok(
    def.berlaku === 'seketika' || def.berlaku === 'perlu-restart',
    `${def.key}: nilai "berlaku" tidak dikenal`,
  );
  assert.equal(definisiPengaturan(def.key), def, `${def.key}: tidak bisa ditemukan lagi`);
}
assert.equal(definisiPengaturan('TIDAK_ADA'), undefined);
assert.ok(grupPengaturan().length > 0);
assert.equal(new Set(grupPengaturan()).size, grupPengaturan().length, 'grup kembar');

// ── Saklar yang akibatnya tidak bisa dibatalkan WAJIB punya peringatan ─────
/*
 * Menyalakan tarik master akan menimpa apa yang diketik orang di layar master,
 * dan mematikannya kembali tidak memulihkan ketikan itu. Peringatannya adalah
 * satu-satunya hal yang berdiri antara satu klik dan data yang hilang.
 */
for (const key of ['STAGING_PULL_ENABLED', 'SAP_SIMULATION_ENABLED']) {
  const def = definisiPengaturan(key);
  assert.ok(def, `${key} harus ada di daftar`);
  assert.ok(
    (def.peringatan ?? '').trim().length > 30,
    `${key}: akibatnya tidak bisa dibatalkan, peringatannya wajib ada dan menjelaskan`,
  );
}

// Saklar dorong TIDAK perlu peringatan: mematikannya aman, dan dokumennya
// menunggu di outbox. Diuji supaya peringatan tidak ditambahkan sembarangan —
// peringatan di mana-mana membuat semuanya berhenti dibaca.
assert.equal(definisiPengaturan('STAGING_PUSH_ENABLED')?.peringatan, undefined);

// ── Penafsiran nilai ──────────────────────────────────────────────────────
for (const hidup of ['true', 'TRUE', ' true ', '1', 'yes', 'y', 'on', 'On'])
  assert.equal(tafsirSaklar(hidup, false), true, `"${hidup}" harus berarti nyala`);

// Yang paling penting: "false" tidak boleh berakhir sebagai true.
for (const mati of ['false', 'FALSE', ' false ', '0', 'no', 'n', 'off', 'tidak', 'xyz'])
  assert.equal(tafsirSaklar(mati, true), false, `"${mati}" harus berarti mati`);

// Kosong/absen berarti pakai bawaan, bukan mati.
assert.equal(tafsirSaklar(undefined, true), true);
assert.equal(tafsirSaklar(null, true), true);
assert.equal(tafsirSaklar('', true), true);
assert.equal(tafsirSaklar('   ', true), true);
assert.equal(tafsirSaklar(undefined, false), false);

// Bawaan seluruh saklar harus MATI: lingkungan baru tidak boleh langsung
// menulis ke SAP hanya karena belum ada yang mengaturnya.
for (const def of PENGATURAN) assert.equal(def.bawaan, false, `${def.key}: bawaannya harus mati`);

console.log('setting.test.ts: semua pemeriksaan lolos');
