import { parseAresScanCode } from './receiving-session';

/**
 * ─── STASIUN KANBAN: HANYA KARTU KOMPONEN ARES ───────────────────────────────
 *
 * Yang discan di stasiun ini hanya kartu komponen terbitan ARES: komponen beli,
 * barangnya pindah WH -> WP milik pabrik itu, ada dokumen SAP, dan kartunya
 * habis sesudah itu (one-way).
 *
 * ── Kartu kanban kita sendiri TIDAK discan di sini ──────────────────────────
 *
 * Kartu internal dilepas di tempat yang berbeda-beda menurut pabriknya:
 *
 *   di UNIT   kartu dicopot dari box lalu DIHITUNG di pos kanban, tidak
 *             discan — status kartunya tidak menggerakkan apa pun di sana,
 *             sebab lini UNIT memakai metode PART_KANBAN yang tidak menolak
 *             kartu terproduksi
 *   di BODY   kartu dilepas oleh BELANJA, di stasiun belanja, pada saat box-nya
 *             diambil proses berikutnya — dan di situlah interlock-nya
 *
 * Menerima kartu internal di sini akan membatalkan keduanya: di BODY ia menjadi
 * jalan pintas yang melepaskan kartu tanpa box-nya pernah dicocokkan, dan di
 * UNIT ia menulis perpindahan yang tidak pernah terjadi.
 *
 * `kenaliKartu` tetap membedakan keduanya — bukan untuk melayani kartu
 * internal, melainkan supaya penolakannya bisa menyebut APA yang barusan
 * ditembak, bukan sekadar "tidak dikenali".
 */

export type JenisKartu = 'ARES' | 'INTERNAL';

export interface KartuAres {
  jenis: 'ARES';
  /** 26 karakter setelah `ARES:K:`. */
  id: string;
}

/** Kartu kanban terbitan kita sendiri. Dikenali, tetapi tidak dilayani di sini. */
export interface KartuInternal {
  jenis: 'INTERNAL';
  raw: string;
}

export type KartuKomponen = KartuAres | KartuInternal;

/**
 * Menentukan kartu apa yang barusan discan.
 *
 * ── Kenapa ARES diperiksa LEBIH DULU ────────────────────────────────────────
 *
 * Bentuknya pasti dan sempit: `ARES:K:` diikuti tepat 26 karakter. Aturan
 * barcode kanban kita jauh lebih longgar dan berbeda-beda per customer, jadi
 * mendahulukannya berisiko ada aturan yang kebetulan juga cocok dengan kode
 * ARES — dan kartu komponen akan diperlakukan sebagai kartu internal, yang
 * berarti perpindahan WH ke WP tidak pernah sampai ke SAP.
 */
export function kenaliKartu(raw: string): KartuKomponen | null {
  const bersih = raw.trim();
  if (!bersih) return null;

  const ares = parseAresScanCode(bersih);
  if (ares?.kind === 'KANBAN') return { jenis: 'ARES', id: ares.id };

  /*
   * Kode ARES yang BUKAN kartu — mis. `ARES:P:...` (Order Sheet) — ditolak di
   * sini, bukan diteruskan sebagai kartu WIP. Operator yang salah mengambil
   * lembar order harus diberi tahu itu, bukan dibiarkan menebak kenapa
   * kartunya "tidak terdaftar".
   */
  if (ares) return null;

  return { jenis: 'INTERNAL', raw: bersih };
}

/** Sebab sebuah scan kartu ditolak. Dipakai menyusun pesan di layar stasiun. */
export type TolakKartu =
  | 'TIDAK_DIKENALI'
  | 'ARES_BELUM_DITERIMA'
  | 'ARES_SUDAH_DIPINDAH'
  | 'BEDA_PABRIK'
  | 'BUKAN_KARTU_ARES';

export const PESAN_TOLAK: Record<TolakKartu, string> = {
  TIDAK_DIKENALI: 'Barcode tidak dikenali sebagai kartu kanban.',
  ARES_BELUM_DITERIMA:
    'Kartu ini belum pernah diterima di penerimaan. Terima dulu barangnya, baru dipindah ke WIP.',
  ARES_SUDAH_DIPINDAH: 'Kartu ini sudah dipakai memindahkan barang ke WIP.',
  BEDA_PABRIK: 'Kartu ini milik pabrik lain.',
  /*
   * Kartu kanban kita sendiri. Tempat melepasnya berbeda per pabrik — pos
   * kanban di UNIT, stasiun belanja di BODY — dan keduanya bukan di sini.
   */
  BUKAN_KARTU_ARES:
    'Ini kartu kanban internal, bukan kartu komponen ARES. Kartu internal tidak discan di sini.',
};

/**
 * Apakah perpindahan kartu ARES menghasilkan dokumen SAP.
 *
 * Dipisah jadi fungsi sendiri supaya aturannya bisa diuji tanpa database, dan
 * supaya tidak ada yang tergoda menambahkan dokumen untuk kartu WIP di
 * kemudian hari tanpa melewati pemeriksaan ini.
 */
export function kartuMenghasilkanDokumenSap(jenis: JenisKartu): boolean {
  return jenis === 'ARES';
}
