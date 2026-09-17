import type { ProcessType } from '@avicenna/contracts';
import type { PartNumberFormat } from './customer-part';

/**
 * Pembacaan barcode dengan BEBERAPA aturan sekaligus.
 *
 * ── Kenapa bukan satu fungsi ────────────────────────────────────────────────
 *
 * Format barcode di lapangan berbeda-beda: tiap customer punya penomoran
 * sendiri, dan tiap proses mencetak label yang berbeda pula. Satu fungsi
 * dengan rentetan `if` akan tumbuh jadi tidak bisa ditest, dan yang lebih
 * buruk — menambah format baru berarti menyentuh kode yang sudah dipakai
 * proses lain.
 *
 * Di sini tiap format berdiri sebagai satu aturan: punya nama, tahu kapan
 * dirinya berlaku, dan bisa ditest sendiri. Menambah format = menambah satu
 * objek ke DAFTAR_ATURAN beserta test-nya, tanpa menyentuh yang lain.
 *
 * ── Kenapa aturan yang cocok ikut dicatat ───────────────────────────────────
 *
 * Hasil baca membawa nama aturannya. Saat sebuah barcode terbaca keliru —
 * part-nya salah, qty-nya aneh — pertanyaan pertama selalu "dibaca pakai
 * aturan mana". Tanpa dicatat, jawabannya hanya bisa ditebak dengan menjalankan
 * ulang barcode-nya, dan barcode yang bermasalah biasanya sudah tidak ada lagi.
 */

export interface ParsedBarcode {
  raw: string;
  partNumber?: string;
  backNumber?: string;
  serialNumber?: string;
  qty?: number;
}

/** Hasil baca beserta aturan yang dipakai membacanya. */
export interface HasilBacaBarcode extends ParsedBarcode {
  /** Nama aturan yang cocok. Disimpan ke meta scan untuk penelusuran. */
  aturan: string;
}

/**
 * Keadaan saat barcode dibaca, dipakai memilih aturan.
 *
 * `processType` diketahui dari line tempat scan terjadi. `customerFormat` hanya
 * diketahui pada scan pengiriman dan pulling, tempat customer-nya sudah pasti
 * dari dokumennya — pada scan produksi customer belum diketahui, justru
 * part-nya yang sedang dicari.
 */
export interface KonteksBarcode {
  processType?: ProcessType | null;
  customerFormat?: PartNumberFormat | null;
}

export interface AturanBarcode {
  /** Nama singkat, ikut tercatat di hasil baca. */
  nama: string;
  keterangan: string;
  /**
   * Apakah aturan ini berlaku pada keadaan sekarang.
   *
   * Kosong berarti berlaku di mana saja. Dipakai membatasi aturan yang hanya
   * benar untuk satu proses atau satu customer.
   */
  berlaku?(ctx: KonteksBarcode): boolean;
  /** Apakah bentuk barcode-nya cocok dengan aturan ini. */
  cocok(raw: string): boolean;
  /** Membaca isinya. Hanya dipanggil bila `cocok` bernilai true. */
  baca(raw: string): ParsedBarcode;
}

/** Barcode yang tidak cocok dengan satu aturan pun. */
export class BarcodeTidakDikenali extends Error {
  constructor(readonly raw: string) {
    super(`Format barcode tidak dikenali: "${raw}"`);
    this.name = 'BarcodeTidakDikenali';
  }
}

/**
 * Format berpemisah: PARTNUMBER|BACKNUMBER|SERIAL|QTY
 *
 * Ini format yang dipakai sejak awal sistem ini dan sudah punya test. Tetap
 * ditaruh paling depan karena bentuknya paling khas — adanya "|" membuatnya
 * tidak mungkin tertukar dengan format lain.
 */
