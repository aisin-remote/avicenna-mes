import { z } from 'zod';

/**
 * Loading list berasal dari SAP/staging. MES hanya menyimpan salinan
 * operasionalnya untuk proses pulling dan loading, bukan membuat dokumennya.
 */

/**
 * Tahap mana yang sedang discan.
 *
 * PULLING mengambil barang dari gudang finish good ke staging; LOADING
 * menaikkannya ke truk. Keduanya memakai layar dan cara scan yang sama, tapi
 * menghitung kolom yang berbeda dan memindahkan stok antar SLOC yang berbeda.
 */
export const loadingPhaseSchema = z.enum(['PULLING', 'LOADING']);
export type LoadingPhase = z.infer<typeof loadingPhaseSchema>;

/** Satu kanban discan, entah saat pulling atau saat muat. */
export const loadingScanSchema = z.object({
  deliveryId: z.coerce.number().int().positive(),
  phase: loadingPhaseSchema.default('LOADING'),
  /** Nomor part pada barcode kanban — format customer. */
  customerPart: z.string().trim().min(1, 'Barcode kosong').max(255),
  /** Nomor part internal, bila barcode memuatnya. */
  internalPart: z.string().trim().max(64).optional(),
  /**
   * Barcode kanban INTERNAL, dikirim bersama kanban customer.
   *
   * Wajib pada pencocokan tiga arah, yaitu untuk customer biasa. Customer
   * direct kanban tidak punya kanban internal untuk dicocokkan — yang menempel
   * di lini FG memang kartu customer.
   */
  internalKanban: z.string().trim().max(255).optional(),
  serialNumber: z.string().trim().max(64).optional(),
  /**
   * Diisi device (mis. uuid lokal). Dipakai membentuk kunci idempoten supaya
   * kiriman ulang saat jaringan putus-nyambung tidak menghitung satu kanban
   * dua kali. Tanpa ini tiap scan dianggap kejadian baru.
   */
  clientRef: z.string().trim().max(64).optional(),
});
export type LoadingScanInput = z.infer<typeof loadingScanSchema>;

export interface LoadingScanResult {
  status: 'ACCEPTED' | 'OVER' | 'REJECTED';
  phase: LoadingPhase;
  message: string;
  /** Baris loading list yang bertambah — dipakai layar untuk memperbarui angkanya. */
  lineId: number | null;
  partNumber: string | null;
  convertedPartNumber: string | null;
  /** Hitungan pada tahap yang sedang berjalan. */
  actualKanban: number;
  /** Sasaran tahap ini: rencana saat pulling, hasil pulling saat muat. */
  plannedKanban: number;
  /** Ringkasan seluruh dokumen setelah scan ini. */
  totals: { plannedKanban: number; pickedKanban: number; actualKanban: number };
}

export interface LoadingSummary {
  id: number;
  documentNumber: string;
  manifestNumber: string | null;
  pdsNumber: string | null;
  purchaseOrderNumber: string | null;
  deliveryType: string | null;
  sapGiStatus: string | null;
  customerName: string | null;
  deliveryDate: string;
  cycle: number;
  status: string;
  truckStatus: string;
  plannedKanban: number;
  pickedKanban: number;
  actualKanban: number;
  unmappedItems: number;
  invalidQtyPerBox: number;
  missingSloc: boolean;
  sapStatus: string | null;
  sapIsSimulation: boolean | null;
  sapDocNumber: string | null;
  sapError: string | null;
  attentionReason: string | null;
}
