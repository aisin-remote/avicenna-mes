import type { BarisRutePart } from './rute-part';

/** Part di master Avicenna, seutuh yang dibutuhkan formulirnya. */
export type PartMasterBom = Record<string, unknown> & {
  id: number;
  plantId: number;
  partNumber: string;
  name: string;
  backNumber: string | null;
  productionVersion: string | null;
};

/** Satu part di pohon BOM SAP, sudah diratakan untuk tabel. */
export interface SimpulBomFg {
  /** Jalur dari akar. Part yang sama bisa muncul di beberapa cabang. */
  kunci: string;
  kedalaman: number;
  /** Nomor part apa adanya di BOM, biasanya memakai tanda hubung. */
  partNumber: string;
  /** Nomor yang dipakai master bila part ini ditambahkan. */
  partNumberMaster: string;
  qty: number | null;
  uom: string | null;
  /** Kode pengadaan SAP: E buatan sendiri, F beli. */
  source: string | null;
  sloc: string | null;
  phantom: boolean;
  /** Kosong berarti belum ada di master Avicenna. */
  part: PartMasterBom | null;
  rute: BarisRutePart[];
}

export interface PartFgBom {
  partNumber: string;
  jumlahKomponen: number;
  partId: number | null;
  name: string | null;
  backNumber: string | null;
  plantCode: string | null;
}

/** Staging bisa mati; halaman tetap terbuka dan menyebut sebabnya. */
export type DaftarPartFg =
  | { tersedia: true; daftar: PartFgBom[] }
  | { tersedia: false; galat: string; daftar: [] };

export type PohonPartFg =
  | { tersedia: true; ditemukan: boolean; simpul: SimpulBomFg[] }
  | { tersedia: false; galat: string; ditemukan: false; simpul: [] };
