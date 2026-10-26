export function tanggalIsoAtauNull(value: unknown): string | null {
  const compact = (bersih(value) ?? '').replaceAll('-', '');
  if (!/^\d{8}$/.test(compact) || compact === '00000000') return null;
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function jamIsoAtauNull(value: unknown): string | null {
  const compact = (bersih(value) ?? '').replaceAll(':', '');
  if (!/^\d{6}$/.test(compact)) return null;
  return Number(compact.slice(0, 2)) < 24 &&
    Number(compact.slice(2, 4)) < 60 &&
    Number(compact.slice(4, 6)) < 60
    ? `${compact.slice(0, 2)}:${compact.slice(2, 4)}:${compact.slice(4, 6)}`
    : null;
}

/**
 * Nama tabel dan kolom di database jembatan (staging) SAP.
 *
 * Dibaca langsung dari `aisinbisa_sap_stagging` pada 16 September 2026 lewat
 * `pnpm staging:introspect` — 32 tabel, 591 kolom. Ini BUKAN dugaan lagi.
 *
 * ── Dua hal yang menentukan cara kita menulis ke sini ───────────────────────
 *
 * 1. TIDAK ADA satu tabel movement generik. Staging memakai nama tabel yang
 *    sama dengan kita — TT_GOODS_MOVEMENT_H/_L, TT_PURCHASE_RECEIPT_H/_L,
 *    TT_DELIVERY/TT_DELIVERY_ITEM — jadi dorongan dilakukan PER JENIS DOKUMEN,
 *    masing-masing ke pasangan kepala + barisnya sendiri.
 *
 * 1b. INT_NUMBER pada TT_GOODS_MOVEMENT_H dan TT_PRODUCTION_RESULT, serta
 *    INT_NUMBER_ITEM pada TT_GOODS_MOVEMENT_L, adalah kolom IDENTITY. Nomornya
 *    DIBERIKAN SQL Server; mengisinya sendiri ditolak dengan "Cannot insert
 *    explicit value for identity column". Nomor yang diberikan dibaca kembali
 *    lewat OUTPUT INSERTED dan disimpan di TT_SAP_OUTBOX.INT_STAGING_NUMBER.
 *
 * 2. Semua kolom bertipe `char(n)` fixed-width, space-padded. Nilai yang dibaca
 *    HARUS di-trim; nilai yang ditulis tidak boleh melebihi lebarnya. Tanggal
 *    disimpan sebagai char(8) `YYYYMMDD` dan jam sebagai char(6) `HHMMSS` di
 *    kolom TERPISAH — satu timestamp kita menjadi dua kolom di sana.
 *
 * ── Konvensi namanya ────────────────────────────────────────────────────────
 *
 * Prefiks CHR_/INT_/FLT_ menandai tipe, tetapi TIDAK KONSISTEN di sisi mereka:
 * TT_PURCHASE_RECEIPT_L punya `INT_RECQTY float` DAN `CHR_RECQTY int` sekaligus,
 * dan `CHR_RECEIPT_BOX` juga float. Jangan pernah menyimpulkan tipe dari
 * prefiksnya — baca INFORMATION_SCHEMA.
 */

import type { ProcessType } from '@avicenna/contracts';
import { PART_TYPES, SOURCE_TYPES, TRACKING_MODES } from '@avicenna/contracts';

const env = (nama: string, bawaan: string): string => (process.env[nama] ?? '').trim() || bawaan;

/** Format tanggal & jam yang dipakai staging di seluruh tabelnya. */
export const FORMAT_WAKTU = {
  /** char(8) — contoh: 20260916 */
  tanggal: 'YYYYMMDD',
  /** char(6) — contoh: 143052 */
  jam: 'HHMMSS',
} as const;

/** Tanggal ke char(8) seperti yang dipakai staging, memakai jam lokal. */
export function keTanggalStaging(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${t}`;
}

/** Jam ke char(6) seperti yang dipakai staging, memakai jam lokal. */
export function keJamStaging(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}${m}${s}`;
}

/**
 * Membuang padding spasi dari nilai char(n).
 *
 * Wajib dipakai pada SETIAP nilai yang dibaca dari staging. `CHR_PART_NO
 * char(18)` mengembalikan "AV-12345-001      ", dan membandingkannya dengan
 * nomor part kita tanpa trim akan selalu gagal — diam-diam, tanpa error.
 */
export function bersih(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 && s.toUpperCase() !== 'NULL' ? s : null;
}

/**
 * Perpindahan antar SLOC → TT_GOODS_MOVEMENT_H / _L.
 *
 * Inilah jalur yang paling dekat dengan yang sudah kita bangun: transfer,
 * pulling, dan sebagian pengiriman semuanya perpindahan barang.
 */
export const GOODS_MOVEMENT = {
  kepala: env('STAGING_TABLE_GM_H', 'TT_GOODS_MOVEMENT_H'),
  baris: env('STAGING_TABLE_GM_L', 'TT_GOODS_MOVEMENT_L'),

  kolomKepala: {
    /** Nomor dokumen — kunci ke barisnya. Kita yang membangkitkannya. */
    nomor: 'INT_NUMBER',
    plant: 'CHR_PLANT',
    tanggal: 'CHR_DATE',
    tanggalDokumen: 'CHR_DOCUMENT_DATE',
    jenisTransaksi: 'CHR_TYPE_TRANS',
    movementType: 'CHR_MVMT_TYPE',
    keterangan: 'CHR_REMARKS',
    /** Nomor dokumen produksi yang mendahului perpindahan ini, bila ada. */
    nomorProduksi: 'INT_NUMBER_PROD',
    user: 'CHR_USER',
    npk: 'CHR_NPK',
    ip: 'CHR_IP',
    /** Penanda siap dijemput SAP. Tanpa ini barisnya dilewati — lihat FLAG.validasi. */
    validate: 'CHR_VALIDATE',
    tanggalEntry: 'CHR_DATE_ENTRY',
    jamEntry: 'CHR_TIME_ENTRY',
  },

  kolomBaris: {
    nomor: 'INT_NUMBER',
    nomorItem: 'INT_NUMBER_ITEM',
    partNo: 'CHR_PART_NO',
    partName: 'CHR_PART_NAME',
    backNo: 'CHR_BACK_NO',
    slocFrom: 'CHR_SLOC_FROM',
    slocTo: 'CHR_SLOC_TO',
    qty: 'INT_TOTAL_QTY',
    uom: 'CHR_UOM',
    qtyPerBox: 'INT_QTY_PER_BOX',
    qtyBox: 'INT_QTY_BOX',
    serialNo: 'CHR_SER_NO',
    movementTypeBaris: 'CHR_MVMT_TYPE_L',
    tanggalEntry: 'CHR_DATE_ENTRY',
    jamEntry: 'CHR_TIME_ENTRY',

    /*
     * ── Kolom yang DIISI SAP ───────────────────────────────────────────────
     *
     * "R3" di tabel lain merujuk SAP R/3. Di tabel ini penamaannya berbeda:
     * CHR_STATUS untuk hasil, CHR_MESSAGE untuk pesan galat, CHR_MATDOC untuk
     * nomor dokumen material beserta tahunnya.
     */
    status: 'CHR_STATUS',
    pesan: 'CHR_MESSAGE',
    matdoc: 'CHR_MATDOC',
    matdocTahun: 'CHR_MATDOC_YEAR',
    upload: 'CHR_UPLOAD',
  },
} as const;

/** Hasil scan produksi → satu baris TT_PRODUCTION_RESULT per scan. */
export const PRODUCTION_RESULT = {
  tabel: env('STAGING_TABLE_PRODUCTION', 'TT_PRODUCTION_RESULT'),
  kolom: {
    nomor: 'INT_NUMBER',
    /**
     * Nomor rujukan KITA — satu-satunya cara mengenali dokumen yang sudah
     * terdorong, karena INT_NUMBER diberikan SQL Server (IDENTITY) dan baru
     * diketahui setelah INSERT berhasil.
     */
    woNumber: 'CHR_WO_NUMBER',
    /**
     * Production Version — pasangan BOM dan Rate Routing yang dipakai, BUKAN
     * nomor urut langkah. Terbukti dari data AII: ada part yang baris
     * satu-satunya bernilai 0002, yang mustahil bila ini urutan langkah.
     * Diisi dari TM_PARTS.CHR_PRODUCTION_VERSION, dan dibiarkan kosong bila
     * part-nya belum punya versi.
     */
    pv: 'CHR_PV',
    tanggal: 'CHR_DATE',
    bulan: 'INT_BULAN',
    tahun: 'INT_TAHUN',
    plant: 'CHR_PLANT',
    workCenter: 'CHR_WORK_CENTER',
    partNo: 'CHR_PART_NO',
    backNo: 'CHR_BACK_NO',
    partName: 'CHR_PART_NAME',
    uom: 'CHR_UOM',
    qtyOk: 'INT_QTY_OK',
    qtyTotal: 'INT_TOTAL_QTY',
    qtyActual: 'INT_ACTUAL',
    /*
     * Keenam kolom NG. Pada data AII SEMUANYA bernilai 0 — bukan NULL — jadi
     * keenamnya kita tulis 0 juga: baris kita sebaiknya tidak bisa dibedakan
     * dari baris mereka, dan nilai 0 tidak pernah mengejutkan penjumlahan di
     * layar siapa pun seperti NULL bisa.
     *
     * Yang DIBACA penjemput hanya INT_TOTAL_NG; rinciannya milik MES.
     */
    ngProcess: 'INT_NG_PRC',
    ngBrokenTest: 'INT_NG_BRKNTEST',
    ngSetup: 'INT_NG_SETUP',
    ngTrial: 'INT_NG_TRIAL',
    ngOthers: 'INT_NG_OTHERS',
    ngTotal: 'INT_TOTAL_NG',
    tanggalEntry: 'CHR_DATE_ENTRY',
    jamEntry: 'CHR_TIME_ENTRY',
    user: 'CHR_USER',
    /** Penanda siap dijemput SAP. Tanpa ini barisnya dilewati — lihat FLAG.validasi. */
    validate: 'CHR_VALIDATE',
    status: 'CHR_STATUS',
    upload: 'CHR_UPLOAD',
    pesan: 'CHR_MESSAGE',
    matdoc: 'CHR_MATDOC',

    /*
     * ── Jalur NG, terpisah sepenuhnya ──────────────────────────────────────
     *
     * NG dibukukan function module SENDIRI (ZFM_WDE_PROD_RESULT_NG) dari baris
     * yang SAMA, dipicu INT_TOTAL_NG <> 0, dan menghasilkan dokumen material
     * sendiri. Karena itu statusnya, pesannya, dan nomor dokumennya pun kolom
     * terpisah — satu baris bisa berhasil di sisi OK dan gagal di sisi NG.
     *
     * Kolom-kolomnya sudah dipetakan; yang belum ada adalah model status ganda
     * di outbox kita, jadi balasannya belum dibaca.
     */
    statusNg: 'CHR_STATUS_NG',
    pesanNg: 'CHR_MESSAGE_NG',
    matdocNg: 'CHR_MATDOC_NG',
    /** Kuantitas revisi; penjemput mengirim INT_TOTAL_QTY dikurangi nilai ini. */
    qtyRev: 'INT_TOTAL_QTY_REV',
    ngTotalRev: 'INT_TOTAL_NG_REV',
  },
} as const;

/** Penerimaan barang → TT_PURCHASE_RECEIPT_H / _L. */
export const PURCHASE_RECEIPT = {
  kepala: env('STAGING_TABLE_PR_H', 'TT_PURCHASE_RECEIPT_H'),
  baris: env('STAGING_TABLE_PR_L', 'TT_PURCHASE_RECEIPT_L'),

  kolomKepala: {
    /** Kunci majemuk: nomor PDS + nomor kiriman + urutan proses. */
    pdsNo: 'CHR_PDS_NO',
    delNo: 'INT_PDS_DELNO',
    procSeq: 'INT_PDS_PROCSEQ',
    supplierId: 'CHR_SUPPLIER_ID',
    supplierName: 'CHR_SUPPLIER_NAME',
    invoiceNo: 'CHR_INV_NO',
    tanggalTerima: 'CHR_RECEIPT_DATE',
    poNo: 'CHR_PONO_R3',
    tanggalBuat: 'CHR_CREATE_DATE',
    jamBuat: 'CHR_CREATE_TIME',
    user: 'CHR_USER',

    /** Diisi SAP. Di sini penamaannya memakai akhiran _R3. */
    errorFlag: 'CHR_ERROR_FLAG_R3',
    errorMsg: 'CHR_ERROR_MSG_R3',
    docNo: 'CHR_RPTNO_R3',
    docTahun: 'CHR_RPTNO_R3_Y',
    upload: 'CHR_UPLOAD',
  },

  kolomBaris: {
    pdsNo: 'CHR_PDS_NO',
    delNo: 'INT_PDS_DELNO',
    procSeq: 'INT_PDS_PROCSEQ',
    lineNo: 'INT_PDS_LINENO',
    partNo: 'CHR_PART_NO',
    partName: 'CHR_PART_NAME',
    backNo: 'CHR_BACK_NO',
    /** Perhatikan: INT_RECQTY bertipe float, CHR_RECQTY bertipe int. */
    qty: 'INT_RECQTY',
    batchNo: 'CHR_BATCH_NO',
    serialNo: 'CHR_SER_NO',
    lokasi: 'CHR_LOCATION',
    tanggalDokumen: 'CHR_DOC_DATE',
    tanggalBuat: 'CHR_CREATE_DATE',
    jamBuat: 'CHR_CREATE_TIME',
  },
} as const;

/** Pengiriman ke pelanggan → TT_DELIVERY / TT_DELIVERY_ITEM. */
export const DELIVERY = {
  kepala: env('STAGING_TABLE_DEL_H', 'TT_DELIVERY'),
  baris: env('STAGING_TABLE_DEL_L', 'TT_DELIVERY_ITEM'),

  kolomKepala: {
    delNo: 'CHR_DEL_NO',
    custNo: 'CHR_CUS_NO',
    custDest: 'CHR_CUS_DEST',
    dokNo: 'CHR_DOK_NO',
    pdsNo: 'CHR_PDS_NO',
    cycle: 'CHR_CYCLE',
    tanggalKirim: 'CHR_DEL_DATE',
    tanggalKirimAktual: 'CHR_DEL_DATE_ACT',
    poNo: 'CHR_PO_NO',
    salesOrg: 'CHR_SORG',
    distributionChannel: 'CHR_DIS_CHANNEL',
    division: 'CHR_DIVISION',
    deliveryType: 'CHR_DEL_TYPE',
    invoiceNo: 'CHR_INV_NO',
    qcStatus: 'CHR_QC_STATUS',
    tanggalBuat: 'CHR_CREATE_DATE',
    hapus: 'CHR_DELETE_FLAG',

    /** Diisi SAP: flag goods issue dan flag stock movement kepala/baris. */
    giFlag: 'CHR_GI_DEL',
    smHeaderFlag: 'CHR_SM_H_FLAG',
    smLineFlag: 'CHR_SM_L_FLAG',
    flagTerima: 'CHR_FLAG_RECEIVE',
    tanggalTerima: 'CHR_DATE_RECEIVE',
    jamTerima: 'CHR_TIME_RECEIVE',
  },

  kolomBaris: {
    delNo: 'CHR_DEL_NO',
    delItem: 'CHR_DEL_ITEM',
    partNo: 'CHR_PART_NO',
    custPartNo: 'CHR_CUST_PART_NO',
    partName: 'CHR_PART_NAME',
    qtyRencana: 'INT_TOTAL_QTY',
    qtyKirim: 'INT_DEL_QTY',
    qtyScan: 'INT_SCAN_QTY',
    qtyAktual: 'INT_ACTUAL_DEL',
    qtyPerBox: 'INT_QTY_PER_BOX',
    itemType: 'CHR_ITEM_TYPE',
    hapus: 'CHR_DELETE_FLAG',
  },
} as const;

/**
 * Saldo stok per SLOC → TT_PARTS_SLOC.
 *
 * Bukan buku besar: satu baris per (SLOC, part) berisi jumlah SEKARANG. Kalau
 * SAP membaca saldo dari sini, kita perlu menuliskannya ulang setiap saldo kita
 * berubah — dan itu keputusan tersendiri yang belum dikonfirmasi.
 */
export const PARTS_SLOC = {
  tabel: env('STAGING_TABLE_PARTS_SLOC', 'TT_PARTS_SLOC'),
  kolom: {
    sloc: 'CHR_SLOC',
    partNo: 'CHR_PART_NO',
    slocName: 'CHR_SLOC_NAME',
    qty: 'INT_PART_QTY',
    uom: 'CHR_UNIT',
    tanggalBuat: 'CHR_CREATE_DATE',
    tanggalUbah: 'CHR_UPDATE_DATE',
    jamUbah: 'CHR_UPDATE_TIME',
  },
} as const;

/**
 * Nilai flag — TERBUKTI dari kode penjemput AII, dibaca 26 Oktober 2026.
 *
 * Sumbernya empat program VB.NET yang menjemput tabel-tabel ini
 * (`VB for Prod Result`, `VB for Move PP`, `VB for Move SD`, `VB for GR`),
 * ditambah DEFAULT pada DDL staging AII. Jadi ini bukan lagi tafsir dari data
 * contoh: nilainya terbaca langsung dari `WHERE` yang menyaring baris kita.
 *
 * ── CHR_VALIDATE = 'X' adalah gerbangnya ───────────────────────────────────
 *
 * Ketiga program goods movement dan program hasil produksi SEMUANYA memuat
 * `CHR_VALIDATE = 'X'` di dalam `WHERE`-nya, sedangkan DDL-nya ber-DEFAULT
 * blank (goods movement) atau NULL (hasil produksi). Baris yang dibiarkan pada
 * nilai bawaannya karena itu tidak pernah terjemput, dan tidak ada galat apa
 * pun yang muncul.
 *
 * ── CHR_STATUS memuat MESSAGE TYPE ABAP, bukan dua nilai ───────────────────
 *
 * Program hasil produksi menulis `CHR_STATUS = M_TYPE` dengan M_TYPE diambil
 * dari export parameter `CHR_TYPE` milik function module-nya — yaitu message
 * type ABAP. Jadi nilainya lebih dari dua: S berhasil, E galat, W peringatan,
 * A abort, I informasi. Ditambah dua nilai milik middleware: '5' ditulis
 * SEBELUM Invoke sebagai penanda sedang-terbang, dan 'R' menandai baris yang
 * direvisi dan akan didorong ulang sebesar nettonya.
 *
 * Karena itu satu-satunya uji yang benar adalah `= 'S'` untuk berhasil —
 * lihat tafsirStatus(). Menguji `= 'E'` untuk gagal akan membaca peringatan,
 * abort, DAN baris yang masih terbang sebagai berhasil.
 */
export const FLAG = {
  /**
   * CHR_VALIDATE — satu-satunya gerbang penjemput.
   *
   * Dipakai di seluruh tabel. Tanpa ini barisnya tidak pernah dibaca SAP.
   */
  validasi: env('STAGING_FLAG_VALIDATE', 'X'),

  /** CHR_STATUS berhasil. Satu-satunya nilai yang berarti selesai. */
  berhasil: env('STAGING_FLAG_OK', 'S'),

  /**
   * CHR_STATUS galat.
   *
   * Dipertahankan untuk pesan dan laporan, TETAPI bukan dasar keputusan:
   * keputusannya diambil tafsirStatus(), yang memperlakukan apa pun selain
   * `berhasil` dan nilai-nilai `sedangJalan` sebagai gagal. Message type ABAP
   * lain (W, A) karena itu tidak lolos sebagai berhasil.
   */
  gagal: env('STAGING_FLAG_ERROR', 'E'),

  /**
   * Nilai CHR_STATUS yang berarti "belum selesai, jangan simpulkan apa pun".
   *
   *   '-'  nilai awal TT_PRODUCTION_RESULT (DEFAULT di DDL)
   *   'N'  nilai awal TT_GOODS_MOVEMENT_L (DEFAULT di DDL), dan disyaratkan
   *        `WHERE` jalur STNG
   *   '5'  ditulis middleware sebelum memanggil RFC — dokumennya sedang terbang
   *   'R'  baris direvisi; middleware akan mendorongnya ulang
   */
  sedangJalan: ['-', 'N', '5', 'R'] as readonly string[],

  /** Nilai awal CHR_STATUS lama. Dipertahankan untuk membaca data lama. */
  baru: env('STAGING_FLAG_NEW', 'N'),
  belum: env('STAGING_FLAG_PENDING', '-'),
} as const;

/**
 * Keadaan AWAL yang harus kita tulis, per tabel.
 *
 * Nilainya berbeda antar tabel, dan itu bukan kebetulan — DDL staging
 * menyimpannya sebagai DEFAULT masing-masing, dan `WHERE` penjemputnya
 * mensyaratkan nilai itu:
 *
 *   TT_PRODUCTION_RESULT    CHR_STATUS DEFAULT '-'   CHR_UPLOAD DEFAULT NULL
 *   TT_GOODS_MOVEMENT_L     CHR_STATUS DEFAULT 'N'   CHR_UPLOAD DEFAULT '0'
 *   TT_PURCHASE_RECEIPT_H   —                        CHR_UPLOAD DEFAULT '0'
 *
 * `CHR_UPLOAD = '0'` disyaratkan KETIGA program goods movement sekaligus
 * program penerimaan barang. Menulis '-' ke sana — yang pernah kita lakukan —
 * membuat seluruh dokumen perpindahan tersaring habis tanpa jejak.
 *
 * Nilainya ditulis TERSURAT, tidak diserahkan kepada DEFAULT: kolomnya ikut
 * dalam daftar INSERT kita, dan kolom yang disebut dalam INSERT tidak lagi
 * mengambil nilai bawaannya.
 */
export const AWAL = {
  produksi: {
    status: env('STAGING_INIT_STATUS_PRODUCTION', '-'),
    /** Jalur NG punya statusnya sendiri; nilai awalnya '0', bukan '-'. */
    statusNg: env('STAGING_INIT_STATUS_NG', '0'),
    /** Dibiarkan NULL, seperti DEFAULT-nya. Tidak ikut disaring penjemput. */
    upload: null as string | null,
  },
  perpindahan: {
    status: env('STAGING_INIT_STATUS_MOVEMENT', 'N'),
    upload: env('STAGING_INIT_UPLOAD_MOVEMENT', '0'),
  },
  penerimaan: {
    upload: env('STAGING_INIT_UPLOAD_RECEIPT', '0'),
  },
} as const;

/**
 * Lebar kolom `char(n)` di staging, menurut DDL-nya.
 *
 * ── Kenapa dikumpulkan, bukan ditulis ulang di tiap pemanggilan ────────────
 *
 * Angka-angka ini sebelumnya tersebar sebagai literal di dalam potong() dan
 * wajibMuat(). Salah satu di antaranya cukup untuk membuat INSERT ditolak
 * ("String or binary data would be truncated") atau — lebih buruk — nilai yang
 * terpotong diam-diam. Dengan dikumpulkan, kolom yang lebarnya belum dicatat
 * menjadi GALAT COMPILER di tempat pemakaiannya, bukan kejutan saat berjalan.
 *
 * Perhatikan CHR_PLANT: char(3) di TT_GOODS_MOVEMENT_H tetapi char(4) di
 * TT_PRODUCTION_RESULT. Karena itu petanya per tabel, bukan per nama kolom.
 */
export const LEBAR = {
  produksi: {
    CHR_WO_NUMBER: 30,
    /** char(10), tetapi isinya YYYYMMDD — lihat catatan formatnya di pendorong. */
    CHR_DATE: 10,
    CHR_PV: 4,
    CHR_PLANT: 4,
    CHR_WORK_CENTER: 10,
    CHR_PART_NO: 18,
    CHR_BACK_NO: 4,
    CHR_PART_NAME: 40,
    CHR_UOM: 3,
    CHR_USER: 50,
    CHR_DATE_ENTRY: 8,
    CHR_TIME_ENTRY: 6,
    CHR_VALIDATE: 1,
    CHR_STATUS: 1,
    CHR_STATUS_NG: 1,
    CHR_UPLOAD: 1,
    CHR_MESSAGE: 220,
    CHR_MESSAGE_NG: 520,
    CHR_MATDOC: 10,
    CHR_MATDOC_NG: 10,
  },
  gmKepala: {
    CHR_PLANT: 3,
    CHR_DATE: 8,
    CHR_TYPE_TRANS: 4,
    CHR_REMARKS: 25,
    CHR_DOCUMENT_DATE: 8,
    CHR_MVMT_TYPE: 3,
    CHR_VENDOR_NAME: 10,
    CHR_IP: 20,
    CHR_USER: 12,
    CHR_NPK: 6,
    CHR_VALIDATE: 1,
    CHR_DATE_ENTRY: 8,
    CHR_TIME_ENTRY: 6,
  },
  gmBaris: {
    CHR_PART_NO: 18,
    CHR_PART_NAME: 40,
    CHR_SLOC_FROM: 4,
    CHR_SLOC_TO: 4,
    CHR_UOM: 3,
    CHR_BACK_NO: 4,
    CHR_SER_NO: 20,
    CHR_MVMT_TYPE_L: 3,
    CHR_TYPE_TRANS_L: 4,
    CHR_STATUS: 1,
    CHR_UPLOAD: 1,
    CHR_MESSAGE: 220,
    CHR_MATDOC: 10,
    CHR_MATDOC_YEAR: 4,
    CHR_DATE_ENTRY: 8,
    CHR_TIME_ENTRY: 6,
  },
} as const;

/** Kesimpulan atas CHR_STATUS sebuah baris staging. */
export type TafsirStatus = 'MENUNGGU' | 'BERHASIL' | 'GAGAL';

/**
 * Menafsirkan CHR_STATUS.
 *
 * Hanya `FLAG.berhasil` yang berarti selesai. Nilai kosong dan seluruh
 * `FLAG.sedangJalan` berarti belum ada kesimpulan. SISANYA gagal — termasuk
 * message type ABAP yang tidak kita duga, sebab menganggapnya berhasil berarti
 * dokumen ditutup tanpa nomor dokumen material, dan itu kehilangan yang tidak
 * terlihat.
 */
export function tafsirStatus(raw: unknown): TafsirStatus {
  const nilai = bersih(raw);
  if (!nilai) return 'MENUNGGU';
  const atas = nilai.toUpperCase();
  if (atas === FLAG.berhasil.toUpperCase()) return 'BERHASIL';
  if (FLAG.sedangJalan.some((s) => s.toUpperCase() === atas)) return 'MENUNGGU';
  return 'GAGAL';
}

/**
 * CHR_TYPE_TRANS — kunci yang memilih function module di sisi SAP.
 *
 * ── Kenapa ini bukan sekadar label ─────────────────────────────────────────
 *
 * Program penjemput memakainya DUA KALI. Pertama di `WHERE`, untuk memutuskan
 * baris mana yang menjadi tanggung jawabnya; lalu di rantai `If/ElseIf`, untuk
 * memilih function module yang dipanggil:
 *
 *   SUBC RTRN STLT VCLM CKIP        ZZBAPI_GOODSMVT_CREATE  (ZTAB, ZCODE 04)
 *   FGDL DLFG                       ZZBAPI_AIIECC_SD00001
 *   NOFG NODL                       ZZBAPI_AIIECC_SD00004
 *   selain itu                      ZZBAPI_AIIECC_PP00010
 *
 * Kosakata lengkapnya terbagi di antara tiga build yang masing-masing menjemput
 * sebagiannya: STRM RERM STNG (PP) · FGDL DLFG NOFG NODL DLGD DLRP DLCL GDDL
 * RPDL CLDL (SD) · SUBC RTRN STLT VCLM CKIP (GR).
 *
 * Bentuknya pasangan arah empat huruf — DLGD dan GDDL, DLRP dan RPDL — jadi
 * dua huruf pertama asal dan dua huruf terakhir tujuan.
 *
 * ── Kenapa yang tidak terpeta DITAHAN, bukan dikirim apa adanya ────────────
 *
 * Nilai yang tidak dikenal TIDAK ditolak SAP; ia tersaring di `WHERE` dan
 * barisnya duduk diam di staging. Di layar pemantauan itu terbaca SENT
 * selamanya, sebab SENT memang berarti "sudah di staging, menunggu SAP".
 * Menahan dokumennya dengan sebab yang tertulis adalah satu-satunya kegagalan
 * yang bisa dilihat orang.
 */
export const TYPE_TRANS: Record<string, string | null> = {
  /*
   * Perpindahan antar SLOC produksi. STRM terbaca sebagai stock movement untuk
   * Repetitive Manufacturing — sejalan dengan REM Profile Z001 di blueprint.
   *
   * STNG dipakai AII untuk menarik barang jadi ke SLOC staging sebelum truk
   * (PP04). AIIA belum punya padanan PP04, dan dokumen FG→ST kita memang masih
   * dilewati; kalau SLOC itu nanti ada, nilainya STNG, bukan STRM.
   */
  TRANSFER: env('STAGING_TYPE_TRANS_TRANSFER', 'STRM'),

  /*
   * Hasil produksi tidak lewat TT_GOODS_MOVEMENT — tabelnya
   * TT_PRODUCTION_RESULT, yang tidak punya kolom ini.
   */
  PRODUCTION: null,
};

/**
 * Nilai CHR_TYPE_TRANS sebuah jenis dokumen, atau `undefined` bila belum
 * diputuskan. `null` berarti jenis dokumen itu memang tidak memakai kolom ini.
 */
export function typeTransUntuk(docType: string): string | null | undefined {
  return docType in TYPE_TRANS ? TYPE_TRANS[docType] : undefined;
}

/**
 * Tabel master yang DITARIK dari staging.
 *
 * Nama tabelnya sudah pasti; pemetaan kolomnya diisi setelah disepakati kolom
 * mana yang menjadi sumber kebenaran. TM_PARTS di staging punya 25 kolom,
 * sebagian besar tidak punya padanan di sisi kita.
 */
export interface SumberMaster {
  entitas: 'PART' | 'CUSTOMER' | 'VENDOR' | 'CUSTOMER_PART';
  /** Tabel utama. Dipakai untuk pesan galat dan sebagai FROM bila `dari` kosong. */
  tabel: string;
  /** FROM/JOIN khusus, bila sumbernya lebih dari satu tabel. */
  dari?: string;
  /** Kolom kunci alami yang dipakai mencocokkan baris. */
  kunci: string;
  /** <field Avicenna>: <ekspresi SELECT di staging> */
  kolom: Record<string, string>;
  /**
   * Kolom yang memuat kode plant SAP, bila sumbernya memang per plant.
   *
   * ── Kenapa penyaringan harus di KUERI, bukan sesudah baris terbaca ─────────
   *
   * Database staging dipakai BERSAMA dengan AII — plant 600 milik mereka,
   * 700/800/900 milik AIIA. Menyaring di sisi aplikasi memang mencegah data
   * mereka masuk ke master kita, tetapi tidak mencegah jatah satu putaran
   * (TOP n) habis oleh baris milik AII sebelum satu pun part AIIA terbaca.
   * Gejalanya: tarik master melaporkan "berhasil, 0 baris" selamanya.
   *
   * Dikosongkan untuk sumber yang tidak punya kolom plant — customer dan
   * vendor berlaku se-perusahaan, bukan per pabrik.
   */
  kolomPlant?: string;
  /**
   * Kolom penanda terhapus. Nilai TIDAK KOSONG berarti baris itu dihapus di SAP,
   * dan di sisi kita ditandai tidak aktif — bukan dihapus. Transaksi lama masih
   * menunjuk master ini; menghapusnya membuat riwayat kehilangan namanya.
   */
  flagHapus?: string;
  /**
   * Nilai yang KITA tentukan karena staging tidak menyediakannya.
   *
   * Hanya dipakai saat baris BARU dibuat. Baris yang sudah ada tidak pernah
   * ditimpa dengan nilai ini — kalau seseorang sudah membetulkan PROCESS_TYPE
   * sebuah part, putaran tarik berikutnya tidak boleh mengembalikannya ke
   * tebakan bawaan.
   *
   * DIKETIK KETAT, bukan Record<string, unknown>. Sebelumnya bebas, dan
   * `processType: 'ASSEMBLING'` — nilai yang tidak ada di enum — lolos sampai
   * ke MySQL: SETIAP part gagal masuk, dan galatnya hanya terlihat sebagai
   * "Failed query" di log. Sekarang nilai yang bukan anggota enum ditolak
   * compiler.
   */
  bawaan?: {
    processType?: ProcessType;
    partType?: (typeof PART_TYPES)[number];
    sourceType?: (typeof SOURCE_TYPES)[number];
    trackingMode?: (typeof TRACKING_MODES)[number];
  };
  /** Kolom penanda baris berubah, untuk tarik inkremental. Kosong = tarik penuh. */
  kolomPerubahan?: string;
}

/**
 * Master yang ditarik dari staging, BERURUTAN.
 *
 * Urutannya penting: customer dan part harus ada lebih dulu sebelum pemetaan
 * nomor part customer bisa dicocokkan ke keduanya.
 *
 * ── Yang TIDAK bisa ditarik ─────────────────────────────────────────────────
 *
 * BOM tidak ada di staging. Dicari di seluruh 32 tabel: tidak ada satu pun yang
 * memuat struktur induk-komponen. TM_PROCESS_PARTS yang paling dekat, tetapi
 * isinya routing proses (work center, cycle time, lot size) — bukan daftar
 * material. Selama itu belum disediakan, TM_BOM tetap dikelola di Avicenna, dan
 * backflush bergantung padanya.
 */
export const SUMBER_MASTER: SumberMaster[] = [
  {
    entitas: 'CUSTOMER',
    tabel: 'TM_CUST',
    kunci: 'CHR_CUST_NO',
    flagHapus: 'CHR_DEL_FLAG',
    kolomPerubahan: 'CHR_UPDATE_DATE',
    kolom: {
      code: 'CHR_CUST_NO',
      name: 'CHR_CUST_NAME',
    },
  },
  {
    entitas: 'VENDOR',
    tabel: 'TM_VENDOR',
    kunci: 'CHR_SUPPLIER_ID',
    flagHapus: 'CHR_DEL_FLAG',
    kolomPerubahan: 'CHR_CREATE_DATE',
    kolom: {
      code: 'CHR_SUPPLIER_ID',
      name: 'CHR_SUPPLIER_NAME',
    },
  },
  {
    /*
     * Penggeraknya TM_PROCESS_PARTS, bukan TM_PARTS.
     *
     * TM_PARTS di staging TIDAK punya kolom pabrik sama sekali, sedangkan
     * TM_PARTS kita berkunci (pabrik, nomor part). Yang tahu sebuah part dibuat
     * di pabrik mana adalah TM_PROCESS_PARTS — dan bila satu part dikerjakan di
     * dua pabrik, ia memang menghasilkan dua baris di sisi kita. Itu benar,
     * bukan duplikat.
     *
     * Mengambil pabrik dengan MIN() dari TM_PARTS akan diam-diam menempatkan
     * part di pabrik yang keliru, dan akibatnya baru terlihat sebagai part yang
     * muncul di layar scan lini yang salah.
     */
    entitas: 'PART',
    tabel: 'TM_PARTS',
    /*
     * DIKELOMPOKKAN per (pabrik, part) — TM_PROCESS_PARTS berkunci
     * (CHR_PART_NO, CHR_PV), satu baris per LANGKAH proses.
     *
     * Tanpa pengelompokan, part yang melewati empat proses menghasilkan empat
     * baris identik: empat kali upsert part yang sama, dan jatah satu putaran
     * (TOP n) habis oleh duplikat alih-alih part yang belum tertarik.
     *
     * Penanda hapus memakai MIN: part baru dianggap terhapus bila SELURUH
     * langkahnya terhapus. Satu langkah yang dicabut bukan berarti part-nya
     * hilang — dan menonaktifkan part yang masih diproduksi akan membuat
     * seluruh scan-nya ditolak.
     */
    dari:
      '(SELECT CHR_PLANT, CHR_PART_NO, ' +
      "MIN(CASE WHEN CHR_FLAG_DELETE IS NULL OR LTRIM(RTRIM(CHR_FLAG_DELETE)) = '' THEN 0 ELSE 1 END) " +
      'AS INT_SEMUA_HAPUS, MAX(CHR_MODIFIED_DATE) AS CHR_UBAH_TERAKHIR ' +
      'FROM TM_PROCESS_PARTS GROUP BY CHR_PLANT, CHR_PART_NO) pp ' +
      'LEFT JOIN TM_PARTS p ON p.CHR_PART_NO = pp.CHR_PART_NO',
    kunci: 'pp.CHR_PART_NO',
    kolomPlant: 'pp.CHR_PLANT',
    flagHapus: "CASE WHEN pp.INT_SEMUA_HAPUS = 1 THEN 'X' END",
    kolomPerubahan: 'pp.CHR_UBAH_TERAKHIR',
    kolom: {
      plantCode: 'pp.CHR_PLANT',
      partNumber: 'pp.CHR_PART_NO',
      name: 'p.CHR_PART_NAME',
      /*
       * CHR_PART_UOM char(40) di staging, sedangkan kolom kita varchar(16).
       * Dipotong di sisi SQL Server supaya terlihat di sini — bukan dibiarkan
       * MySQL menolak seluruh baris karena satuan yang kepanjangan.
       */
      uom: 'LEFT(p.CHR_PART_UOM, 16)',
      backNumber: 'p.CHR_BACK_NO',
      qtyPerKanban: 'p.INT_QTY_PER_BOX',
    },
    bawaan: {
      /*
       * Staging tidak menyediakan padanan untuk keempat kolom ini, dan
       * PROCESS_TYPE di sisi kita NOT NULL tanpa bawaan. Nilai di bawah hanya
       * dipakai saat part BARU dibuat; part yang sudah ada tidak pernah
       * ditimpa, sehingga koreksi manual tidak hilang pada putaran berikutnya.
       *
       * PROCESS_TYPE di TM_PARTS adalah peninggalan masa satu part = satu
       * proses; yang menentukan proses sebenarnya adalah rute part dan lini
       * tempat scan terjadi. Nilai di sini SEMENTARA sampai work center SAP
       * dipetakan ke lini kita — dan tarik master menyebutkannya di laporan.
       */
      processType: 'ASSEMBLING_UNIT_FG',
      partType: 'FINISHED_GOOD',
      sourceType: 'MANUFACTURED',
      trackingMode: 'SERIAL',
    },
  },
  {
    entitas: 'CUSTOMER_PART',
    tabel: 'TM_SHIPPING_PARTS',
    kunci: 'CHR_PART_NO',
    kolomPerubahan: 'CHR_UPDATE_DATE',
    kolom: {
      partNumber: 'CHR_PART_NO',
      customerCode: 'CHR_CUS_NO',
      customerPartNumber: 'CHR_CUS_PART_NO',
    },
  },
];
