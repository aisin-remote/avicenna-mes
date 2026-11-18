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
 * Delapan kartu per lembar A4: dua kolom × empat baris.
 *
 * Kartunya 105 × 74,25 mm: setengah lebar A4, seperempat tingginya (297 ÷ 4).
 * Satu lembar dipotong sekali tegak dan tiga kali mendatar — semuanya lurus
 * dari tepi ke tepi, jadi setumpuk lembar tetap bisa dipotong sekaligus.
 */
export const KARTU_PER_LEMBAR = 8;

/** Kartu per baris di lembar A4. */
export const KARTU_PER_BARIS = 2;

/** Lebar kartu dalam milimeter — setengah lebar A4. */
export const KARTU_LEBAR_MM = 105;

/**
 * Tinggi kartu dalam milimeter.
 *
 * 74,2 dan bukan 74,25: empat kali 74,25 tepat 297 mm, yaitu seluruh tinggi
 * A4, dan pembulatan sepersekian milimeter di browser akan mendorong baris
 * keempat ke lembar berikutnya. Selisih 0,05 mm per kartu tidak terlihat mata
 * maupun penggaris, sedangkan satu lembar yang isinya tiga baris terlihat
 * seketika.
 */
export const KARTU_TINGGI_MM = 74.2;

/**
 * Seri terbesar yang boleh dicetak.
 *
 * Isi QR kartu mengikuti format AIGSYS sistem lama, dan kolom serinya hanya
 * empat digit (`susunKanbanAigsys` di @avicenna/domain). Seri 10000 tidak
 * muat tanpa menggeser kolom lain, jadi ditolak di formulir, bukan di printer.
 */
export const SERI_KANBAN_MAKS = 9999;

export const cetakKanbanSchema = z
  .object({
    partId: z.number().int().positive(),
    dari: z.number().int().min(1).max(SERI_KANBAN_MAKS),
    sampai: z
      .number()
      .int()
      .min(1)
      .max(SERI_KANBAN_MAKS, `Seri paling besar ${SERI_KANBAN_MAKS} — kolom seri di kartu empat digit`),
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
  /** Work center SAP lini yang memproduksi — tercetak di QR sebagai `JE` + kode ini. */
  lineWorkCenter: string | null;
}

export interface PratinjauCetakKanban {
  part: PartKartu;
  /** SLOC tujuan hasil lini ini — tercetak di QR. Kosong menghalangi pencetakan. */
  slocTujuan: string | null;
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
  lineWorkCenter: string;
  slocTujuan: string;
  qtyPerBox: number;
  plantCode: string | null;
  /**
   * Isi QR: format AIGSYS 230 karakter sistem lama, disusun
   * `susunKanbanAigsys` dan dibaca `bacaKanban` lewat ATURAN_KANBAN_AIGSYS /
   * ATURAN_KANBAN_BERSPASI. Spasi di belakangnya bagian dari isinya.
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
