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
  /**
   * Dua digit pertama pada barcode produksi.
   *
   * Barcode itu TIDAK memuat nomor part sama sekali — kode inilah yang
   * menerjemahkannya, lewat TM_PROGRAM_NUMBER. Penerjemahannya di lapisan
   * service karena butuh database; di sini cukup diambil.
   */
  programCode?: string;
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
/**
 * Barcode produksi 15 karakter berkode program.
 *
 * Bentuk yang benar-benar beredar di lantai: 2 digit program number, lalu 13
 * karakter yang membentuk identitas unitnya. Contoh nyata dari data lama:
 * `12051421B22A276`, `17041521B24A121`.
 *
 * ── Kenapa sisanya tidak diurai ─────────────────────────────────────────────
 *
 * Sistem lama hanya mengambil dua digit pertama dan menyimpan SELURUH barcode
 * sebagai identitas unit. Sisanya tidak pernah dibaca. Menguraikannya menjadi
 * tanggal dan nomor urut berarti menebak arti yang tidak pernah dipakai — dan
 * tebakan itu akan menolak barcode sah yang bentuknya sedikit berbeda.
 */
export const ATURAN_PROGRAM_15: AturanBarcode = {
  nama: 'PROGRAM_15',
  keterangan: '15 karakter; 2 digit pertama program number, seluruhnya nomor seri unit',
  cocok: (raw) => /^[0-9]{2}[0-9A-Za-z]{13}$/.test(raw),
  baca: (raw) => ({
    raw,
    programCode: raw.slice(0, 2),
    serialNumber: raw,
  }),
};

export const DAFTAR_ATURAN: AturanBarcode[] = [
  ATURAN_BERPEMISAH,
  ATURAN_PROGRAM_15,
  ATURAN_SERIAL_SAJA,
];

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

/* ────────────────────────────────────────────────────────────────────────────
 * BARCODE KANBAN
 *
 * Dibaca terpisah dari barcode part: isinya berbeda (back number + nomor seri
 * kartu), dan formatnya pun berbeda-beda per customer.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ParsedKanban {
  raw: string;
  /** Back number part yang boleh ditempel kartu ini. */
  backNumber?: string;
  /** Nomor seri tercetak di kartu. */
  serialNumber?: string;
}

export interface HasilBacaKanban extends ParsedKanban {
  aturan: string;
}

export interface AturanKanban {
  nama: string;
  keterangan: string;
  berlaku?(ctx: KonteksBarcode): boolean;
  cocok(raw: string): boolean;
  baca(raw: string): ParsedKanban;
}

export class KanbanTidakTerbaca extends Error {
  constructor(readonly raw: string) {
    super(`Format barcode kanban tidak dikenali: "${raw}"`);
    this.name = 'KanbanTidakTerbaca';
  }
}

/**
 * Format berspasi milik sistem lama.
 *
 * Barcode dipecah menurut spasi, lalu back number dan seri diambil dari dua
 * kolom yang bersebelahan. Letak kolomnya TIDAK tetap: sistem lama memeriksa
 * `$arr[8] == '0'` lalu `$arr[9] == '0'` untuk menebak pergeserannya, karena
 * sebagian kartu punya kolom kosong berisi "0" di depan.
 *
 * Perilaku itu dipertahankan apa adanya. Memperbaikinya berarti sebagian kartu
 * yang selama ini terbaca menjadi tidak terbaca, dan itu menghentikan lini —
 * bukan sesuatu yang boleh diubah tanpa memeriksa kartu yang benar-benar
 * beredar.
 *
 * Seri adalah EMPAT KARAKTER TERAKHIR dari kolom sesudah back number.
 */
export const ATURAN_KANBAN_BERSPASI: AturanKanban = {
  nama: 'KANBAN_BERSPASI',
  keterangan: 'dipisah spasi; back number dan seri diambil dari kolom ke-8/9/10',
  cocok: (raw) => raw.trim().split(/ +/).length >= 10,
  baca(raw) {
    const a = raw.trim().split(/ +/);
    // Urutan pemeriksaan mengikuti sistem lama; jangan dibalik.
    const [iBack, iSeri] = a[8] === '0' ? [9, 10] : a[9] === '0' ? [10, 11] : [8, 9];
    const back = a[iBack]?.trim();
    const kolomSeri = a[iSeri]?.trim();
    return {
      raw,
      backNumber: back || undefined,
      serialNumber: kolomSeri ? kolomSeri.slice(-4) : undefined,
    };
  },
};

/**
 * Format ringkas: BACKNUMBER|SERIAL.
 *
 * Dipakai kartu cetakan baru. Ditaruh lebih dulu karena bentuknya paling khas.
 */
export const ATURAN_KANBAN_BERPEMISAH: AturanKanban = {
  nama: 'KANBAN_BERPEMISAH',
  keterangan: 'BACKNUMBER|SERIAL',
  cocok: (raw) => raw.includes('|'),
  baca(raw) {
    const [backNumber, serialNumber] = raw.split('|');
    return {
      raw,
      backNumber: backNumber?.trim() || undefined,
      serialNumber: serialNumber?.trim() || undefined,
    };
  },
};

/**
 * Daftar aturan kanban, berurutan.
 *
 * TIDAK ada aturan penadah di sini — berbeda dari barcode part. Kanban yang
 * tidak terbaca harus ditolak: menempelkan kartu yang salah baca berarti
 * barangnya dikirim atas nama kanban lain, dan itu tidak bisa dilacak balik.
 */
export const DAFTAR_ATURAN_KANBAN: AturanKanban[] = [
  ATURAN_KANBAN_BERPEMISAH,
  ATURAN_KANBAN_BERSPASI,
];

export function bacaKanban(raw: string, ctx: KonteksBarcode = {}): HasilBacaKanban {
  const bersih = raw.trim();
  if (bersih.length === 0) throw new Error('Barcode kanban kosong');

  for (const aturan of DAFTAR_ATURAN_KANBAN) {
    if (aturan.berlaku && !aturan.berlaku(ctx)) continue;
    if (!aturan.cocok(bersih)) continue;
    const hasil = aturan.baca(bersih);
    // Aturan yang cocok tetapi tidak menghasilkan seri sama saja dengan tidak
    // terbaca — jangan diteruskan sebagai hasil setengah jadi.
    if (!hasil.serialNumber) continue;
    return { ...hasil, aturan: aturan.nama };
  }

  throw new KanbanTidakTerbaca(bersih);
}