export const ATURAN_BERPEMISAH: AturanBarcode = {
  nama: 'BERPEMISAH',
  keterangan: 'PARTNUMBER|BACKNUMBER|SERIAL|QTY',
  cocok: (raw) => raw.includes('|'),
  baca(raw) {
    const [partNumber, backNumber, serialNumber, qtyRaw] = raw.split('|');
    const qty = qtyRaw ? Number.parseInt(qtyRaw, 10) : undefined;
    return {
      raw,
      partNumber: partNumber?.trim() || undefined,
      backNumber: backNumber?.trim() || undefined,
      serialNumber: serialNumber?.trim() || undefined,
      qty: qty !== undefined && Number.isFinite(qty) && qty > 0 ? qty : undefined,
    };
  },
};

/**
 * Nomor seri polos, tanpa identitas part.
 *
 * SENGAJA JADI ATURAN TERSENDIRI, bukan perilaku diam-diam saat aturan lain
 * gagal. Sebelumnya barcode yang tidak dikenali jatuh ke sini tanpa jejak,
 * sehingga scan produksi tercatat tanpa part — dan karena tanpa part, tidak ada
 * mutasi stok yang ditulis. Operator melihat "berhasil", stoknya tidak pernah
 * bergerak, dan tidak ada yang menyadarinya sampai stock opname.
 *
 * Sekarang hasilnya bernama. Scan produksi yang terbaca dengan aturan ini akan
 * DITOLAK di lapisan service, karena produksi wajib tahu part-nya. Scan
 * inspeksi dan stock opname yang memang bekerja per nomor seri tetap bisa.
 */
export const ATURAN_SERIAL_SAJA: AturanBarcode = {
  nama: 'SERIAL_SAJA',
  keterangan: 'nomor seri polos, tanpa identitas part',
  cocok: () => true,
  baca: (raw) => ({ raw, serialNumber: raw }),
};

/**
 * Daftar aturan, BERURUTAN — yang pertama cocok dipakai.
 *
 * Urutannya penting: yang paling khas di depan, yang paling longgar di
 * belakang. ATURAN_SERIAL_SAJA cocok dengan apa pun, jadi ia wajib jadi yang
 * terakhir; menaruhnya lebih awal membuat seluruh aturan sesudahnya mati.
 *
 * ── Menambah format baru ────────────────────────────────────────────────────
 *
 * Tambahkan satu objek DI ATAS ATURAN_SERIAL_SAJA, lengkapi `berlaku` bila
 * hanya untuk proses atau customer tertentu, lalu tulis test-nya di
 * barcode.test.ts. Tidak ada berkas lain yang perlu disentuh.
 */
export const DAFTAR_ATURAN: AturanBarcode[] = [ATURAN_BERPEMISAH, ATURAN_SERIAL_SAJA];

/**
 * Membaca barcode memakai aturan pertama yang cocok.
 *
 * Melempar BarcodeTidakDikenali bila tidak ada yang cocok. Selama
 * ATURAN_SERIAL_SAJA masih ada di daftar, itu tidak akan terjadi — tetapi
 * pemeriksaannya tetap ada supaya menghapus aturan itu nanti menghasilkan
 * penolakan yang jelas, bukan `undefined` yang menjalar diam-diam.
 */
export function bacaBarcode(raw: string, ctx: KonteksBarcode = {}): HasilBacaBarcode {
  const bersih = raw.trim();
  if (bersih.length === 0) throw new Error('Barcode kosong');

  for (const aturan of DAFTAR_ATURAN) {
    if (aturan.berlaku && !aturan.berlaku(ctx)) continue;
    if (!aturan.cocok(bersih)) continue;
    return { ...aturan.baca(bersih), aturan: aturan.nama };
  }

  throw new BarcodeTidakDikenali(bersih);
}

/** Apakah hasil baca cukup untuk menentukan part. Produksi mewajibkan ini. */
export function punyaIdentitasPart(hasil: ParsedBarcode): boolean {
  return Boolean(hasil.partNumber || hasil.backNumber);
}

/** Daftar aturan yang berlaku pada sebuah keadaan — untuk layar diagnostik. */
export function aturanBerlaku(ctx: KonteksBarcode = {}): AturanBarcode[] {
  return DAFTAR_ATURAN.filter((a) => !a.berlaku || a.berlaku(ctx));
}
