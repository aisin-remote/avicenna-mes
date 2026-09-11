/**
 * Pemetaan jenis mutasi kita ke movement type SAP.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ ANGKA DI BAWAH BELUM DIKONFIRMASI TIM SAP.                           │
 * │                                                                      │
 * │ Ini dugaan berdasarkan movement type standar SAP MM, BUKAN hasil     │
 * │ kesepakatan. Salah movement type berarti salah akun GL — barangnya   │
 * │ pindah dengan benar di gudang, tetapi jurnalnya masuk ke tempat yang │
 * │ keliru, dan itu baru ketahuan saat tutup buku.                       │
 * │                                                                      │
 * │ Sebelum MSSQL_SAP_ENABLED dinyalakan, angka-angka ini WAJIB          │
 * │ dicocokkan dengan tim SAP.                                           │
 * └──────────────────────────────────────────────────────────────────────┘
 */

/** Jenis dokumen SAP yang dihasilkan sebuah kelompok mutasi. */
export const SAP_DOC_TYPES = [
  'GOODS_RECEIPT',
  'TRANSFER',
  'PRODUCTION',
  'DELIVERY',
  'ADJUSTMENT',
  'SCRAP',
] as const;
export type SapDocType = (typeof SAP_DOC_TYPES)[number];

export interface SapMovement {
  docType: SapDocType;
  /** Movement type SAP. Kosong berarti belum diputuskan — dokumen ditahan. */
  movementType: string | null;
  /** Apakah perpindahan ini perlu dikirim ke SAP sama sekali. */
  kirim: boolean;
  /** Alasan bila tidak dikirim — supaya terbaca di layar pemantauan. */
  alasan?: string;
}

/**
 * Jenis mutasi -> dokumen SAP.
 *
 * TRANSFER_IN sengaja TIDAK menghasilkan dokumen sendiri: perpindahan antar
 * SLOC adalah SATU dokumen SAP yang memuat sisi keluar dan sisi masuk
 * sekaligus. Mengirim keduanya berarti stok berpindah dua kali.
 */
export const SAP_MOVEMENTS: Record<string, SapMovement> = {
  RECEIVING_IN: { docType: 'GOODS_RECEIPT', movementType: '101', kirim: true },
  TRANSFER_OUT: { docType: 'TRANSFER', movementType: '311', kirim: true },
  TRANSFER_IN: {
    docType: 'TRANSFER',
    movementType: '311',
    kirim: false,
    alasan: 'sisi masuk dari perpindahan yang sama — sudah terwakili baris keluarnya',
  },
  PRODUCTION_IN: { docType: 'PRODUCTION', movementType: '101', kirim: true },
  CONSUMPTION_OUT: { docType: 'PRODUCTION', movementType: '261', kirim: true },
  DELIVERY_OUT: { docType: 'DELIVERY', movementType: '601', kirim: true },
  NG_OUT: { docType: 'SCRAP', movementType: '551', kirim: true },
  ADJUSTMENT: { docType: 'ADJUSTMENT', movementType: '309', kirim: true },
  STOCK_TAKE: {
    docType: 'ADJUSTMENT',
    movementType: null,
    kirim: false,
    alasan: 'hasil stock opname diposting langsung di SAP, bukan lewat sistem ini',
  },
};

/** Movement type untuk sebuah jenis mutasi, atau undefined bila tak dikenal. */
export function sapMovementFor(mutationType: string): SapMovement | undefined {
  return SAP_MOVEMENTS[mutationType];
}

/**
 * Jenis dokumen sebuah kelompok mutasi.
 *
 * Satu kelompok bisa memuat beberapa jenis mutasi — produksi menghasilkan
 * PRODUCTION_IN untuk barang jadi DAN CONSUMPTION_OUT untuk komponennya.
 * Keduanya satu dokumen konfirmasi produksi di SAP, jadi jenis dokumennya
 * diambil dari baris yang menentukan, bukan sekadar baris pertama.
 */
export function docTypeOf(mutationTypes: string[]): SapDocType | undefined {
  // Urutan menentukan: yang lebih spesifik didahulukan.
  const prioritas: SapDocType[] = [
    'PRODUCTION',
    'DELIVERY',
    'GOODS_RECEIPT',
    'TRANSFER',
    'SCRAP',
    'ADJUSTMENT',
  ];
  const ada = new Set(
    mutationTypes.map((t) => SAP_MOVEMENTS[t]?.docType).filter(Boolean) as SapDocType[],
  );
  return prioritas.find((d) => ada.has(d));
}

/** Apakah seluruh movement type pada kelompok ini sudah punya angka. */
export function siapDikirim(mutationTypes: string[]): { siap: boolean; belum: string[] } {
  const belum = [...new Set(mutationTypes)].filter((t) => {
    const m = SAP_MOVEMENTS[t];
    return m?.kirim && !m.movementType;
  });
  return { siap: belum.length === 0, belum };
}
