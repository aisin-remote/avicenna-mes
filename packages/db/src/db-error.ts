/**
 * Menerjemahkan galat driver database menjadi sebab yang bisa ditindaklanjuti.
 *
 * ── Kenapa satu tempat ──────────────────────────────────────────────────────
 *
 * Sebelumnya setiap modul menuliskan sendiri angka galat MySQL — 1062, 1451,
 * 1452 — tersebar di delapan berkas. Saat database berpindah ke Postgres,
 * seluruh angka itu menjadi salah sekaligus, dan salahnya DIAM: kode penangkap
 * duplikat berhenti mengenali duplikat, lalu kiriman ulang yang semestinya
 * dilaporkan "sudah discan" muncul sebagai kegagalan server di layar operator.
 *
 * Pengetahuan soal dialek berhenti di berkas ini. Yang dipakai modul lain
 * hanyalah sebabnya, bukan kodenya.
 */

/** Sebab galat yang perlu dibedakan oleh aplikasi. */
export type SebabGalatDb =
  /** Melanggar unique index — baris dengan kunci yang sama sudah ada. */
  | 'DUPLIKAT'
  /** Baris masih dirujuk baris lain, jadi tidak bisa dihapus. */
  | 'MASIH_DIRUJUK'
  /** Menunjuk baris yang tidak ada. */
  | 'RUJUKAN_HILANG'
  /** Kolom wajib dikirim kosong. */
  | 'KOLOM_WAJIB_KOSONG'
  /** Tabelnya belum ada — biasanya migrasi belum dijalankan. */
  | 'TABEL_TIDAK_ADA';

/**
 * SQLSTATE Postgres. Lihat
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const SQLSTATE: Record<string, SebabGalatDb> = {
  '23505': 'DUPLIKAT',
  /*
   * 23503 dipakai Postgres untuk DUA keadaan yang berlawanan arah:
   *
   *   INSERT/UPDATE menunjuk baris yang tidak ada   -> RUJUKAN_HILANG
   *   DELETE baris yang masih ditunjuk baris lain   -> MASIH_DIRUJUK
   *
   * MySQL membedakannya lewat dua nomor (1452 dan 1451); Postgres tidak.
   * Yang membedakan hanya kalimat pertama pesannya, dan itu dibaca di
   * arahRujukan() di bawah. Nilai di tabel ini adalah dugaan terakhir bila
   * kalimat itu tidak dikenali.
   *
   * Salah arah bukan sekadar pesan yang kurang enak: orang yang menambah baris
   * dengan kode yang belum terdaftar akan membaca "masih dipakai data lain
   * sehingga tidak bisa dihapus" — menyuruhnya memperbaiki hal yang sama
   * sekali berbeda dari yang salah.
   */
  '23503': 'MASIH_DIRUJUK',
  '23502': 'KOLOM_WAJIB_KOSONG',
  '42P01': 'TABEL_TIDAK_ADA',
};

/**
 * Nomor galat MySQL — masih dibutuhkan.
 *
 * Dua sumber data di luar aplikasi ini tetap MySQL: ARES (daftar picking) dan
 * basis data mesin. Galat dari sana lewat jalur yang sama.
 */
const MYSQL: Record<number, SebabGalatDb> = {
  1062: 'DUPLIKAT',
  1451: 'MASIH_DIRUJUK',
  1452: 'RUJUKAN_HILANG',
  1048: 'KOLOM_WAJIB_KOSONG',
  1146: 'TABEL_TIDAK_ADA',
};

interface GalatMentah {
  code?: string | number;
  message?: string;
  errno?: number;
  constraint?: string;
  detail?: string;
  cause?: GalatMentah;
}

/**
 * Sebab sebuah galat database, atau undefined kalau bukan galat yang dikenali.
 *
 * Dibaca sampai ke `cause` karena Drizzle membungkus galat driver di dalam
 * DrizzleQueryError — kode aslinya satu tingkat lebih dalam, dan pemeriksaan
 * yang hanya melihat lapisan luar selalu meleset.
 */
/**
 * Arah pelanggaran foreign key, dibaca dari kalimat pertama pesan Postgres.
 *
 * "insert or update on table X violates foreign key constraint"  -> menunjuk
 * "update or delete on table X violates foreign key constraint"  -> ditunjuk
 */
function arahRujukan(e: GalatMentah): SebabGalatDb | undefined {
  const pesan = typeof e.message === 'string' ? e.message : '';
  if (pesan.startsWith('insert or update on table')) return 'RUJUKAN_HILANG';
  if (pesan.startsWith('update or delete on table')) return 'MASIH_DIRUJUK';
  return undefined;
}

export function sebabGalatDb(err: unknown): SebabGalatDb | undefined {
  let e = err as GalatMentah | undefined;
  for (let dalam = 0; e && dalam < 5; dalam += 1) {
    if (e.code === '23503') return arahRujukan(e) ?? 'MASIH_DIRUJUK';
    if (typeof e.code === 'string' && SQLSTATE[e.code]) return SQLSTATE[e.code];
    if (typeof e.errno === 'number' && MYSQL[e.errno]) return MYSQL[e.errno];
    if (typeof e.code === 'number' && MYSQL[e.code]) return MYSQL[e.code];
    e = e.cause;
  }
  return undefined;
}

/** Apakah galat ini pelanggaran unique index. */
export function galatDuplikat(err: unknown): boolean {
  return sebabGalatDb(err) === 'DUPLIKAT';
}

/**
 * Nama constraint yang dilanggar, bila disebutkan driver.
 *
 * Postgres menyebutkannya; MySQL tidak. Dipakai hanya untuk menyusun pesan yang
 * lebih tepat — jangan dijadikan syarat, sebab nilainya bisa kosong.
 */
export function constraintGalat(err: unknown): string | undefined {
  let e = err as GalatMentah | undefined;
  for (let dalam = 0; e && dalam < 5; dalam += 1) {
    if (e.constraint) return e.constraint;
    e = e.cause;
  }
  return undefined;
}
