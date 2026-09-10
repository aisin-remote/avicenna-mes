import { z } from 'zod';
import { processTypeSchema } from './common';

export const scanKindSchema = z.enum([
  'PRODUCTION',
  'PULLING',
  'DELIVERY',
  'RECEIVING',
  'INSPECTION',
  'STOCK_TAKE',
]);
export type ScanKind = z.infer<typeof scanKindSchema>;

/**
 * Payload satu scan dari lapangan.
 *
 * `clientRef` diisi oleh device (mis. uuid lokal). Dipakai membentuk kunci
 * idempoten supaya kiriman ulang saat jaringan pabrik putus-nyambung tidak
 * menghasilkan data dobel — masalah yang sering terjadi di sistem lama.
 */
export const scanInputSchema = z.object({
  kind: scanKindSchema,
  processType: processTypeSchema.optional(),
  rawCode: z.string().trim().min(1, 'Barcode kosong').max(255),
  lineCode: z.string().trim().max(32).optional(),
  machineCode: z.string().trim().max(32).optional(),
  qty: z.coerce.number().int().min(1).default(1),
  npk: z.string().trim().max(32).optional(),
  scannedAt: z.coerce.date().optional(),
  clientRef: z.string().trim().max(64).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type ScanInput = z.infer<typeof scanInputSchema>;

/** Pengiriman batch — device offline mengirim antreannya sekaligus saat online. */
export const scanBatchSchema = z.object({
  scans: z.array(scanInputSchema).min(1).max(500),
});
export type ScanBatchInput = z.infer<typeof scanBatchSchema>;

export const scanResultSchema = z.object({
  accepted: z.number(),
  duplicated: z.number(),
  rejected: z.array(z.object({ index: z.number(), reason: z.string() })),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

/**
 * Hasil satu scan dari layar stasiun operator.
 *
 * Berbeda dari ScanResult yang meringkas satu batch dari device, bentuk ini
 * memuat semua yang dibutuhkan layar dalam satu jawaban: status untuk memilih
 * warna, pesan untuk ditampilkan besar, identitas part sebagai konfirmasi
 * visual, dan penghitung hari ini agar tidak perlu request kedua.
 */
export const stationStatusSchema = z.enum(['ACCEPTED', 'DUPLICATE', 'REJECTED']);
export type StationStatus = z.infer<typeof stationStatusSchema>;

export const stationResultSchema = z.object({
  status: stationStatusSchema,
  reason: z.string().optional(),
  message: z.string(),
  rawCode: z.string(),
  partNumber: z.string().nullable(),
  partName: z.string().nullable(),
  qty: z.number(),
  counterToday: z.number(),
  scannedAt: z.string(),
});
export type StationResult = z.infer<typeof stationResultSchema>;

export interface StationSummary {
  line: {
    code: string;
    name: string;
    processType: string;
    plantCode: string | null;
    plantName: string | null;
  };
  counterToday: number;
  recent: Array<{
    id: number;
    kind: string;
    rawCode: string;
    serialNumber: string | null;
    qty: number;
    scannedAt: string | Date;
    partNumber: string | null;
    partName: string | null;
  }>;
}
