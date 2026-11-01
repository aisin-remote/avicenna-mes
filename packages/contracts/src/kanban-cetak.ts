import { z } from 'zod';

/**
 * ─── CETAK KANBAN (OMD) ─────────────────────────────────────────────────────
 *
 * Master kanban TIDAK diisi lewat layar CRUD satu-satu. Ia lahir saat OMD
 * mencetak: pilih part, sebut rentang seri, dan kartu yang belum ada dibuatkan
 * barisnya. Mencetak ulang rentang yang sama tidak menambah baris baru.
 *
 * ── Kenapa pembuatan menempel pada pencetakan ───────────────────────────────
 *
 * Satu baris master = satu KARTU FISIK. Baris yang dibuat tanpa kartunya
 * tercetak adalah kartu yang "ada" di sistem tetapi tidak ada di rak — dan
 * perhitungan kartu beredar, yang menjadi batas WIP, langsung salah. Menempelkan
 * keduanya membuat keadaan itu tidak bisa terjadi tanpa sengaja.
 *
 * Yang MENENTUKAN jumlah kartu beredar tetap OMD, bukan sistem.
 */

/**
 * Batas satu kali cetak.
 *
 * 2000 kartu = 500 lembar A4. Lebih dari itu hampir pasti salah ketik rentang,
 * dan printernya yang menanggung. Batas ini disebut di layar, bukan hanya di
 * penolakan.
 */
export const KARTU_PER_CETAK_MAKS = 2000;

/**
 * Empat kartu per lembar A4, dipotong sebagai LAJUR MENDATAR.
 *
 * Kartunya 210 × 74,25 mm: selebar A4, setinggi seperempatnya (297 ÷ 4). Jadi
 * satu lembar dipotong tiga kali lurus mendatar, tanpa potongan tegak.
 */
export const KARTU_PER_LEMBAR = 4;

/** Lebar kartu dalam milimeter — selebar A4. */
export const KARTU_LEBAR_MM = 210;

/**
 * Tinggi kartu dalam milimeter.
 *
 * 74,2 dan bukan 74,25: empat kali 74,25 tepat 297 mm, yaitu seluruh tinggi
 * A4, dan pembulatan sepersekian milimeter di browser akan mendorong kartu
 * keempat ke lembar berikutnya. Selisih 0,05 mm per kartu tidak terlihat mata
 * maupun penggaris, sedangkan satu lembar yang isinya tiga kartu terlihat
 * seketika.
 */
export const KARTU_TINGGI_MM = 74.2;

export const cetakKanbanSchema = z
  .object({
    partId: z.number().int().positive(),
    dari: z.number().int().min(1).max(999_999),
    sampai: z.number().int().min(1).max(999_999),
  })
  .refine((v) => v.sampai >= v.dari, {
    message: 'Seri akhir tidak boleh lebih kecil dari seri awal',
    path: ['sampai'],
  })
  .refine((v) => v.sampai - v.dari + 1 <= KARTU_PER_CETAK_MAKS, {
    message: `Sekali cetak paling banyak ${KARTU_PER_CETAK_MAKS} kartu`,
    path: ['sampai'],
  });
export type CetakKanbanInput = z.infer<typeof cetakKanbanSchema>;

/** Part yang akan dicetak kartunya, beserta yang tercetak di kartunya. */
export interface PartKartu {
  id: number;
  partNumber: string;
  partName: string;
  backNumber: string | null;
  /** Isi satu box, dari master part. Bukan diketik OMD. */
  qtyPerBox: number | null;
  productionVersion: string | null;
  plantCode: string | null;
  lineName: string | null;
  lineCode: string | null;
}

export interface PratinjauCetakKanban {
  part: PartKartu;
  dari: number;
  sampai: number;
  total: number;
  /** Kartu dalam rentang ini yang barisnya sudah ada. */
  sudahAda: number;
  akanDibuat: number;
  lembar: number;
  /**
   * Hal yang menghalangi pencetakan. Kosong berarti boleh dicetak.
   *
   * Dipisah dari `peringatan` karena tindakannya berbeda: yang di sini harus
   * dibereskan dulu di master, yang di sana boleh dilanjutkan.
   */
  penghalang: string[];
  peringatan: string[];
}

export interface HasilCetakKanban {
  dibuat: number;
  sudahAda: number;
  total: number;
}

/** Satu kartu siap cetak. */
export interface KartuKanbanCetak {
  kanbanId: number;
  serialNumber: string;
  partNumber: string;
  partName: string;
  backNumber: string | null;
  lineName: string | null;
  qtyPerBox: number;
  plantCode: string | null;
  /**
   * Isi QR: `AVK1|PART|BACK|SERI|QTY`, disusun `susunKodeKartuKanban` dan
   * dibaca `bacaKanban` lewat ATURAN_KANBAN_AVICENNA.
   */
  kode: string;
  /**
   * Isi yang tercetak sebagai TEKS di bawah QR — bentuk ringkas `BACK|SERI`.
   *
   * Sengaja berbeda dari `kode`: baris itu untuk diketik orang saat QR-nya
   * tergores, dan isi QR yang lengkap tidak akan diketik siapa pun di lantai.
   * Keduanya menuju kartu yang sama.
   */
  kodeKetik: string;
}
