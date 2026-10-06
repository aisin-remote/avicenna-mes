import { z } from 'zod';

/**
 * Penerimaan barang dari supplier.
 *
 * Satu dokumen = satu kedatangan. Barisnya boleh banyak, dan tiap baris
 * menghasilkan satu lot untuk part yang dilacak per lot.
 */

export const receiptLineInputSchema = z.object({
  partId: z.coerce.number().int().positive('Part wajib dipilih'),
  qty: z.coerce.number().positive('Jumlah harus lebih dari nol'),
  uom: z.string().trim().max(16).optional(),
  /**
   * Nomor lot dari supplier, apa adanya. Kalau kosong, sistem membuatkan
   * nomor sendiri — tapi nomor supplier jauh lebih berguna saat ada masalah
   * kualitas karena itulah rujukan yang dipakai kedua belah pihak.
   */
  supplierLotNumber: z.string().trim().max(64).optional(),
  /** Barcode yang discan, disimpan untuk audit. */
  rawCode: z.string().trim().max(255).optional(),
});
export type ReceiptLineInput = z.infer<typeof receiptLineInputSchema>;

export const receiptCreateSchema = z.object({
  plantId: z.coerce.number().int().positive('Pabrik wajib dipilih'),
  supplierId: z.coerce.number().int().positive('Supplier wajib dipilih'),
  /** Nomor surat jalan supplier. */
  supplierDocNumber: z.string().trim().max(64).optional(),
  locationId: z.coerce.number().int().positive().optional(),
  receivedAt: z.coerce.date().optional(),
  note: z.string().trim().max(255).optional(),
  lines: z.array(receiptLineInputSchema).min(1, 'Minimal satu baris barang'),
});
export type ReceiptCreateInput = z.infer<typeof receiptCreateSchema>;

/**
 * Perubahan atas penerimaan yang sudah tercatat.
 *
 * Baris yang sudah ada dikenali lewat `id`. Baris tanpa `id` berarti tambahan
 * baru. Baris lama yang tidak disebutkan berarti dihapus.
 */
export const receiptLineEditSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  partId: z.coerce.number().int().positive('Part wajib dipilih'),
  qty: z.coerce.number().positive('Jumlah harus lebih dari nol'),
  uom: z.string().trim().max(16).optional(),
  supplierLotNumber: z.string().trim().max(64).optional(),
});
export type ReceiptLineEdit = z.infer<typeof receiptLineEditSchema>;

export const receiptUpdateSchema = z.object({
  supplierDocNumber: z.string().trim().max(64).optional(),
  note: z.string().trim().max(255).optional(),
  reason: z.string().trim().max(255).optional(),
  lines: z.array(receiptLineEditSchema).min(1, 'Minimal satu baris barang'),
});
export type ReceiptUpdateInput = z.infer<typeof receiptUpdateSchema>;

/** Hasil pemindaian barcode di meja penerimaan. */
export interface ResolvedPart {
  found: boolean;
  partId?: number;
  partNumber?: string;
  backNumber?: string | null;
  name?: string;
  uom?: string;
  trackingMode?: 'SERIAL' | 'LOT' | 'QUANTITY';
  partType?: string;
  message: string;
}

export interface ReceiptSummary {
  id: number;
  documentNumber: string;
  supplierDocNumber: string | null;
  supplierName: string | null;
  receivedAt: string | Date;
  status: string;
  lineCount: number;
  totalQty: string | number;
  aresOrderNumber: string | null;
  revision: number | null;
  boxOrdered: number | null;
  boxScanned: number;
  closedAt: string | Date | null;
}
