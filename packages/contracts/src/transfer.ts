import { z } from 'zod';

/**
 * Perpindahan barang antar line atau antar lokasi di dalam satu pabrik.
 *
 * Satu dokumen = satu kali pemindahan. Setiap baris menghasilkan DUA mutasi:
 * keluar dari asal dan masuk ke tujuan. Saldo keseluruhan pabrik tidak berubah,
 * yang berpindah adalah tempatnya.
 */

export const transferLineInputSchema = z.object({
  partId: z.coerce.number().int().positive('Part wajib dipilih'),
  /** Wajib untuk part yang dilacak per lot — tanpa ini telusurnya putus. */
  lotId: z.coerce.number().int().positive().optional(),
  serialNumber: z.string().trim().max(64).optional(),
  qty: z.coerce.number().positive('Jumlah harus lebih dari nol'),
});
export type TransferLineInput = z.infer<typeof transferLineInputSchema>;

export const transferCreateSchema = z
  .object({
    plantId: z.coerce.number().int().positive('Pabrik wajib dipilih'),
    fromLineId: z.coerce.number().int().positive().optional(),
    toLineId: z.coerce.number().int().positive().optional(),
    fromLocationId: z.coerce.number().int().positive().optional(),
    toLocationId: z.coerce.number().int().positive().optional(),
    movedAt: z.coerce.date().optional(),
    note: z.string().trim().max(255).optional(),
    lines: z.array(transferLineInputSchema).min(1, 'Minimal satu baris barang'),
  })
  .refine((v) => v.fromLineId || v.fromLocationId, {
    message: 'Asal wajib diisi — pilih line atau lokasi',
    path: ['fromLineId'],
  })
  .refine((v) => v.toLineId || v.toLocationId, {
    message: 'Tujuan wajib diisi — pilih line atau lokasi',
    path: ['toLineId'],
  })
  .refine(
    (v) =>
      !(v.fromLineId && v.toLineId && v.fromLineId === v.toLineId) &&
      !(v.fromLocationId && v.toLocationId && v.fromLocationId === v.toLocationId),
    {
      // Memindahkan ke tempat yang sama menghasilkan dua mutasi yang saling
      // meniadakan — tidak salah secara angka, tapi jelas bukan yang dimaksud
      // dan hanya mengotori riwayat.
      message: 'Asal dan tujuan tidak boleh sama',
      path: ['toLineId'],
    },
  );
export type TransferCreateInput = z.infer<typeof transferCreateSchema>;

/** Stok yang tercatat untuk sebuah part, dirinci per lot. */
export interface StockAvailability {
  partId: number;
  partNumber: string;
  partName: string;
  uom: string;
  trackingMode: 'SERIAL' | 'LOT' | 'QUANTITY';
  total: number;
  lots: Array<{
    lotId: number;
    lotNumber: string;
    supplierLotNumber: string | null;
    remaining: number;
    receivedAt: string | null;
  }>;
}

export interface TransferSummary {
  id: number;
  documentNumber: string;
  fromName: string | null;
  toName: string | null;
  movedAt: string | Date;
  status: string;
  lineCount: number;
  totalQty: string | number;
}
