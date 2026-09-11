import { z } from 'zod';

/**
 * Loading list — dokumen muat satu truk.
 *
 * Di bella dokumen ini didorong masuk dari sistem luar. Di sini dikelola
 * sendiri: dibuat manual atau diimpor, lalu diisi saat muat barang dengan
 * men-scan kanban.
 */

export const loadingLineInputSchema = z.object({
  partId: z.coerce.number().int().positive('Part wajib dipilih'),
  customerPartId: z.coerce.number().int().positive().optional(),
  plannedKanban: z.coerce.number().int().min(0).default(0),
  qtyPerKanban: z.coerce.number().int().min(0).default(0),
});
export type LoadingLineInput = z.infer<typeof loadingLineInputSchema>;

export const loadingCreateSchema = z.object({
  plantId: z.coerce.number().int().positive('Pabrik wajib dipilih'),
  customerId: z.coerce.number().int().positive('Customer wajib dipilih'),
  /** Nomor PDS dari customer, bila ada. */
  pdsNumber: z.string().trim().max(64).optional(),
  cycle: z.coerce.number().int().min(1).default(1),
  dock: z.string().trim().max(32).optional(),
  /** SLOC tempat barang jadi diambil saat pulling (PP02). */
  locationId: z.coerce.number().int().positive().optional(),
  /** SLOC staging tempat barang menunggu truk (PP04). */
  stagingLocationId: z.coerce.number().int().positive().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD'),
  truckNumber: z.string().trim().max(32).optional(),
  driverName: z.string().trim().max(128).optional(),
  lines: z.array(loadingLineInputSchema).min(1, 'Minimal satu baris part'),
});
export type LoadingCreateInput = z.infer<typeof loadingCreateSchema>;

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
  customerPart: z.string().trim().min(1, 'Barcode kosong').max(64),
  /** Nomor part internal, bila barcode memuatnya. */
  internalPart: z.string().trim().max(64).optional(),
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
  pdsNumber: string | null;
  customerName: string | null;
  deliveryDate: string;
  cycle: number;
  status: string;
  truckStatus: string;
  plannedKanban: number;
  pickedKanban: number;
  actualKanban: number;
}
