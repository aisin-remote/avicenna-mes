import { GOODS_MOVEMENT, PURCHASE_RECEIPT, DELIVERY, FLAG } from './staging-tables';

/**
 * Peta lengkap: kolom di staging ← kolom mana di Avicenna.
 *
 * Perintah INSERT dibangun DARI daftar ini, jadi daftarnya tidak bisa basi
 * tanpa ketahuan — kalau ada kolom yang lupa didaftarkan, kolom itu memang
 * tidak terkirim.
 *
 * ── Kenapa tidak semua bisa 1:1 ─────────────────────────────────────────────
 *
 * Staging menyimpan tanggal sebagai char(8) dan jam sebagai char(6) di kolom
 * TERPISAH, sedangkan kita punya satu timestamp. Satu kolom kita karena itu
 * mengisi dua kolom di sana, dan hubungannya tidak bisa ditulis sebagai
 * pasangan sederhana.
 */
export type AsalField =
  | { jenis: 'kolom'; tabel: string; kolom: string; lewat?: string }
  | { jenis: 'turunan'; rumus: string }
  | { jenis: 'tetap'; nilai: string };

export interface PetaField {
  tabelStaging: string;
  staging: string;
  /** Nama parameter internal, dipakai perintah INSERT. */
  field: string;
  /** `tulis` = kita yang mengisi. `baca` = SAP yang mengisi, kita membacanya. */
  arah: 'tulis' | 'baca';
  asal: AsalField;
  catatan?: string;
}

const H = GOODS_MOVEMENT.kolomKepala;
const L = GOODS_MOVEMENT.kolomBaris;

/** Kepala dokumen perpindahan → TT_GOODS_MOVEMENT_H. */
export const PETA_GM_KEPALA: PetaField[] = [
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.plant, field: 'plant', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TM_PLANT', kolom: 'CHR_SAP_CODE', lewat: 'TT_STOCK_MUTATION.INT_PLANT_ID' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.tanggal, field: 'tanggal', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'DTM_OCCURRED_AT → char(8) YYYYMMDD' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.tanggalDokumen, field: 'tanggalDokumen', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'DTM_OCCURRED_AT → char(8) YYYYMMDD' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.movementType, field: 'movementType', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TT_SAP_OUTBOX', kolom: 'CHR_MOVEMENT_TYPE' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.jenisTransaksi, field: 'jenisTransaksi', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TT_SAP_OUTBOX', kolom: 'CHR_DOC_TYPE' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.keterangan, field: 'keterangan', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: '"AVI-" + TT_SAP_OUTBOX.INT_ID + " " + CHR_SOURCE_TABLE singkat' },
    catatan:
      'Sekaligus KUNCI ANTI-GANDA. INT_NUMBER diberikan SQL Server (IDENTITY), jadi tidak ' +
      'bisa dipakai memeriksa "sudah pernah didorong atau belum" SEBELUM insert. Kolom ini ' +
      'yang diperiksa lebih dulu. char(25), jadi dipotong bila lebih panjang.' },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.nomorProduksi, field: 'nomorProduksi', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TT_SAP_OUTBOX', kolom: 'INT_STAGING_NUMBER', lewat: 'dokumen PRODUCTION dari scan yang sama' },
    catatan:
      'Menautkan perpindahan ke dokumen produksinya di staging. Kosong bila dokumen ' +
      'produksinya belum pernah terdorong — transfer memang baru dilepas setelah produksinya ' +
      'dikonfirmasi, jadi dalam keadaan normal selalu terisi.' },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.user, field: 'user', arah: 'tulis',
    asal: { jenis: 'tetap', nilai: 'AVICENNA' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.tanggalEntry, field: 'tanggalEntry', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'jam sekarang → char(8) YYYYMMDD' } },
  { tabelStaging: GOODS_MOVEMENT.kepala, staging: H.jamEntry, field: 'jamEntry', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'jam sekarang → char(6) HHMMSS' } },
];

