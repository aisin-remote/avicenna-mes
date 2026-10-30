import assert from 'node:assert/strict';
import {
  AWALAN_FILTER,
  ENTITY_DEFS,
  MASTER_ENTITIES,
  PER_HALAMAN,
  filterFields,
  getEntityDef,
  tafsirNilaiFilter,
  type FieldDef,
} from '@avicenna/contracts';

/*
 * Penyaring daftar master DITURUNKAN dari definisi kolom, tidak didaftar per
 * entitas. Itu yang membuat entitas master baru langsung punya dropdown-nya,
 * tetapi juga berarti satu perubahan kecil pada `filterFields` bisa diam-diam
 * membuka kolom yang tidak boleh disaring — atau menutup yang sudah dipakai
 * orang lewat alamat yang di-bookmark. Keduanya tidak menimbulkan galat.
 *
 * `tafsirNilaiFilter` dipakai DUA kali untuk satu permintaan: di layar untuk
 * memilih nilai dropdown, di API untuk menyusun query. Kalau keduanya menilai
 * beda, jumlah di kepala halaman tidak akan sama dengan isi tabelnya.
 */

// ── Hanya kolom berhimpunan tertutup, dan harus tampil di tabel ────────────
for (const entity of MASTER_ENTITIES) {
  const def = getEntityDef(entity);
  for (const f of filterFields(def)) {
    assert.equal(f.inList, true, `${entity}.${f.name}: menyaring dengan kolom yang tidak tampil`);
    assert.ok(
      f.kind === 'boolean' || f.kind === 'select' || f.kind === 'reference' || f.optionsFrom,
      `${entity}.${f.name}: kolom ${f.kind} tidak punya himpunan pilihan yang tertutup`,
    );
  }
  // Kolom teks bebas adalah tugas kotak pencarian, bukan dropdown.
  const teks = filterFields(def).filter((f) => f.kind === 'text' || f.kind === 'number');
  assert.equal(teks.length, 0, `${entity}: kolom teks/angka tidak boleh jadi dropdown penyaring`);
}

// Entitas yang jelas-jelas punya penyaring, supaya "0 filter di mana-mana"
// tidak pernah lolos sebagai keadaan yang dianggap normal.
assert.ok(
  filterFields(ENTITY_DEFS.parts)
    .map((f) => f.name)
    .includes('processType'),
  'parts harus bisa disaring per jenis proses',
);
assert.ok(
  filterFields(ENTITY_DEFS.parts)
    .map((f) => f.name)
    .includes('plantId'),
  'parts harus bisa disaring per pabrik',
);
assert.ok(filterFields(ENTITY_DEFS.plants).length > 0, 'plants harus punya minimal satu penyaring');

// ── Benar/salah ────────────────────────────────────────────────────────────
const boolField: FieldDef = { name: 'isActive', label: 'Aktif', kind: 'boolean', inList: true };
assert.equal(tafsirNilaiFilter(boolField, 'true'), true);
assert.equal(tafsirNilaiFilter(boolField, 'false'), false);
// Yang penting: 'false' TIDAK boleh ikut terbuang bersama nilai kosong.
assert.notEqual(tafsirNilaiFilter(boolField, 'false'), undefined);
for (const buruk of ['mungkin', '1', '0', 'TRUE', '', '  ', undefined])
  assert.equal(tafsirNilaiFilter(boolField, buruk), undefined, `boolean ${String(buruk)}`);

// ── Referensi: id bulat positif saja ──────────────────────────────────────
const refField: FieldDef = {
  name: 'plantId',
  label: 'Pabrik',
  kind: 'reference',
  refEntity: 'plants',
  inList: true,
};
assert.equal(tafsirNilaiFilter(refField, '7'), 7);
assert.equal(tafsirNilaiFilter(refField, ' 7 '), 7);
for (const buruk of ['abc', '0', '-3', '1.5', '1e3', '', undefined])
  assert.equal(tafsirNilaiFilter(refField, buruk), undefined, `referensi ${String(buruk)}`);

// ── Pilihan tetap: diperiksa terhadap daftarnya ───────────────────────────
const selField: FieldDef = {
  name: 'partType',
  label: 'Jenis Part',
  kind: 'select',
  options: ['RAW_MATERIAL', 'COMPONENT', 'WIP', 'FINISHED_GOOD'],
  inList: true,
};
assert.equal(tafsirNilaiFilter(selField, 'WIP'), 'WIP');
assert.equal(tafsirNilaiFilter(selField, 'BOGUS'), undefined);
assert.equal(tafsirNilaiFilter(selField, 'wip'), undefined, 'pilihan peka huruf besar-kecil');

/*
 * Kolom berpilihan HIDUP dari master lain sengaja TIDAK diperiksa di sini:
 * daftar jenis proses bisa berubah tanpa deploy, jadi yang menolak kode asing
 * adalah foreign key di database. Memeriksanya di sini berarti kode proses
 * yang baru dibuat orang tidak bisa dipakai menyaring sampai rilis berikutnya.
 */
const dariMaster: FieldDef = {
  name: 'processType',
  label: 'Proses',
  kind: 'select',
  optionsFrom: 'process-types',
  inList: true,
};
assert.equal(tafsirNilaiFilter(dariMaster, 'PROSES_YANG_BARU'), 'PROSES_YANG_BARU');
assert.equal(tafsirNilaiFilter(dariMaster, ''), undefined);

// ── Awalan dan panjang halaman ────────────────────────────────────────────
// Awalannya memisahkan nama kolom dari parameter halaman; tanpa itu kolom
// master bernama `page` atau `sort` akan mengubah urutan atau nomor halaman.
assert.equal(AWALAN_FILTER, 'f_');
for (const nama of ['page', 'perPage', 'q', 'sort', 'dir'])
  assert.notEqual(`${AWALAN_FILTER}${nama}`, nama);

// API membatasi perPage pada 200; pilihan di layar tidak boleh melampauinya.
assert.ok(PER_HALAMAN.length > 0);
for (const n of PER_HALAMAN) assert.ok(n >= 1 && n <= 200, `perPage ${n} di luar batas API`);
assert.equal(PER_HALAMAN[0], 25, 'bawaannya harus tetap 25 — alamat lama tanpa perPage');

console.log('master-filter.test.ts: semua pemeriksaan lolos');
