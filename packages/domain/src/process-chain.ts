import type { ProcessType } from '@avicenna/contracts';

/**
 * Aturan urutan proses produksi.
 *
 * Didokumentasikan dari TraceScanController milik avicenna, bukan dikarang:
 *
 *   getAjaxmachining()  memeriksa avi_trace_casting lebih dulu dan menolak
 *                       dengan "notfound" bila barcode belum pernah discan
 *                       di casting.
 *   getAjaxcasting()    tidak memeriksa apa pun — casting proses pertama.
 *   getAjaxassembling() TIDAK memeriksa machining sama sekali.
 *
 * Ketiadaan pemeriksaan pada assembling sengaja dipertahankan apa adanya.
 * Bisa jadi itu memang benar (ada part yang melewati machining), bisa jadi
 * kelalaian yang tidak pernah ketahuan. Menambah aturan yang tidak ada di
 * sistem lama akan menolak scan yang selama ini diterima, dan itu menghentikan
 * produksi. PERLU DIKONFIRMASI ke tim sebelum diubah.
 */

/** Urutan proses di pabrik Avicenna. INJECTION berdiri sendiri (pabrik Bella). */
export const PROCESS_ORDER: readonly ProcessType[] = [
  'CASTING',
  'MACHINING',
  'ASSEMBLING',
] as const;

/**
 * Proses yang wajib sudah dilalui sebelum proses ini boleh menerima scan.
 * `undefined` berarti tidak ada syarat.
 */
export function requiredPreviousProcess(process: ProcessType): ProcessType | undefined {
  // Hanya MACHINING yang memeriksa, mengikuti perilaku sistem lama.
  if (process === 'MACHINING') return 'CASTING';
  return undefined;
}

export type ScanRejectReason =
  | 'DUPLICATE'
  | 'UNKNOWN_PROGRAM'
  | 'MISSING_PREVIOUS_PROCESS'
  | 'LINE_NOT_FOUND'
  | 'PLANT_UNKNOWN';

/** Pesan untuk operator. Ditulis sebagai instruksi, bukan sekadar keterangan. */
export const REJECT_MESSAGES: Record<ScanRejectReason, string> = {
  DUPLICATE: 'Barcode ini sudah pernah discan. Ambil part berikutnya.',
  UNKNOWN_PROGRAM: 'Kode program tidak dikenal. Laporkan ke leader.',
  MISSING_PREVIOUS_PROCESS: 'Part belum discan di proses sebelumnya. Jangan diproses.',
  LINE_NOT_FOUND: 'Line tidak dikenal. Periksa barcode line.',
  PLANT_UNKNOWN: 'Pabrik tidak bisa ditentukan dari scan ini.',
};

/**
 * Mengambil kode program dari barcode.
 *
 * DUA KARAKTER PERTAMA. Ini terbaca dari `substr($number, 0, 2)` yang muncul
 * identik di ketiga fungsi scan avicenna, lalu dicocokkan ke tabel
 * avi_trace_program_number untuk mendapatkan produk dan back number.
 *
 * Barcode yang lebih pendek dari dua karakter tidak mungkin sah.
 */
export function programCodeOf(barcode: string): string | undefined {
  const trimmed = barcode.trim();
  if (trimmed.length < 2) return undefined;
  return trimmed.slice(0, 2);
}

/**
 * Apakah strainer relevan untuk barcode ini.
 *
 * Di avicenna, machining hanya memakai strainer bila kode programnya "14";
 * untuk kode lain nilainya dipaksa 0. Angka "14" itu hardcode di sistem lama
 * dan tidak ada di tabel mana pun — sebaiknya nanti dipindah ke master part.
 */
export function strainerApplies(barcode: string, programCode = '14'): boolean {
  return programCodeOf(barcode) === programCode;
}
