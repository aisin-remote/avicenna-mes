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
