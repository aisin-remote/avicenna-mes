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
  /** Lokasi asal barang — stok di lokasi inilah yang berkurang saat berangkat. */
  locationId: z.coerce.number().int().positive().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD'),
  truckNumber: z.string().trim().max(32).optional(),
  driverName: z.string().trim().max(128).optional(),
  lines: z.array(loadingLineInputSchema).min(1, 'Minimal satu baris part'),
});
export type LoadingCreateInput = z.infer<typeof loadingCreateSchema>;

/** Satu kanban discan saat muat barang. */
export const loadingScanSchema = z.object({
  deliveryId: z.coerce.number().int().positive(),
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
  message: string;
  /** Baris loading list yang bertambah — dipakai layar untuk memperbarui angkanya. */
  lineId: number | null;
  partNumber: string | null;
  convertedPartNumber: string | null;
  actualKanban: number;
  plannedKanban: number;
  /** Ringkasan seluruh dokumen setelah scan ini. */
  totals: { plannedKanban: number; actualKanban: number };
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
  actualKanban: number;
}
