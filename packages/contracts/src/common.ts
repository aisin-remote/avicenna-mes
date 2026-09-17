import { z } from 'zod';

/*
 * Kosakata jenis proses. Harus sama persis dengan PROCESS_TYPES di
 * packages/db/src/schema/_shared.ts — keduanya menulis ke kolom enum yang sama,
 * dan nilai yang tidak dikenal MySQL ditolak saat insert, bukan saat validasi.
 */
export const processTypeSchema = z.enum([
  'MELTING',
  'CASTING_WIP',
  'CASTING_FG',
  'MACHINING_WIP',
  'MACHINING_FG',
  'ASSEMBLING_UNIT',
  'INJECTION',
  'PAINTING',
  'ASSEMBLING_BODY',
  'DELIVERY',
]);
export type ProcessType = z.infer<typeof processTypeSchema>;

/**
 * SATU-SATUNYA daftar jenis proses. Paket lain MENGIMPOR dari sini.
 *
 * Pernah ada tiga salinan — di skema database, di kontrak, dan di registry
 * master. Dua kali daftar bertambah dan salah satu salinan tertinggal, lalu
 * formulir menawarkan nilai yang sudah tidak ada di kolom enum dan setiap
 * penyimpanan gagal dengan pesan MySQL yang tidak menyebut sebabnya.
 */
export const PROCESS_TYPES = processTypeSchema.options;

/**
 * Proses yang LININYA menghasilkan finish good.
 *
 * WIP dan FG adalah LINI YANG BERBEDA secara fisik, bukan sifat turunan dari
 * rute. Part yang berhenti di machining dikerjakan di lini Machining FG, part
 * yang masih lanjut ke assembling dikerjakan di lini Machining WIP.
 *
 * Bedanya nyata di lantai:
 *   lini WIP  hanya scan part code
 *   lini FG   scan part code DAN kanban — sejak titik itu barang berpindah
 *             sebagai kanban, dan di delivery part code tidak discan lagi
 *
 * Melting tidak pernah menghasilkan finish good (keluarannya logam cair), dan
 * assembling selalu menghasilkannya.
 */
export const FINISH_GOOD_PROCESSES = [
  'CASTING_FG',
  'MACHINING_FG',
  'ASSEMBLING_UNIT',
  'ASSEMBLING_BODY',
] as const satisfies readonly ProcessType[];

/** Apakah lini proses ini menghasilkan finish good — menentukan cara scan-nya. */
export function menghasilkanFinishGood(p: ProcessType): boolean {
  return (FINISH_GOOD_PROCESSES as readonly string[]).includes(p);
}

/** Label untuk layar. Dipisah supaya penggantian nama tidak menyentuh data. */
export const PROCESS_LABELS: Record<ProcessType, string> = {
  MELTING: 'Melting',
  CASTING_WIP: 'Casting WIP',
  CASTING_FG: 'Casting FG',
  MACHINING_WIP: 'Machining WIP',
  MACHINING_FG: 'Machining FG',
  ASSEMBLING_UNIT: 'Assembling (Unit)',
  INJECTION: 'Injection',
  PAINTING: 'Painting',
  ASSEMBLING_BODY: 'Assembling (Body)',
  DELIVERY: 'Delivery',
};

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

/**
 * Lingkup dan jabatan role. Dipakai skema database DAN browser, jadi tinggal di
 * kontrak — bukan di domain yang tidak diimpor sisi data.
 */
export const PROCESS_GROUPS = [
  'MELTING',
  'CASTING',
  'MACHINING',
  'ASSEMBLING',
  'INJECTION',
  'PAINTING',
  'DELIVERY',
] as const;
export type ProcessGroup = (typeof PROCESS_GROUPS)[number];

export const ROLE_KINDS = ['SCANNING', 'VIEW', 'ADMIN'] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];
