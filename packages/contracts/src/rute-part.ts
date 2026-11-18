/**
 * Satu baris layar Rute per Part, dengan kolom yang sama seperti tabel rute
 * PPIC: group product, part, work center, SAP, asal, tujuan, urutan, metode.
 */
export interface BarisRutePart {
  id: number;
  plantId: number;
  plantCode: string | null;
  partId: number;
  partNumber: string;
  backNumber: string | null;
  partName: string;
  /** Group product = project di master part. */
  project: string | null;
  lineId: number | null;
  lineCode: string | null;
  /** Kode work center SAP milik line. Kosong bila line-nya belum punya. */
  workCenter: string | null;
  processType: string;
  processLabel: string;
  seqNo: number;
  inputLocationId: number | null;
  inputLocationCode: string | null;
  /** SLOC tujuan milik part (TM_PARTS), ikut ditampilkan di tiap baris rutenya. */
  outputLocationId: number | null;
  outputLocationCode: string | null;
  /** SLOC tempat hasil dipindah lagi setelah produksi. */
  transferLocationCode: string | null;
  scanMode: string | null;
  /*
   * Seluruh kolom formulir harus ada di sini. Formulir menyimpan semua kolomnya
   * sekaligus, jadi yang tidak ikut terbaca akan tersimpan kosong.
   */
  transferLocationId: number | null;
  sapTransferEnabled: boolean;
  sapTransferMovementType: string | null;
  requirePairing: boolean;
  /** Cycle time, detik per pcs. Kosong = efisiensi tidak dihitung. */
  cycleTime: number | null;
  sapProductionEnabled: boolean;
  isPrimary: boolean;
  isActive: boolean;
  /** Yang masih perlu dilengkapi. Kosong berarti baris ini sudah lengkap. */
  masalah: string[];
}

export interface DaftarRutePart {
  data: BarisRutePart[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
  ringkasan: {
    /** Seluruh baris rute, sebelum saringan. */
    baris: number;
    /** Baris yang masih perlu dilengkapi, sebelum saringan. */
    perluDilengkapi: number;
    /** Part aktif tanpa satu pun langkah rute. Scan-nya tidak diperiksa urutannya. */
    partTanpaRute: number;
  };
  /** Pilihan penyaring group product. */
  projects: string[];
}