/** Baris dokumen perpindahan → TT_GOODS_MOVEMENT_L. */
export const PETA_GM_BARIS: PetaField[] = [
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.nomor, field: 'nomor', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'INT_NUMBER kepala, sebagaimana diberikan SQL Server' },
    catatan: 'INT_NUMBER_ITEM TIDAK diisi — kolom IDENTITY, nomornya diberikan SQL Server.' },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.partNo, field: 'partNo', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TM_PARTS', kolom: 'CHR_PART_NO', lewat: 'TT_STOCK_MUTATION.INT_PART_ID' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.partName, field: 'partName', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TM_PARTS', kolom: 'CHR_PART_NAME', lewat: 'TT_STOCK_MUTATION.INT_PART_ID' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.backNo, field: 'backNo', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TM_PARTS', kolom: 'CHR_BACK_NO', lewat: 'TT_STOCK_MUTATION.INT_PART_ID' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.slocFrom, field: 'slocFrom', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TM_LOCATION', kolom: 'CHR_CODE', lewat: 'INT_LOCATION_ID (baris keluar)' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.slocTo, field: 'slocTo', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'TM_LOCATION.CHR_CODE dari baris TRANSFER_IN pasangannya' } },
  {
    tabelStaging: GOODS_MOVEMENT.baris, staging: L.qty, field: 'qty', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'ABS(TT_STOCK_MUTATION.FLT_QTY)' },
    catatan:
      'Tanpa tanda — arah dibawa movement type. PERHATIAN: INT_TOTAL_QTY bertipe int, ' +
      'sedangkan FLT_QTY kita decimal. Pemakaian kilogram berkoma akan dibulatkan di sisi sana.',
  },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.uom, field: 'uom', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TM_PARTS', kolom: 'CHR_PART_UOM', lewat: 'TT_STOCK_MUTATION.INT_PART_ID' },
    catatan: 'char(3) di staging, sedangkan CHR_PART_UOM kita varchar(16).' },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.serialNo, field: 'serialNo', arah: 'tulis',
    asal: { jenis: 'kolom', tabel: 'TT_LOT', kolom: 'CHR_BATCH_NO', lewat: 'TT_STOCK_MUTATION.INT_LOT_ID' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.movementTypeBaris, field: 'movementTypeBaris', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'movement type per jenis mutasi (sap-movement.ts)' },
    catatan: 'Untuk transfer scan produksi, diambil dari pengaturan langkah rute.' },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.tanggalEntry, field: 'tanggalEntry', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'jam sekarang → char(8) YYYYMMDD' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.jamEntry, field: 'jamEntry', arah: 'tulis',
    asal: { jenis: 'turunan', rumus: 'jam sekarang → char(6) HHMMSS' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.status, field: 'status', arah: 'tulis',
    asal: { jenis: 'tetap', nilai: FLAG.baru },
    catatan: 'Status awal. Sejak baris ini ada di staging, SAP yang menimpanya.' },
];

/** Kolom yang DIISI SAP di TT_GOODS_MOVEMENT_L, dibaca balik untuk menutup dokumen. */
export const PETA_GM_BALASAN: PetaField[] = [
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.status, field: 'status', arah: 'baca',
    asal: { jenis: 'kolom', tabel: 'TT_SAP_OUTBOX', kolom: 'CHR_STATUS' },
    catatan: `"${FLAG.berhasil}" menjadi CONFIRMED, "${FLAG.gagal}" menjadi REJECTED.` },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.pesan, field: 'pesan', arah: 'baca',
    asal: { jenis: 'kolom', tabel: 'TT_SAP_OUTBOX', kolom: 'CHR_LAST_ERROR' } },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.matdoc, field: 'matdoc', arah: 'baca',
    asal: { jenis: 'kolom', tabel: 'TT_SAP_OUTBOX', kolom: 'CHR_SAP_DOC_NUMBER' },
    catatan: 'Nomor dokumen material SAP; tahunnya terpisah di CHR_MATDOC_YEAR.' },
  { tabelStaging: GOODS_MOVEMENT.baris, staging: L.matdocTahun, field: 'matdocTahun', arah: 'baca',
    asal: { jenis: 'turunan', rumus: 'digabung ke CHR_SAP_DOC_NUMBER sebagai "matdoc/tahun"' } },
];

export const PETA_LENGKAP: PetaField[] = [...PETA_GM_KEPALA, ...PETA_GM_BARIS, ...PETA_GM_BALASAN];

/**
 * Jenis dokumen yang BELUM punya pendorong.
 *
 * Tabel tujuannya sudah diketahui, pemetaan kolomnya belum ditulis. Dokumen
 * berjenis ini ditolak dengan pesan jelas, bukan didorong ke tabel perpindahan
 * yang kebetulan ada — penerimaan barang yang mendarat di TT_GOODS_MOVEMENT
 * akan diposting SAP sebagai perpindahan antar SLOC, dan koreksinya manual.
 */
export const BELUM_DIDUKUNG: Record<string, string> = {
  GOODS_RECEIPT: `${PURCHASE_RECEIPT.kepala} / ${PURCHASE_RECEIPT.baris}`,
  DELIVERY: `${DELIVERY.kepala} / ${DELIVERY.baris}`,
  SCRAP: '(belum ditentukan)',
  ADJUSTMENT: '(belum ditentukan)',
};

/** Tulisan singkat asal sebuah field, untuk laporan dan layar. */
export function tulisAsal(a: AsalField): string {
  if (a.jenis === 'kolom') return `${a.tabel}.${a.kolom}`;
  if (a.jenis === 'tetap') return `tetap "${a.nilai}"`;
  return `turunan: ${a.rumus}`;
}

/** Apakah nama kolom kita SUDAH sama dengan nama kolom di staging. */
export function statusPenyamaan(f: PetaField): 'sama' | 'beda' | 'tak-berlaku' {
  if (f.asal.jenis !== 'kolom') return 'tak-berlaku';
  return f.asal.kolom.toUpperCase() === f.staging.toUpperCase() ? 'sama' : 'beda';
}

/** Kolom yang harus ada di tabel kepala agar pendorongan bisa jalan. */
export function kolomKepala(): string[] {
  return [...new Set(PETA_GM_KEPALA.map((f) => f.staging))];
}

/** Kolom yang harus ada di tabel baris — yang ditulis maupun yang dibaca balik. */
export function kolomBaris(): string[] {
  return [...new Set([...PETA_GM_BARIS, ...PETA_GM_BALASAN].map((f) => f.staging))];
}
