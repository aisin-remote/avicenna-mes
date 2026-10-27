/**
 * Papan perintah kerja lini finish good.
 *
 * Bentuk yang SAMA dipakai API dan layar. Papan ini dibaca dari jarak beberapa
 * meter oleh leader, bukan oleh operator yang memegang barang — isinya datang
 * dari antrean rencana produksi, bukan dari riwayat scan.
 */

/** Satu baris di deretan bawah papan. */
export interface PapanAntrean {
  urut: number;
  planId: number;
  nomor: string;
  backNumber: string | null;
  partNumber: string;
  aktualPcs: number;
  rencanaPcs: number;
  status: string;
  berjalan: boolean;
}

export interface PapanBerjalan {
  planId: number;
  /** Nomor perintah kerja: <LINI>/<TANGGAL>/<URUT>. */
  nomor: string;
  customer: string | null;
  partNumber: string;
  backNumber: string | null;
  partName: string | null;
  /** Isi satu kartu kanban menurut master. */
  unitPerKanban: number;
  rencanaPcs: number;
  rencanaKanban: number;
  aktualPcs: number;
  aktualKanban: number;
  /** Kemajuan box yang sedang diisi: berapa unit menempel dari kapasitasnya. */
  kotakTerisi: number;
  kotakKapasitas: number;
}

export interface PapanStasiun {
  line: {
    code: string;
    name: string;
    processType: string;
    plantCode: string | null;
    plantName: string | null;
  };
  /** Label shift yang sedang berjalan, mis. "SHIFT1". Kosong bila jam kerja belum diisi. */
  shift: string | null;
  tanggalProduksi: string;
  berjalan: PapanBerjalan | null;
  antrean: PapanAntrean[];
  /** Sebab papan tidak punya baris berjalan — ditampilkan apa adanya di layar. */
  catatan: string | null;
}
