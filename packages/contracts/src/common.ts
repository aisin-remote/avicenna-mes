import { z } from 'zod';

/**
 * ─── KATALOG JENIS PROSES ───────────────────────────────────────────────────
 *
 * Daftar jenis proses TIDAK lagi ditanam di sini. Ia hidup di master
 * `TM_PROCESS_TYPE`, dan berkas ini hanya menyediakan bentuknya serta cara
 * membacanya.
 *
 * ── Kenapa diberikan, bukan diambil ─────────────────────────────────────────
 *
 * Katalog dibuat SEKALI dari baris master lalu DIBERIKAN ke yang membutuhkan.
 * Alternatifnya satu variabel modul yang diisi saat boot lalu dibaca dari mana
 * saja — lebih sedikit sunting, tetapi fungsinya diam-diam bergantung pada
 * sesuatu yang tidak terlihat di tanda tangannya. Yang lupa memuatnya tidak
 * mendapat galat, melainkan jawaban kosong: proses dianggap tidak menghasilkan
 * barang jadi, grup role kosong, kelas SAP NONE. Tiga kesalahan diam sekaligus,
 * dan ketiganya baru terlihat sebagai barang yang mendarat di gudang keliru.
 *
 * Karena itu katalog adalah objek biasa yang dioper. Yang tidak punya
 * katalognya tidak bisa memanggil fungsinya sama sekali.
 */
export interface JenisProses {
  /** Dipakai sebagai nilai di seluruh kolom CHR_PROCESS_TYPE. */
  code: string;
  label: string;
  processGroup: ProcessGroup;
  sapClass: SapClass;
  scanMode: ScanModeTersimpan;
  sortOrder: number;
  isActive: boolean;
}

export interface KatalogProses {
  /** Yang aktif saja, terurut sortOrder. Inilah urutan kolom matriks rute. */
  readonly daftar: readonly JenisProses[];
  /** Kode yang aktif, terurut. Dipakai pilihan formulir dan kolom matriks. */
  readonly kode: readonly string[];
  /** Termasuk yang nonaktif: data lama tetap harus bisa dibaca namanya. */
  cari(code: string | null | undefined): JenisProses | undefined;
  /** Nama untuk layar. Kode apa adanya bila tidak dikenal — jangan kosong. */
  label(code: string | null | undefined): string;
  /** Apakah lini proses ini menutup rute dan menempel kanban. */
  menghasilkanFinishGood(code: string | null | undefined): boolean;
  grup(code: string | null | undefined): ProcessGroup | undefined;
  /** 'NONE' bila tidak dikenal — tidak dikenal berarti tidak dikirim ke SAP. */
  kelasSap(code: string | null | undefined): SapClass;
  modeScan(code: string | null | undefined): ScanModeTersimpan;
  /** Jenis proses yang termasuk sebuah grup role. */
  dalamGrup(grup: ProcessGroup): string[];
}

export function katalogProses(baris: readonly JenisProses[]): KatalogProses {
  const semua = [...baris].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
  const perKode = new Map(semua.map((j) => [j.code, j]));
  const aktif = semua.filter((j) => j.isActive);
  const cari = (code: string | null | undefined) => (code ? perKode.get(code) : undefined);

  return {
    daftar: aktif,
    kode: aktif.map((j) => j.code),
    cari,
    label: (code) => cari(code)?.label ?? code ?? '',
    menghasilkanFinishGood: (code) => cari(code)?.sapClass === 'FG',
    grup: (code) => cari(code)?.processGroup,
    kelasSap: (code) => cari(code)?.sapClass ?? 'NONE',
    modeScan: (code) => cari(code)?.scanMode ?? 'PART_SAJA',
    dalamGrup: (grup) => semua.filter((j) => j.processGroup === grup).map((j) => j.code),
  };
}

/**
 * Jenis proses sebagai nilai yang disimpan.
 *
 * Dulu union sempit dari enum; sejak daftarnya pindah ke master, yang tersisa
 * adalah string. Penjagaannya pindah ke dua tempat yang lebih tepat: foreign
 * key di database menolak kode yang tidak terdaftar, dan formulir master
 * menolak baris tanpa klasifikasi.
 */
export type ProcessType = string;

/**
 * Validasi nilai jenis proses pada payload.
 *
 * Dulu z.enum dari daftar yang ditanam. Sejak daftarnya pindah ke master, yang
 * bisa dijamin di sini hanya BENTUKNYA — bahwa kodenya ada dan masuk kolom.
 * Yang menolak kode yang tidak terdaftar adalah foreign key di database, dan
 * itu penjaga yang tidak bisa basi: ia membaca daftar yang sama dengan yang
 * dilihat orang di layar master.
 */
