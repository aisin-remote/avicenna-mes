import type { ProcessType } from '@avicenna/contracts';

/**
 * Aturan urutan proses produksi.
 *
 * ── Rute melekat pada PART, bukan pada jenis prosesnya ──────────────────────
 *
 * Versi sebelumnya memakai satu rantai global (CASTING -> MACHINING ->
 * ASSEMBLING) yang berlaku untuk semua part. Rute sebenarnya di AIIA berbeda-
 * beda per part:
 *
 *   TCC A   Melting -> Casting -> Machining -> Assembling(Unit) -> Delivery
 *   OPN A   Melting -> Casting -> Machining -> Delivery
 *   CSH A   Melting -> Casting -> Delivery
 *   HANDLE  Injection -> Painting -> Assembling(Body) -> Delivery
 *   GARNISH Injection -> Assembling(Body) -> Delivery
 *
 * Satu rantai global tidak bisa menyatakan bahwa proses sebelum Delivery adalah
 * Casting untuk CSH A, Machining untuk OPN A, dan Assembling untuk TCC A.
 * Karena itu urutan sekarang dibaca dari rute part di TM_PROCESS_PARTS, dan
 * fungsi-fungsi di sini bekerja atas rute yang diberikan — bukan atas daftar
 * yang ditanam di kode.
 *
 * Bahkan dua part dalam satu proyek bisa berbeda: pada proyek 660A, GARNISH
 * tidak melewati Painting sedangkan HANDLE melewatinya.
 */

/** Satu langkah dalam rute sebuah part. */
export interface LangkahRute {
  processType: ProcessType;
  /** Urutan di dalam rute part ini. Bukan urutan global. */
  seqNo: number;
}

/**
 * Proses yang wajib sudah dilalui sebelum `proses` boleh menerima scan.
 *
 * Yang dicari adalah langkah dengan seqNo TERBESAR yang masih lebih kecil dari
 * seqNo proses sekarang — di dalam rute part itu sendiri. Bukan urutan global,
 * dan bukan sekadar "satu nomor sebelumnya": nomor urut boleh berlompatan
 * (10, 20, 30) supaya langkah baru bisa disisipkan tanpa menomori ulang
 * seluruh rute.
 *
 * `undefined` berarti tidak ada syarat — proses ini yang pertama dalam rutenya,
 * atau prosesnya memang tidak ada dalam rute part tersebut.
 */
export function prosesSebelumnya(
  rute: readonly LangkahRute[],
  proses: ProcessType,
): ProcessType | undefined {
  const sekarang = rute.find((r) => r.processType === proses);
  if (!sekarang) return undefined;

  let terdekat: LangkahRute | undefined;
  for (const langkah of rute) {
    if (langkah.seqNo >= sekarang.seqNo) continue;
    if (!terdekat || langkah.seqNo > terdekat.seqNo) terdekat = langkah;
  }
  return terdekat?.processType;
}

/**
 * Apakah proses ini memang bagian dari rute part tersebut.
 *
 * Scan di proses yang tidak ada dalam rute adalah kekeliruan yang nyata —
 * part dibawa ke lini yang salah. Tanpa pemeriksaan ini, part CSH yang tidak
 * pernah melewati machining akan diterima di lini machining dan menambah stok
 * barang jadi yang tidak pernah dibuat.
 */
export function prosesAdaDiRute(rute: readonly LangkahRute[], proses: ProcessType): boolean {
  return rute.some((r) => r.processType === proses);
}

/** Rute diurutkan menurut seqNo — untuk ditampilkan di layar. */
export function ruteTerurut(rute: readonly LangkahRute[]): LangkahRute[] {
  return [...rute].sort((a, b) => a.seqNo - b.seqNo);
}

export type ScanRejectReason =
  | 'DUPLICATE'
  | 'UNKNOWN_PROGRAM'
  | 'MISSING_PREVIOUS_PROCESS'
  | 'LINE_NOT_FOUND'
  | 'PLANT_UNKNOWN'
  | 'BARCODE_UNREADABLE'
  | 'PART_NOT_RECOGNIZED'
  | 'PROCESS_NOT_IN_ROUTE';

/** Pesan untuk operator. Ditulis sebagai instruksi, bukan sekadar keterangan. */
export const REJECT_MESSAGES: Record<ScanRejectReason, string> = {
  DUPLICATE: 'Barcode ini sudah pernah discan. Ambil part berikutnya.',
  UNKNOWN_PROGRAM: 'Kode program tidak dikenal. Laporkan ke leader.',
  MISSING_PREVIOUS_PROCESS: 'Part belum discan di proses sebelumnya. Jangan diproses.',
  LINE_NOT_FOUND: 'Line tidak dikenal. Periksa barcode line.',
  PLANT_UNKNOWN: 'Pabrik tidak bisa ditentukan dari scan ini.',
  BARCODE_UNREADABLE: 'Barcode tidak terbaca. Coba scan ulang, lalu laporkan ke leader.',
  /*
   * Sebelumnya keadaan ini TIDAK ditolak: scan tetap tercatat, tetapi karena
   * part-nya tidak dikenali tidak ada mutasi stok yang ditulis. Operator
   * melihat "berhasil", stoknya tidak pernah bergerak, dan selisihnya baru
   * ketahuan saat stock opname.
   */
  PART_NOT_RECOGNIZED: 'Part tidak dikenali dari barcode ini. JANGAN diproses — laporkan ke leader.',
  PROCESS_NOT_IN_ROUTE: 'Part ini tidak melewati proses di lini ini. Periksa part-nya.',
};

/**
 * Mengambil kode program dari barcode.
 *
 * DUA KARAKTER PERTAMA. Ini terbaca dari `substr($number, 0, 2)` yang muncul
 * identik di ketiga fungsi scan avicenna, lalu dicocokkan ke tabel
 * avi_trace_program_number untuk mendapatkan produk dan back number.
 */
export function programCodeOf(barcode: string): string | undefined {
  const trimmed = barcode.trim();
  if (trimmed.length < 2) return undefined;
  return trimmed.slice(0, 2);
}
