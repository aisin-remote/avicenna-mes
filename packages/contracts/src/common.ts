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

/**
 * Apakah lini proses ini menghasilkan finish good.
 *
 * TIDAK LAGI menentukan syarat scan — itu sekarang milik METODE SCAN di
 * TM_ROUTE_PROCESS (lihat SCAN_MODES di bawah). Yang masih memakainya:
 * pemeriksaan kewajaran rute ("lini FG harus jadi langkah terakhir sebelum
 * Delivery") dan penerjemahan nilai metode yang lama.
 */
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

/**
 * Nama cookie sesi.
 *
 * Ditaruh di contracts karena DUA sisi membacanya: web yang menuliskannya saat
 * login, dan API yang menerimanya pada aliran SSE (EventSource di browser tidak
 * bisa mengirim header Authorization). Ditulis dua kali sebagai teks di dua
 * paket yang berbeda, satu hari salah satunya berganti nama dan monitor berhenti
 * menerima data tanpa satu pun galat yang menyebut sebabnya.
 */
export const NAMA_COOKIE_SESI = 'avicenna_token';

/**
 * ─── METODE SCAN sebuah proses ──────────────────────────────────────────────
 *
 * Satu kolom di TM_ROUTE_PROCESS (per pabrik per proses) yang menentukan
 * SELURUH syarat scan di lini itu. Sebelumnya hanya dua nilai, dan "wajib
 * kanban atau tidak" disimpulkan dari NAMA jenis prosesnya lewat daftar yang
 * ditanam di kode — sehingga menambah variasi menuntut menyunting kode, bukan
 * mengisi master. Sekarang metodenya data.
 *
 *   PART_SAJA          scan part code saja; kanban ditolak.
 *                      Casting WIP, Machining WIP.
 *
 *   PART_KANBAN        part ditahan sampai box penuh, lalu kartu kanban
 *                      menutup box; tiap unit ditempel ke kartu.
 *                      Casting FG, Machining FG, Assembling UNIT.
 *
 *   KANBAN_BOX         barang tidak berseri. Master sample sekali di awal
 *                      shift, lalu satu scan kartu = satu box.
 *                      Injection, Painting, Assembling BODY.
 *
 *   PART_TANPA_KANBAN  hasil jadi tetapi tidak ditempel kartu ("noseri" di
 *                      sebagian lini BODY). Syarat scannya sama dengan
 *                      PART_SAJA; yang berbeda artinya di hilir — barangnya
 *                      barang jadi, hanya tanpa kartu.
 *
 *   PART_PINDAH_KARTU  part dilepas dari kartu internal lalu ditempel ke kartu
 *                      customer (Torimetron D05E). BELUM ADA ALURNYA — scan
 *                      pada lini bermetode ini ditolak dengan pesan jelas,
 *                      bukan diperlakukan sebagai metode lain.
 *
 *   KANBAN_MOLD        tag mold dulu, lalu kanban milik ANGGOTA mold itu,
 *                      dihitung per siklus (injection, mold keluarga).
 *                      BELUM ADA ALURNYA.
 *
 *   KANBAN_BOX_DANDORI papan dandori dulu, lalu master sample, lalu kanban
 *                      per box (assembling BODY). BELUM ADA ALURNYA.
 *
 * ── Per LINI, bukan hanya per proses ────────────────────────────────────────
 *
 * Metodenya ditentukan di master Rute Proses (per pabrik per proses) dan boleh
 * DITIMPA per lini di master Line. Injection dan assembling BODY berada di
 * pabrik yang sama tetapi caranya berbeda — tanpa penimpa per lini, keduanya
 * terpaksa berbagi satu metode yang tidak cocok untuk salah satunya.
 */
export const SCAN_MODES = [
  'PART_SAJA',
  'PART_KANBAN',
  'KANBAN_BOX',
  'PART_TANPA_KANBAN',
  'PART_PINDAH_KARTU',
  'KANBAN_MOLD',
  'KANBAN_BOX_DANDORI',
] as const;
export const scanModeSchema = z.enum(SCAN_MODES);
export type ScanMode = z.infer<typeof scanModeSchema>;

/**
 * Nilai lama yang masih ada di data.
 *
 * 54 scan yang sudah tercatat menyimpan kebijakannya sebagai snapshot di
 * `meta.scanMode`, dan baris master yang belum dimigrasi bisa masih berisi
 * nilai ini. Keduanya tetap harus terbaca — karena itu nilai lama diterima
 * sebagai MASUKAN, tetapi tidak pernah ditawarkan sebagai pilihan baru.
 */
