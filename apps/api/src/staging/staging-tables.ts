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
    user: 'CHR_USER',
    npk: 'CHR_NPK',
    ip: 'CHR_IP',
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
    ngProcess: 'INT_NG_PRC',
    ngTotal: 'INT_TOTAL_NG',
    tanggalEntry: 'CHR_DATE_ENTRY',
    jamEntry: 'CHR_TIME_ENTRY',
    user: 'CHR_USER',
    status: 'CHR_STATUS',
    upload: 'CHR_UPLOAD',
    pesan: 'CHR_MESSAGE',
    matdoc: 'CHR_MATDOC',
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
 * Nilai flag.
 *
 * BELUM DIKONFIRMASI. Kolomnya sudah pasti ada (CHR_STATUS, CHR_UPLOAD,
 * CHR_ERROR_FLAG_R3), tetapi huruf apa yang berarti berhasil dan apa yang
 * berarti gagal harus ditanyakan ke tim SAP — atau dibaca dari baris yang sudah
 * pernah diproses. Salah menebaknya membuat dokumen yang sebenarnya sudah
 * selesai terlihat menggantung selamanya, dan tidak ada yang akan menyadarinya.
 */
export const FLAG = {
  baru: env('STAGING_FLAG_NEW', 'N'),
  berhasil: env('STAGING_FLAG_OK', 'S'),
  gagal: env('STAGING_FLAG_ERROR', 'E'),
} as const;

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
   */
  bawaan?: Record<string, unknown>;
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
    dari: 'TM_PROCESS_PARTS pp LEFT JOIN TM_PARTS p ON p.CHR_PART_NO = pp.CHR_PART_NO',
    kunci: 'pp.CHR_PART_NO',
    flagHapus: 'pp.CHR_FLAG_DELETE',
    kolomPerubahan: 'pp.CHR_MODIFIED_DATE',
    kolom: {
      plantCode: 'pp.CHR_PLANT',
      partNumber: 'pp.CHR_PART_NO',
      name: 'p.CHR_PART_NAME',
      uom: 'p.CHR_PART_UOM',
      backNumber: 'p.CHR_BACK_NO',
      qtyPerKanban: 'p.INT_QTY_PER_BOX',
    },
    bawaan: {
      /*
       * Staging tidak menyediakan padanan untuk keempat kolom ini, dan
       * PROCESS_TYPE di sisi kita NOT NULL tanpa bawaan. Nilai di bawah hanya
       * dipakai saat part BARU dibuat; part yang sudah ada tidak pernah
       * ditimpa, sehingga koreksi manual tidak hilang pada putaran berikutnya.
       */
      processType: 'ASSEMBLING_UNIT',
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
