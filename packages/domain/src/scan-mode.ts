import {
  SCAN_MODES,
  SCAN_MODES_LAMA,
  SCAN_MODE_ENUM,
  SCAN_MODE_LABELS,
  normalkanModeScan,
  scanPerBox,
  modeScanBerlaku,
  modeScanBawaan,
  type ScanMode,
  type ScanModeTersimpan,
  type ProcessType,
} from '@avicenna/contracts';

// Kosakata, label, bawaan, dan penerjemah nilai lama ada di contracts (dipakai
// seed dan skema database tanpa menyeret domain); yang di sini aturan turunannya.
export {
  SCAN_MODES,
  SCAN_MODES_LAMA,
  SCAN_MODE_ENUM,
  SCAN_MODE_LABELS,
  normalkanModeScan,
  scanPerBox,
  modeScanBerlaku,
  modeScanBawaan,
};
export type { ScanMode, ScanModeTersimpan };

/**
 * Apa yang harus ada pada sebuah scan produksi, menurut METODE SCAN lini itu.
 *
 * Seluruhnya diturunkan dari satu nilai di TM_ROUTE_PROCESS. Dulu separuhnya
 * disimpulkan dari jenis proses (daftar lini FG yang ditanam di kode), jadi
 * lini FG yang ternyata tidak memakai kartu mustahil dinyatakan tanpa
 * menyunting kode.
 *
 * `proses` hanya dipakai untuk menerjemahkan nilai metode yang LAMA, karena
 * `PER_PIECE` dulu berarti dua hal berbeda tergantung jenis prosesnya.
 *
 * Dipisah ke fungsi murni supaya aturannya bisa diuji tanpa database, dan
 * supaya scan.service tidak menyimpan salinan logika yang bisa menyimpang.
 */
export interface SyaratScan {
  /** Kanban harus ikut dikirim. */
  kanbanWajib: boolean;
  /** Kanban tidak boleh ikut — mengirimnya berarti operator salah lini. */
  kanbanDilarang: boolean;
  /** Barang ditempelkan satu per satu ke kartu (TT_KANBAN_ITEM). */
  tempelUnitKeKartu: boolean;
  /** Jumlah scan diambil dari isi kartu, bukan dari barcode. */
  qtyDariKartu: boolean;
  /** Kartu yang sudah PRODUCED ditolak. */
  tolakKartuTerproduksi: boolean;
  /** Unit dilepas dari kartu sebelumnya lalu ditempel ke kartu ini. */
  pindahKartu: boolean;
  /** Metodenya dikenal tetapi alurnya belum dibangun — scan harus ditolak. */
  belumTersedia: boolean;
}

const SYARAT: Record<ScanMode, SyaratScan> = {
  PART_SAJA: {
    kanbanWajib: false,
    kanbanDilarang: true,
    tempelUnitKeKartu: false,
    qtyDariKartu: false,
    tolakKartuTerproduksi: false,
    pindahKartu: false,
    belumTersedia: false,
  },
  PART_KANBAN: {
    kanbanWajib: true,
    kanbanDilarang: false,
    tempelUnitKeKartu: true,
    qtyDariKartu: false,
    tolakKartuTerproduksi: false,
    pindahKartu: false,
    belumTersedia: false,
  },
  KANBAN_BOX: {
    kanbanWajib: true,
    kanbanDilarang: false,
    tempelUnitKeKartu: false,
    qtyDariKartu: true,
    tolakKartuTerproduksi: true,
    pindahKartu: false,
    belumTersedia: false,
  },
  /*
   * Syaratnya sengaja SAMA dengan PART_SAJA.
   *
   * Yang membedakan bukan cara scan-nya, melainkan arti hasilnya: barangnya
   * barang jadi, hanya tidak ditempel kartu. Dibedakan sebagai nilai tersendiri
   * supaya lini seperti itu tidak perlu berpura-pura sebagai lini WIP, dan
   * supaya perlakuan di hilir (pengiriman tanpa kartu) bisa membedakannya.
   */
  PART_TANPA_KANBAN: {
    kanbanWajib: false,
    kanbanDilarang: true,
    tempelUnitKeKartu: false,
    qtyDariKartu: false,
    tolakKartuTerproduksi: false,
    pindahKartu: false,
    belumTersedia: false,
  },
  /*
   * Torimetron D05E: part yang sudah punya kartu internal dipindahkan ke kartu
   * customer. Butuh melepas unit dari kartu lama — operasi yang belum ada.
   * Ditandai belumTersedia supaya lini yang keliru disetel ke metode ini
   * ditolak dengan pesan jelas, bukan diperlakukan seperti PART_KANBAN dan
   * menghasilkan unit yang menempel di dua kartu.
   */
  PART_PINDAH_KARTU: {
    kanbanWajib: true,
    kanbanDilarang: false,
    tempelUnitKeKartu: true,
    qtyDariKartu: false,
    tolakKartuTerproduksi: false,
    pindahKartu: true,
    belumTersedia: true,
  },
  /*
   * Injection: tag mold dulu, lalu kanban milik ANGGOTA mold itu, dihitung per
   * siklus. Syaratnya sama dengan KANBAN_BOX, tetapi butuh langkah tag mold
   * dan pemeriksaan keanggotaan yang belum ada — jadi ditandai belum tersedia
   * supaya tidak diam-diam menerima kanban part mana pun.
   */
  KANBAN_MOLD: {
    kanbanWajib: true,
    kanbanDilarang: false,
    tempelUnitKeKartu: false,
    qtyDariKartu: true,
    tolakKartuTerproduksi: true,
    pindahKartu: false,
    belumTersedia: true,
  },
  /*
   * Assembling BODY: papan dandori dulu, baru master sample, baru kanban.
   * Tanpa langkah papan dandori, scan akan diterima tanpa penanda setup yang
   * wajib di lini itu — karena itu ditandai belum tersedia, bukan dijalankan
   * sebagai KANBAN_BOX biasa.
   */
  KANBAN_BOX_DANDORI: {
    kanbanWajib: true,
    kanbanDilarang: false,
    tempelUnitKeKartu: false,
    qtyDariKartu: true,
    tolakKartuTerproduksi: true,
    pindahKartu: false,
    belumTersedia: true,
  },
};

export function syaratScan(
  mode: ScanModeTersimpan | null | undefined,
  proses?: ProcessType | null,
): SyaratScan {
  return SYARAT[normalkanModeScan(mode, proses)];
}

/**
 * Apakah pemeriksaan duplikat memakai barcode part.
 *
 * Di metode per barang, barcode = satu barang, jadi "barcode ini sudah discan
 * di proses ini" adalah duplikat sungguhan. Di KANBAN_BOX, barcode = master
 * sample yang SAMA untuk seluruh shift — memeriksanya akan menolak scan kedua
 * dan seterusnya. Di metode itu duplikat ditentukan oleh status kartunya.
 */
export function duplikatDariBarcode(
  mode: ScanModeTersimpan | null | undefined,
  proses?: ProcessType | null,
): boolean {
  return !scanPerBox(normalkanModeScan(mode, proses));
}
