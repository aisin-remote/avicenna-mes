import { z } from 'zod';

/*
 * Kosakata jenis proses. Harus sama persis dengan PROCESS_TYPES di
 * packages/db/src/schema/_shared.ts — keduanya menulis ke kolom enum yang sama,
 * dan nilai yang tidak dikenal MySQL ditolak saat insert, bukan saat validasi.
 */
export const processTypeSchema = z.enum([
  'MELTING',
  'CASTING',
  'MACHINING',
  'ASSEMBLING_UNIT',
  'INJECTION',
  'PAINTING',
  'ASSEMBLING_BODY',
  'DELIVERY',
]);
export type ProcessType = z.infer<typeof processTypeSchema>;

export const idSchema = z.coerce.number().int().positive();

/** Parameter paginasi standar untuk semua endpoint daftar. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(100).optional(),
  sort: z.string().max(64).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

/** Bentuk error seragam yang dikembalikan API. */
export const apiErrorSchema = z.object({
  statusCode: z.number(),
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