export const processTypeSchema = z
  .string()
  .trim()
  .min(1, 'Jenis proses wajib diisi')
  .max(32, 'Jenis proses terlalu panjang');

/**
 * Kelas hasil sebuah langkah proses menurut SAP.
 *
 *   SFG   barang setengah jadi — confirmation PP-PE-02, hasil masuk SLOC WIP
 *   FG    barang jadi          — confirmation PP-PE-03, hasil masuk SLOC FG
 *   NONE  tidak ada padanannya di SAP; hasilnya dicatat di Avicenna saja
 *
 * Inilah yang dulu berupa DUA daftar terpisah di kode — FINISH_GOOD_PROCESSES
 * dan KELAS_HASIL — yang isinya harus selalu sejalan. Disatukan menjadi satu
 * nilai supaya keduanya tidak bisa bertentangan: "menghasilkan barang jadi"
 * PERSIS sama dengan kelas FG, dan sekarang itu satu kolom, bukan dua daftar
 * yang kebetulan cocok.
 */
export const SAP_CLASSES = ['SFG', 'FG', 'NONE'] as const;
export type SapClass = (typeof SAP_CLASSES)[number];

/**
 * Jenis SLOC — satu-satunya daftarnya, diimpor skema database MAUPUN domain.
 *
 * Ditaruh di kontrak karena dua sisi membutuhkannya: TM_LOCATION.CHR_KIND yang
 * menyimpannya, dan aturan SAP di @avicenna/domain yang memutuskan perpindahan
 * mana yang punya padanan di SAP. Ditulis dua kali, satu hari yang satu
 * bertambah dan yang lain tidak — lalu jenis baru lolos dari seluruh
 * pemeriksaan tanpa satu pun galat.
 *
 *   WAREHOUSE   gudang komponen & raw material   WH70/WH80/WH90
 *   WIP         setengah jadi di line            WP70/WP80/WP90
 *   FINISH_GOOD barang jadi                      FG70/FG80/FG90
 *   NG          reject                           RE70/RE80/RE90
 *   STAGING     sudah dipick, menunggu truk      ST70/ST80/ST90 — MILIK KITA
 *   CHUTE       chute di lini                    tidak ada di SAP
 *   TRANSIT     dalam perjalanan antar pabrik    tidak ada di SAP
 *
 * Empat yang pertama adalah SLOC SAP sungguhan (Tabel 6 Blueprint PP AIIA).
 * Tiga sisanya hanya ada di sini.
 */
export const LOCATION_KINDS = [
  'WAREHOUSE',
  'WIP',
  'FINISH_GOOD',
  'STAGING',
  'CHUTE',
  'NG',
  'TRANSIT',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

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
  /*
   * Grup Electric. ASSEMBLING sengaja TIDAK dipecah per pabrik: grup adalah
   * lingkup ROLE, dan "assembling leader" memang satu jabatan — sedangkan
   * jenis prosesnya tetap terpisah supaya angkanya tidak bercampur.
   */
  'MOUNTING',
  'INSPECTION',
  'VACUUM',
  'ANTENNA',
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
  katalog: KatalogProses,
  mode: ScanModeTersimpan | null | undefined,
  proses: ProcessType | null | undefined,
): ScanMode {
  if (mode === 'PER_KANBAN') return 'KANBAN_BOX';
  if (mode === 'PER_PIECE') {
    return katalog.menghasilkanFinishGood(proses) ? 'PART_KANBAN' : 'PART_SAJA';
  }
  if (mode) return mode;
  /*
   * Bawaan dari master jenis proses. Nilai lama yang tersimpan di sana
   * mustahil — kolomnya dijaga daftar metode yang berlaku — tetapi kalau
   * sampai ada, ia diperlakukan seperti tidak diisi.
   */
  const bawaan = katalog.modeScan(proses);
  return bawaan === 'PER_PIECE' || bawaan === 'PER_KANBAN' ? 'PART_SAJA' : bawaan;
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
export function modeScanBerlaku(
  katalog: KatalogProses,
  input: {
    modeLini?: ScanModeTersimpan | null;
    modeProses?: ScanModeTersimpan | null;
    proses?: ProcessType | null;
  },
): ScanMode {
  return normalkanModeScan(katalog, input.modeLini ?? input.modeProses ?? null, input.proses);
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
export function modeScanBawaan(katalog: KatalogProses, p: ProcessType): ScanModeTersimpan {
  return katalog.modeScan(p);
}

/* Dipertahankan sebagai nama lama supaya pemanggil lama tidak berubah banyak. */
