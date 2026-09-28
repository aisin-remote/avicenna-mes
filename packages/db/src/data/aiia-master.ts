/**
 * MASTER NYATA AIIA — diambil dari `avi_trace_program_number` di database
 * avicenna lama (dump avicenna.sql), BUKAN diketik ulang.
 *
 * Sengaja berupa data yang bisa dibaca dan di-review di dalam repo, bukan
 * skrip yang membaca dump langsung: dump itu ada di laptop satu orang,
 * sedangkan berkas ini ikut ke mana pun repo dibawa dan setiap perubahannya
 * terlihat di diff.
 *
 * ── Yang TIDAK ada di sini: rute proses ─────────────────────────────────────
 *
 * Sistem lama tidak menyimpan rute per part sama sekali — urutan prosesnya
 * tertanam di kode masing-masing controller. Menebaknya di sini berarti hasil
 * produksi tercatat di proses yang salah, dan itu tidak terlihat dari layar
 * mana pun sampai laporan dibandingkan berbulan kemudian.
 *
 * Rute diisi orang yang tahu, lewat layar matriks di /master/part-processes.
 */

export interface ProgramNumberAiia {
  /** Dua digit pertama pada barcode produksi. */
  code: string;
  /** Model — inilah yang membedakan dua kode pada part yang sama. */
  product: string;
  partNumber: string;
  backNumber: string;
  partName: string;
  customer: string;
  isAssy: boolean;
}

/**
 * Satu part boleh punya BEBERAPA program number.
 *
 * Contoh nyata di data ini: 243202-10630 dipakai kode 10 (OPN 889F), 15
 * (OPN D81F), dan 18 (OPN 889F PULSE). Itu sebabnya kode program disimpan di
 * tabel tersendiri, bukan sebagai kolom di part.
 *
 * PERHATIAN: kode '13' muncul DUA KALI di data lama, dengan back number CI17
 * dan CI18. Keduanya dipertahankan apa adanya di sini supaya tidak ada yang
 * hilang diam-diam; skrip impor yang memutuskan mana yang dipakai, dan ia
 * melaporkannya dengan keras.
 */
export const PROGRAM_NUMBERS_AIIA: ProgramNumberAiia[] = [
  { code: '01', product: 'TCC D98E', partNumber: '212110-34010', backNumber: 'CI11', partName: 'TCC ASSY', customer: 'TMMIN', isAssy: false },
  { code: '02', product: 'TCC 889F', partNumber: '212110-34040', backNumber: 'CI12', partName: 'TCC ASSY', customer: 'TMMIN', isAssy: false },
  { code: '03', product: 'TCC D72F', partNumber: '212110-34140', backNumber: 'CI13', partName: 'TCC ASSY', customer: 'TMMIN', isAssy: false },
  { code: '04', product: 'TCC D18E', partNumber: '212110-34270', backNumber: 'CI14', partName: 'TCC ASSY', customer: 'TMMIN', isAssy: false },
  { code: '05', product: 'TCC D05E', partNumber: '212110-34300', backNumber: 'CI15', partName: 'TCC ASSY', customer: 'TMMIN', isAssy: false },
  { code: '06', product: 'TCC 4A91', partNumber: '212130-21250', backNumber: 'CI16', partName: 'TCC ASSY', customer: 'TMMIN', isAssy: false },
  { code: '07', product: 'CSH D98E', partNumber: '243131-10260', backNumber: 'DI01', partName: 'CAME S HOUSING', customer: 'TMMIN', isAssy: false },
  { code: '08', product: 'CSH D05E', partNumber: '243131-10490', backNumber: 'DI02', partName: 'CAME S HOUSING', customer: 'TMMIN', isAssy: false },
  { code: '10', product: 'OPN 889F', partNumber: '243202-10630', backNumber: 'EI11', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '11', product: 'OPN 922F', partNumber: '243202-10680', backNumber: 'EI12', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '12', product: 'OPN D72F', partNumber: '243202-10710', backNumber: 'EI13', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '13', product: 'TCC D41E', partNumber: '212110-34340', backNumber: 'CI17', partName: 'CASE ASSY, FR W/WATER PUMP&OIL PUMP', customer: 'TMMIN', isAssy: false },
  { code: '13', product: 'TCC D41E', partNumber: '212110-34340', backNumber: 'CI18', partName: 'CASE ASSY, FR W/WATER PUMP&OIL PUMP', customer: 'TMMIN', isAssy: false },
  { code: '14', product: 'OPN D41E', partNumber: '243202-10750', backNumber: 'EI14', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '15', product: 'OPN D81F', partNumber: '243202-10630', backNumber: 'EI11', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '17', product: 'OPN D72F (PULSE)', partNumber: '243202-10710', backNumber: 'EI13', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '18', product: 'OPN 889F (PULSE)', partNumber: '243202-10630', backNumber: 'EI11', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
  { code: '19', product: 'OPN 922F (PULSE)', partNumber: '243202-10680', backNumber: 'EI12', partName: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN', isAssy: false },
];

/**
 * Part yang berbeda-beda, diturunkan dari daftar di atas.
 *
 * Kuncinya (part number + back number), BUKAN part number saja: 212110-34340
 * muncul dua kali dengan back number CI17 dan CI18 — dua barang berbeda yang
 * di sistem lama berbagi nomor part.
 */
export const PARTS_AIIA = [
  { partNumber: '243202-10630', backNumber: 'EI11', name: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN' },
  { partNumber: '243202-10680', backNumber: 'EI12', name: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN' },
  { partNumber: '212110-34010', backNumber: 'CI11', name: 'TCC ASSY', customer: 'TMMIN' },
  { partNumber: '212110-34040', backNumber: 'CI12', name: 'TCC ASSY', customer: 'TMMIN' },
  { partNumber: '212110-34140', backNumber: 'CI13', name: 'TCC ASSY', customer: 'TMMIN' },
  { partNumber: '212110-34270', backNumber: 'CI14', name: 'TCC ASSY', customer: 'TMMIN' },
  { partNumber: '243131-10260', backNumber: 'DI01', name: 'CAME S HOUSING', customer: 'TMMIN' },
  { partNumber: '243202-10710', backNumber: 'EI13', name: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN' },
  { partNumber: '243131-10490', backNumber: 'DI02', name: 'CAME S HOUSING', customer: 'TMMIN' },
  { partNumber: '212110-34300', backNumber: 'CI15', name: 'TCC ASSY', customer: 'TMMIN' },
  { partNumber: '212130-21250', backNumber: 'CI16', name: 'TCC ASSY', customer: 'TMMIN' },
  { partNumber: '243202-10750', backNumber: 'EI14', name: 'PAN SUB ASSY OIL NO.1', customer: 'TMMIN' },
  { partNumber: '212110-34340', backNumber: 'CI18', name: 'CASE ASSY, FR W/WATER PUMP&OIL PUMP', customer: 'TMMIN' },
  { partNumber: '212110-34340', backNumber: 'CI17', name: 'CASE ASSY, FR W/WATER PUMP&OIL PUMP', customer: 'TMMIN' },
] as const;
