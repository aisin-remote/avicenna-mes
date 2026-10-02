/**
 * Cara scan saat memuat ke truk.
 *
 * ── Tiga perlakuan, dan apa yang membedakannya ──────────────────────────────
 *
 * Pembedanya DUA hal sekaligus: apakah customer memakai kanban sendiri, dan
 * kebiasaan pabrik tempat muatnya.
 *
 *   TIGA_ARAH        loading list + kanban customer + kanban internal
 *                    Customer biasa. Kanban internal menempel sejak lini FG,
 *                    kanban customer baru dipasangkan di sini — pencocokan tiga
 *                    arah itulah yang membuktikan ketiganya barang yang sama.
 *
 *   KANBAN_CUSTOMER  loading list + kanban customer
 *                    Customer direct kanban di pabrik yang tetap men-scan.
 *                    Tidak ada kanban internal untuk dicocokkan — yang menempel
 *                    di lini FG memang kartu customer.
 *
 *   TANPA_SCAN       tidak ada yang discan per box
 *                    Customer direct kanban di pabrik yang tidak men-scan.
 *                    Jumlah aktual diambil dari hasil pulling.
 *
 * ── Kenapa kebiasaan pabrik jadi DATA, bukan kode pabrik ────────────────────
 *
 * Menuliskannya sebagai `plantCode === 'UNIT'` akan patah diam-diam begitu kode
 * pabrik diganti — dan kode pabrik memang pernah diganti. Karena itu yang
 * dibaca adalah sifat pabriknya, bukan namanya.
 */

export const MODE_LOADING = ['TIGA_ARAH', 'KANBAN_CUSTOMER', 'TANPA_SCAN'] as const;
export type ModeLoading = (typeof MODE_LOADING)[number];

export interface KeadaanLoading {
  /** Customer memakai kanban miliknya sendiri. */
  directKanban: boolean;
  /**
   * Di pabrik ini, customer direct kanban TETAP men-scan kanban customer saat
   * muat. Tidak berpengaruh pada customer biasa.
   */
  plantScanDirectKanban: boolean;
}

export function modeLoading(k: KeadaanLoading): ModeLoading {
  if (!k.directKanban) return 'TIGA_ARAH';
  return k.plantScanDirectKanban ? 'KANBAN_CUSTOMER' : 'TANPA_SCAN';
}

/** Apakah kanban internal harus discan pada mode ini. */
export function perluKanbanInternal(mode: ModeLoading): boolean {
  return mode === 'TIGA_ARAH';
}

/** Apakah kanban customer harus discan pada mode ini. */
export function perluKanbanCustomer(mode: ModeLoading): boolean {
  return mode === 'TIGA_ARAH' || mode === 'KANBAN_CUSTOMER';
}

/** Apakah ada yang discan per box sama sekali. */
export function adaScanPerBox(mode: ModeLoading): boolean {
  return mode !== 'TANPA_SCAN';
}

export const MODE_LOADING_LABELS: Record<ModeLoading, string> = {
  TIGA_ARAH: 'Loading list + kanban customer + kanban internal',
  KANBAN_CUSTOMER: 'Loading list + kanban customer',
  TANPA_SCAN: 'Tanpa scan per box',
};

/**
 * Penjelasan untuk layar operator.
 *
 * Ditulis sebagai instruksi, bukan keterangan: orang yang berdiri di dock perlu
 * tahu apa yang harus dipegang berikutnya, bukan istilah modenya.
 */
export const MODE_LOADING_INSTRUKSI: Record<ModeLoading, string> = {
  TIGA_ARAH: 'Scan kanban customer, lalu kanban internal.',
  KANBAN_CUSTOMER: 'Scan kanban customer.',
  TANPA_SCAN: 'Tidak perlu scan. Cocokkan jumlahnya, lalu tandai berangkat.',
};

/** Kondisi pengiriman yang tidak selesai sendiri dan perlu ditangani petugas. */
export function deliveryAttentionReason(row: {
  status: string;
  plannedKanban: number;
  pickedKanban: number;
  actualKanban: number;
  sapStatus?: string | null;
}): string | null {
  if (row.sapStatus === 'REJECTED') return 'Good Issue ditolak SAP';
  if (row.sapStatus === 'FAILED') return 'Good Issue gagal dikirim';
  if (row.sapStatus === 'HELD') return 'Good Issue tertahan';
  if (row.pickedKanban > row.plannedKanban) return 'Pulling melebihi rencana';
  if (row.actualKanban > row.pickedKanban) return 'Loading melebihi hasil pulling';
  if (
    ['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED'].includes(row.status) &&
    row.pickedKanban < row.plannedKanban
  ) {
    return 'Pulling selesai dengan kekurangan';
  }
  if (['SHIPPED', 'RECEIVED'].includes(row.status) && row.actualKanban < row.pickedKanban) {
    return 'Pengiriman berangkat dengan kekurangan';
  }
  return null;
}