export const SCAN_MODES_LAMA = ['PER_PIECE', 'PER_KANBAN'] as const;
export type ScanModeLama = (typeof SCAN_MODES_LAMA)[number];

/** Nilai yang sah di kolom enum — baru dan lama sekaligus. */
export const SCAN_MODE_ENUM = [...SCAN_MODES, ...SCAN_MODES_LAMA] as const;

/** Apa pun yang mungkin tersimpan: metode sekarang, atau nilai lama. */
export type ScanModeTersimpan = ScanMode | ScanModeLama;

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  PART_SAJA: 'Part saja (tanpa kanban)',
  PART_KANBAN: 'Part + kanban (box ditutup kartu)',
  KANBAN_BOX: 'Kanban per box (master sample dulu)',
  PART_TANPA_KANBAN: 'Part saja, hasil jadi tanpa kartu',
  PART_PINDAH_KARTU: 'Part pindah kartu (belum tersedia)',
  KANBAN_MOLD: 'Tag mold lalu kanban anggota (belum tersedia)',
  KANBAN_BOX_DANDORI: 'Papan dandori, sample, lalu kanban (belum tersedia)',
};

/**
 * Menerjemahkan nilai tersimpan menjadi metode yang berlaku sekarang.
 *
 * SATU-SATUNYA tempat nilai lama ditafsirkan. `PER_PIECE` dulu berarti dua hal
 * berbeda tergantung jenis prosesnya — kanban wajib di lini FG, dilarang di
 * lini WIP — jadi penerjemahannya memang butuh jenis prosesnya.
 */
export function normalkanModeScan(
  mode: ScanModeTersimpan | null | undefined,
  proses: ProcessType | null | undefined,
): ScanMode {
  if (mode === 'PER_KANBAN') return 'KANBAN_BOX';
  if (mode === 'PER_PIECE') {
    return proses && menghasilkanFinishGood(proses) ? 'PART_KANBAN' : 'PART_SAJA';
  }
  if (mode) return mode;
  return proses ? modeScanBawaan(proses) : 'PART_SAJA';
}

/**
 * Apakah metode ini menghitung satu scan sebagai SATU BOX, bukan satu barang.
 *
 * Dipakai aturan barcode: hanya di metode ini barcode polos boleh ditafsirkan
 * sebagai nomor part (master sample). Menerima nilai lama supaya pemanggil
 * yang belum menormalkan tetap benar.
 */
export function scanPerBox(mode: ScanModeTersimpan | null | undefined): boolean {
  return (
    mode === 'KANBAN_BOX' ||
    mode === 'KANBAN_BOX_DANDORI' ||
    mode === 'KANBAN_MOLD' ||
    mode === 'PER_KANBAN'
  );
}

/**
 * Metode yang berlaku di sebuah lini.
 *
 * Urutannya: penimpa di master Line, lalu master Rute Proses, lalu bawaan
 * jenis prosesnya. Ditulis sekali di sini supaya layar operator, dashboard,
 * dan pencatat scan tidak pernah berbeda pendapat soal lini yang sama.
 */
export function modeScanBerlaku(input: {
  modeLini?: ScanModeTersimpan | null;
  modeProses?: ScanModeTersimpan | null;
  proses?: ProcessType | null;
}): ScanMode {
  return normalkanModeScan(input.modeLini ?? input.modeProses ?? null, input.proses);
}

/**
 * Metode bawaan sebuah jenis proses — dipakai saat baris master belum ada.
 *
 * Injection, painting, dan assembling body adalah proses plant BODY, dan di
 * sana barang tidak berseri: satu scan = satu box (bella, prdreport). Proses
 * UNIT yang menghasilkan barang jadi menempelkan kartu; sisanya part saja.
 *
 * Hanya BAWAAN. Yang berlaku adalah isi TM_ROUTE_PROCESS per pabrik.
 */
export function modeScanBawaan(p: ProcessType): ScanMode {
  if (p === 'INJECTION' || p === 'PAINTING' || p === 'ASSEMBLING_BODY') return 'KANBAN_BOX';
  return menghasilkanFinishGood(p) ? 'PART_KANBAN' : 'PART_SAJA';
}

