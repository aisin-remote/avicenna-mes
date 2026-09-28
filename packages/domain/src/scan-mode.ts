import {
  SCAN_MODES,
  SCAN_MODE_LABELS,
  menghasilkanFinishGood,
  modeScanBawaan,
  type ScanMode,
  type ProcessType,
} from '@avicenna/contracts';

// Kosakata dan bawaannya ada di contracts (dipakai seed tanpa menyeret domain);
// yang di sini aturan turunannya.
export { SCAN_MODES, SCAN_MODE_LABELS, modeScanBawaan };
export type { ScanMode };

/**
 * Apa yang harus ada pada sebuah scan produksi, menurut mode dan prosesnya.
 *
 * ── PER_PIECE (UNIT) ────────────────────────────────────────────────────────
 *   lini WIP  part code saja; kanban DILARANG (barang berpindah dengan part code)
 *   lini FG   part code + kanban; barang ditempelkan ke kartu satu per satu
 *
 * ── PER_KANBAN (BODY) ───────────────────────────────────────────────────────
 *   semua lini  master sample (part) + kanban; kanban WAJIB di setiap proses,
 *               bukan hanya FG. Satu scan = isi satu kartu. Kartu yang sudah
 *               PRODUCED ditolak sampai dipull lagi.
 *
 * Dipisah ke fungsi murni supaya aturannya bisa diuji tanpa database, dan
 * supaya scan.service tidak menyimpan dua salinan logika yang bisa menyimpang.
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
}

export function syaratScan(mode: ScanMode, proses: ProcessType): SyaratScan {
  if (mode === 'PER_KANBAN') {
    return {
      kanbanWajib: true,
      kanbanDilarang: false,
      tempelUnitKeKartu: false,
      qtyDariKartu: true,
      tolakKartuTerproduksi: true,
    };
  }
  const fg = menghasilkanFinishGood(proses);
  return {
    kanbanWajib: fg,
    kanbanDilarang: !fg,
    tempelUnitKeKartu: fg,
    qtyDariKartu: false,
    tolakKartuTerproduksi: false,
  };
}

/**
 * Apakah pemeriksaan duplikat memakai barcode part.
 *
 * Di PER_PIECE, barcode = satu barang, jadi "barcode ini sudah discan di
 * proses ini" adalah duplikat sungguhan. Di PER_KANBAN, barcode = master
 * sample yang SAMA untuk seluruh shift — memeriksanya akan menolak scan kedua
 * dan seterusnya. Di mode itu duplikat ditentukan oleh status kartunya.
 */
export function duplikatDariBarcode(mode: ScanMode): boolean {
  return mode === 'PER_PIECE';
}
