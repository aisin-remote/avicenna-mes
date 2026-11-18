import { z } from 'zod';

/**
 * ─── STASIUN BELANJA ────────────────────────────────────────────────────────
 *
 * Langkah di antara WIP dan FG: kartu FG dibawa ke rak barang setengah jadi,
 * box-box yang dibutuhkan diambil, lalu kartu FG dan kartu WIP tiap box
 * di-scan bersama. Kalau isinya cocok dengan Part Pairing, pasangannya tercatat dan
 * scan produksi assembling baru diizinkan untuk kartu FG itu.
 *
 * ── Kenapa seluruh daftar dikirim ulang setiap scan ─────────────────────────
 *
 * Sesinya tidak disimpan di server. Layar memegang daftar kartu yang sudah
 * ditembak dan mengirimnya utuh pada setiap tembakan; server menghitung ulang
 * seluruh kebutuhan dan menjawab dengan keadaan sesi yang baru.
 *
 * Sesi di server sempat dipertimbangkan, lalu ditolak: scanner di lantai mati
 * baterai, tertutup layarnya, atau dibawa orang lain di tengah belanja — dan
 * sesi yang menggantung di server akan menahan kartu WIP yang sebenarnya masih
 * di rak. Dengan daftar di layar, scanner yang mati berarti belanja itu
 * hilang, bukan kartu yang terkunci entah sampai kapan.
 */

const kodePabrik = z.string().trim().min(1).max(32);
const kodeKartu = z.string().trim().min(1).max(191);
/** Kartu WIP yang SUDAH ditembak di layar, dikirim ulang tiap kali. */
const daftarWip = z.array(z.number().int().positive()).max(64);

export const scanBelanjaSchema = z.object({
  plantCode: kodePabrik,
  /** Kosong berarti tembakan ini kartu FG-nya — pembuka sesi. */
  fgKanbanId: z.number().int().positive().nullable().optional(),
  rawCode: kodeKartu,
  wipKanbanIds: daftarWip.default([]),
});
export type ScanBelanjaInput = z.infer<typeof scanBelanjaSchema>;

export const simpanBelanjaSchema = z.object({
  plantCode: kodePabrik,
  fgKanbanId: z.number().int().positive(),
  wipKanbanIds: daftarWip.min(1),
});
export type SimpanBelanjaInput = z.infer<typeof simpanBelanjaSchema>;

export const batalBelanjaSchema = z.object({
  plantCode: kodePabrik,
  fgKanbanId: z.number().int().positive(),
});
export type BatalBelanjaInput = z.infer<typeof batalBelanjaSchema>;

/** Satu kartu di layar belanja. */
export interface KartuBelanjaRingkas {
  kanbanId: number;
  partId: number;
  partNumber: string;
  partName: string | null;
  backNumber: string | null;
  serialNumber: string;
  /** Unit yang dibawa kartu ini. */
  qty: number;
}

/** Satu komponen beserta kemajuan pengambilannya. */
export interface KebutuhanKomponen {
  partId: number;
  partNumber: string;
  partName: string | null;
  dibutuhkan: number;
  dibawa: number;
  jumlahKartu: number;
  selisih: number;
  pas: boolean;
  /** Kekurangannya tidak bisa digenapi dengan isi box yang sedang dipakai. */
  tidakAkanPas: { isiBox: number; kurangKartu: number; lebihKartu: number } | null;
}

export interface SesiBelanja {
  fg: KartuBelanjaRingkas;
  /** Unit FG yang akan dihasilkan kartu itu. */
  unitFg: number;
  komponen: KebutuhanKomponen[];
  kartuWip: KartuBelanjaRingkas[];
  bolehDisimpan: boolean;
  /** Pesan siap tampil. Kosong berarti tidak ada yang menghalangi. */
  galat: string[];
}

export type HasilBelanjaScan = 'DITERIMA' | 'DITOLAK';

export interface ScanBelanjaResult {
  hasil: HasilBelanjaScan;
  pesan: string;
  rawCode: string;
  /** Sisi mana yang terbaca dari tembakan ini. */
  sisi: 'FG' | 'WIP' | null;
  /** Keadaan sesi setelah tembakan ini; kosong kalau sesinya belum/gagal dibuka. */
  sesi: SesiBelanja | null;
}

export interface SimpanBelanjaResult {
  hasil: HasilBelanjaScan;
  pesan: string;
  /** Terisi saat gagal, supaya layar tetap menunjukkan kekurangannya. */
  sesi: SesiBelanja | null;
}

/** Kartu FG yang sudah belanja dan belum discan produksi. */
export interface BelanjaMenunggu {
  fgKanbanId: number;
  partNumber: string;
  backNumber: string | null;
  serialNumber: string;
  jumlahKartu: number;
  unit: number;
  pairedAt: string;
  npk: string | null;
}

export interface StasiunBelanja {
  pabrik: { code: string; name: string };
  /**
   * Proses di pabrik ini yang scan produksinya mewajibkan belanja.
   *
   * Disebut di layar supaya orang tahu belanja ini untuk apa — dan supaya
   * area yang penandanya belum dinyalakan terbaca sebagai belum dinyalakan,
   * bukan sebagai layar yang rusak.
   */
  prosesWajib: string[];
  menunggu: BelanjaMenunggu[];
}
