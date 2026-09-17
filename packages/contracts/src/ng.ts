import { z } from 'zod';
import { processTypeSchema, PROCESS_GROUPS } from './common';

/**
 * ─── NG: barang yang dinyatakan tidak baik ──────────────────────────────────
 *
 * Dua saat yang berbeda, dan perbedaannya bukan sekadar istilah:
 *
 *   INLINE   ketemu DI LINI, saat barangnya masih di tangan operator.
 *            Barangnya belum tentu pernah tercatat sebagai hasil baik.
 *
 *   OUTLINE  ketemu DI LUAR LINI — di rak, saat audit, saat mau dikirim.
 *            Barangnya hampir pasti sudah tercatat sebagai hasil baik, dan
 *            bisa jadi sudah menempel di kanban.
 *
 * Perbedaan itu yang menentukan apakah produksi perlu dibalik dan apakah
 * kartu kanbannya perlu dikosongkan. Karena itu disimpan sebagai data, bukan
 * disimpulkan belakangan dari jam kejadian.
 */
export const NG_ORIGINS = ['INLINE', 'OUTLINE'] as const;
export const ngOriginSchema = z.enum(NG_ORIGINS);
export type NgOrigin = z.infer<typeof ngOriginSchema>;

/**
 * Cara barangnya dikenali saat dinyatakan NG.
 *
 *   PART_CODE  barcode part itu sendiri — satu barang.
 *   KANBAN     kartu kanban — SELURUH isi kartu, bukan satu barang.
 *
 * Dicatat karena keduanya menghasilkan jumlah yang berbeda dari satu kali
 * scan, dan laporan NG yang mencampurnya akan menghitung satu box sebagai
 * satu pcs.
 */
export const NG_SOURCES = ['PART_CODE', 'KANBAN'] as const;
export const ngSourceSchema = z.enum(NG_SOURCES);
export type NgSource = z.infer<typeof ngSourceSchema>;

export const NG_ORIGIN_LABELS: Record<NgOrigin, string> = {
  INLINE: 'NG inline (di lini)',
  OUTLINE: 'NG outline (di luar lini)',
};

export const NG_SOURCE_LABELS: Record<NgSource, string> = {
  PART_CODE: 'Scan part code',
  KANBAN: 'Scan kanban',
};

const processGroupSchema = z.enum(PROCESS_GROUPS);

/** Satu jenis NG di master — isi tombol di layar operator. */
export const ngTypeSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  processGroup: processGroupSchema.nullable(),
  category: z.string().nullable(),
  sortOrder: z.number(),
});
export type NgType = z.infer<typeof ngTypeSchema>;

/**
 * NG inline: satu barang, dikenali dari part code.
 *
 * Kanban tidak dipakai di sini dengan sengaja. Di lini WIP kanban memang belum
 * ada, dan di lini FG kartu baru menempel pada saat scan baik — barang yang NG
 * tidak pernah sampai menempel.
 */
export const ngInlineInputSchema = z.object({
  rawCode: z.string().trim().min(1, 'Barcode kosong').max(255),
  lineCode: z.string().trim().min(1, 'Lini belum dipilih').max(32),
  ngMasterId: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().min(1).default(1),
  npk: z.string().trim().max(32).optional(),
  occurredAt: z.coerce.date().optional(),
});
export type NgInlineInput = z.infer<typeof ngInlineInputSchema>;

/**
 * NG outline: barangnya dikenali lewat part code ATAU lewat kanban.
 *
 * `via` ditulis eksplisit, tidak ditebak dari bentuk barcode-nya. Menebak
 * berarti sebuah kartu kanban yang kebetulan terbaca sebagai part code akan
 * menyatakan satu pcs NG padahal satu box yang bermasalah — dan sisanya tetap
 * terkirim ke customer.
 */
export const ngOutlineInputSchema = z.object({
  rawCode: z.string().trim().min(1, 'Barcode kosong').max(255),
  via: ngSourceSchema,
  ngMasterId: z.coerce.number().int().positive(),
  /** Lini tempat NG-nya ditemukan. Boleh kosong: outline sering di luar lini. */
  lineCode: z.string().trim().max(32).optional(),
  qty: z.coerce.number().int().min(1).default(1),
  npk: z.string().trim().max(32).optional(),
  occurredAt: z.coerce.date().optional(),
});
export type NgOutlineInput = z.infer<typeof ngOutlineInputSchema>;

/** Membatalkan pencatatan NG — pengganti tombol "klik lagi untuk hapus". */
export const ngCancelInputSchema = z.object({
  id: z.coerce.number().int().positive(),
  reason: z.string().trim().max(255).optional(),
});
export type NgCancelInput = z.infer<typeof ngCancelInputSchema>;

/** Satu catatan NG yang sedang berlaku pada sebuah barang. */
export const ngOnUnitSchema = z.object({
  id: z.number(),
  ngMasterId: z.number(),
  ngCode: z.string().nullable(),
  ngName: z.string().nullable(),
  qty: z.number(),
  origin: ngOriginSchema,
  source: ngSourceSchema,
  occurredAt: z.string(),
  npk: z.string().nullable(),
});
export type NgOnUnit = z.infer<typeof ngOnUnitSchema>;

export const NG_STATUSES = ['ACCEPTED', 'REJECTED'] as const;

/**
 * Jawaban satu pencatatan NG untuk layar operator.
 *
 * Memuat semua yang dibutuhkan layar dalam satu balasan: status untuk memilih
 * warna, pesan untuk dibaca dari jauh, daftar NG yang kini menempel pada
 * barang itu, dan apa yang ikut terjadi (produksi dibalik, kanban dikosongkan)
 * — karena dua yang terakhir mengubah stok dan operator berhak tahu.
 */
export const ngResultSchema = z.object({
  status: z.enum(NG_STATUSES),
  reason: z.string().optional(),
  message: z.string(),
  rawCode: z.string(),
  partNumber: z.string().nullable(),
  partName: z.string().nullable(),
  processType: processTypeSchema.nullable(),
  /** Berapa pcs yang dinyatakan NG oleh satu scan ini. */
  qty: z.number(),
  /** Produksi yang dibalik dengan NG_OUT — 0 bila barangnya memang belum pernah tercatat baik. */
  dibalik: z.number(),
  /** Seri kanban yang ikut dikosongkan, bila NG-nya lewat kanban. */
  kanbanDikosongkan: z.string().nullable(),
  /** Seluruh NG yang kini menempel pada barang itu. */
  ngAktif: z.array(ngOnUnitSchema),
  ngHariIni: z.number(),
  occurredAt: z.string(),
});
export type NgResult = z.infer<typeof ngResultSchema>;
