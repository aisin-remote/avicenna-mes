import { z } from 'zod';

/**
 * ─── STASIUN KANBAN: KARTU ARES, SATU AREA PER PABRIK ───────────────────────
 *
 * Yang discan di sini HANYA kartu komponen terbitan ARES. Kartu kanban kita
 * sendiri dilepas di tempat lain: dihitung di pos kanban (UNIT), atau dilepas
 * oleh belanja (BODY).
 *
 * Yang dicatatnya adalah PERPINDAHAN SLOC, dan SLOC itu milik pabrik:
 * WH70 ke WP70 di Body, WH80 ke WP80 di Unit, WH90 ke WP90 di Electric. Lini
 * tidak ikut menentukan apa pun di dokumennya.
 *
 * Karena itu areanya tiga, bukan sebanyak lini. Memilih lini lebih dulu berarti
 * operator harus menebak lini mana yang "benar" untuk gerakan yang sama sekali
 * tidak bergantung pada lini — dan tebakan itu masuk ke catatan sebagai fakta.
 * Lebih jujur mencatat tanpa lini daripada mencatat lini yang dikarang.
 */
export const scanKomponenSchema = z.object({
  /** Kode pabrik: UNIT, BODY, ELEC. Menentukan SLOC asal dan tujuan. */
  plantCode: z.string().trim().min(1).max(32),
  rawCode: z.string().trim().min(1).max(191),
  /** Dikirim ulang saat jaringan terputus; server menolak kiriman kedua. */
  clientRef: z.string().trim().max(64).optional(),
});
export type ScanKomponenInput = z.infer<typeof scanKomponenSchema>;

export type HasilKartu = 'DITERIMA' | 'DITOLAK';

export interface ScanKomponenResult {
  hasil: HasilKartu;
  /** Terisi hanya bila yang terbaca memang kartu ARES. */
  jenisKartu: 'ARES' | null;
  pesan: string;
  rawCode: string;

  partNumber: string | null;
  partName: string | null;
  backNumber: string | null;
  qty: number | null;

  dariSloc: string | null;
  keSloc: string | null;
  /** Apakah perpindahan ini akan dikirim ke SAP. */
  keSap: boolean;

  scannedAt: string;
}

/** Satu baris riwayat di layar stasiun. */
export interface RiwayatKomponen {
  id: number;
  rawCode: string;
  jenisKartu: 'ARES' | null;
  partNumber: string | null;
  backNumber: string | null;
  qty: number | null;
  scannedAt: string;
}

export interface StasiunKomponen {
  pabrik: {
    code: string;
    name: string;
    /** Kode pabrik SAP. Kosong berarti dokumennya nanti ditahan, bukan dikira-kira. */
    sapCode: string | null;
  };
  /** SLOC asal dan tujuan kartu komponen di pabrik ini. */
  gudang: string | null;
  wip: string | null;
  /** Berapa kartu komponen dipindah hari ini di area ini. */
  kartuHariIni: number;
  terakhir: RiwayatKomponen[];
}
