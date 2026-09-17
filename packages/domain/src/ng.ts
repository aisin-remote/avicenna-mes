import {
  NG_ORIGINS,
  NG_SOURCES,
  NG_ORIGIN_LABELS,
  NG_SOURCE_LABELS,
  PROCESS_GROUPS,
  type NgOrigin,
  type NgSource,
  type ProcessGroup,
} from '@avicenna/contracts';

export { NG_ORIGINS, NG_SOURCES, NG_ORIGIN_LABELS, NG_SOURCE_LABELS };
export type { NgOrigin, NgSource };

/**
 * ─── Aturan NG ──────────────────────────────────────────────────────────────
 *
 * Semuanya murni: tidak menyentuh database, supaya bisa diuji tanpa pabrik.
 */

export class NgTidakSah extends Error {
  constructor(
    readonly reason: NgRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'NgTidakSah';
  }
}

export const NG_REJECT_MESSAGES = {
  NG_TYPE_UNKNOWN: 'Jenis NG tidak dikenal. Pilih dari tombol yang ada di layar.',
  NG_TYPE_WRONG_PLANT: 'Jenis NG itu milik pabrik lain.',
  NG_TYPE_WRONG_PROCESS: 'Jenis NG itu tidak berlaku untuk proses ini.',
  SOURCE_NOT_ALLOWED: 'Cara pengenalan barang itu tidak berlaku untuk NG ini.',
  PART_NOT_RECOGNIZED: 'Part tidak dikenali. Barangnya harus jelas sebelum dinyatakan NG.',
  LINE_NOT_FOUND: 'Line tidak dikenal. Periksa barcode lininya.',
  PLANT_UNKNOWN: 'Pabrik tidak bisa ditentukan dari data ini.',
  KANBAN_UNREADABLE: 'Kartu kanban tidak terbaca. Ulangi scan.',
  KANBAN_NOT_REGISTERED: 'Kartu kanban belum terdaftar di master.',
  KANBAN_EMPTY: 'Kartu kanban ini kosong — tidak ada barang untuk dinyatakan NG.',
  ALREADY_NG: 'Barang ini sudah tercatat NG dengan jenis yang sama.',
  ALREADY_CANCELLED: 'Catatan NG ini sudah dibatalkan sebelumnya.',
  NOT_FOUND: 'Catatan NG tidak ditemukan.',
} as const;

export type NgRejectReason = keyof typeof NG_REJECT_MESSAGES;

/**
 * Cara pengenalan barang yang sah untuk tiap saat penemuan.
 *
 * ── Kenapa NG inline tidak boleh lewat kanban ───────────────────────────────
 *
 * Di lini WIP kanban memang belum ada — barang berpindah dengan part code saja.
 * Di lini FG kartu baru menempel PADA SAAT scan baik, jadi barang yang NG tidak
 * pernah sampai menempel ke kartu mana pun.
 *
 * Membolehkannya berarti operator di lini bisa menggugurkan satu box penuh
 * dengan sekali scan, padahal yang rusak barang yang sedang dipegangnya.
 */
const SUMBER_SAH: Record<NgOrigin, readonly NgSource[]> = {
  INLINE: ['PART_CODE'],
  OUTLINE: ['PART_CODE', 'KANBAN'],
};

export function sumberDiizinkan(origin: NgOrigin): readonly NgSource[] {
  return SUMBER_SAH[origin];
}

export function sumberSah(origin: NgOrigin, source: NgSource): boolean {
  return SUMBER_SAH[origin].includes(source);
}

/**
 * Apakah scan ini menggugurkan SATU barang atau SELURUH isi kartu.
 *
 * Dipisah menjadi fungsi karena angkanya yang masuk laporan NG. Menganggap
 * satu scan kanban sebagai satu pcs membuat NG satu box terhitung satu.
 */
export function menggugurkanSatuKartu(source: NgSource): boolean {
  return source === 'KANBAN';
}

/**
 * Apakah produksi barang ini perlu dibalik (menulis NG_OUT).
 *
 * Dua syarat, dan keduanya perlu:
 *
 *  1. Barangnya memang pernah tercatat sebagai hasil BAIK di proses itu.
 *     NG di lini sering ketemu sebelum barangnya sempat discan baik; membalik
 *     yang belum pernah masuk akan membuat stok minus dari barang yang tidak
 *     pernah ada.
 *
 *  2. Belum pernah dibalik sebelumnya.
 *     Satu barang bisa dicap beberapa jenis NG sekaligus — retak DAN kotor.
 *     Tanpa syarat ini stoknya berkurang dua kali untuk satu barang yang rusak,
 *     dan selisihnya menumpuk tanpa ada yang bisa menjelaskannya.
 */
export function perluMembalikProduksi(k: {
  adaScanProduksi: boolean;
  sudahPernahDibalik: boolean;
}): boolean {
  return k.adaScanProduksi && !k.sudahPernahDibalik;
}

/**
 * Kunci "satu jenis NG aktif per barang" — isi CHR_ACTIVE_KEY.
 *
 * Dikosongkan (null) saat catatannya dibatalkan, sehingga barang yang sama bisa
 * dicatat NG lagi setelah pembatalan. Lihat komentar kolomnya di skema.
 */
export function kunciNgAktif(unit: string, ngMasterId: number): string {
  const bersih = unit.trim();
  if (!bersih) {
    throw new NgTidakSah('PART_NOT_RECOGNIZED', NG_REJECT_MESSAGES.PART_NOT_RECOGNIZED);
  }
  const kunci = `${bersih}|${ngMasterId}`;
  /*
   * Dipotong akan membuat dua barang yang berbeda berbagi kunci yang sama, dan
   * NG kedua ditolak sebagai "sudah tercatat" tanpa sebab yang masuk akal.
   * Lebih baik gagal keras di sini — panjang 320 memang tidak pernah tercapai
   * oleh barcode mana pun yang dipakai di pabrik.
   */
  if (kunci.length > 320) {
    throw new NgTidakSah(
      'PART_NOT_RECOGNIZED',
      `Barcode terlalu panjang untuk dicatat NG (${bersih.length} karakter).`,
    );
  }
  return kunci;
}

/**
 * Jenis NG yang muncul di layar sebuah grup proses.
 *
 * Yang lingkupnya kosong ikut tampil di semua proses — padanan tombol "DLL" di
 * layar lama, yang harus selalu ada supaya operator tidak terjebak tanpa satu
 * pilihan pun saat menemukan kerusakan yang belum terdaftar.
 */
export function jenisNgUntukGrup<T extends { processGroup?: ProcessGroup | null }>(
  daftar: readonly T[],
  grup: ProcessGroup | null | undefined,
): T[] {
  if (!grup) return [...daftar];
  return daftar.filter((n) => !n.processGroup || n.processGroup === grup);
}

/** Grup proses dari sebuah string bebas (isi query parameter). Null bila tidak dikenal. */
export function bacaGrupProses(raw: string | null | undefined): ProcessGroup | null {
  const bersih = (raw ?? '').trim().toUpperCase();
  return (PROCESS_GROUPS as readonly string[]).includes(bersih)
    ? (bersih as ProcessGroup)
    : null;
}
