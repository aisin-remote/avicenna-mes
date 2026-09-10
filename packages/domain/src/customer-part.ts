/**
 * Konversi nomor part customer menjadi format ber-dash.
 *
 * Diambil dari App\Support\ConvertsCustomerPartNumber milik bella, yang di
 * sana menyatukan logika yang sebelumnya tersebar di PullingController dan
 * LoadingListController.
 *
 * PERBEDAAN PENTING DARI ASLINYA: bella memilih aturan berdasarkan ID customer
 * yang di-hardcode (14 dan 22 untuk SUZUKI, 6/23/24/28 untuk MMKI). ID itu
 * tidak akan sama setelah data dipindah ke sistem baru, dan aturan yang
 * bergantung pada nomor baris database akan diam-diam salah begitu urutannya
 * berubah. Di sini formatnya menjadi atribut customer di master data, sehingga
 * penambahan customer baru tidak menuntut perubahan kode.
 */

export const PART_NUMBER_FORMATS = ['TMMIN', 'SUZUKI', 'MMKI', 'TBINA', 'NONE'] as const;
export type PartNumberFormat = (typeof PART_NUMBER_FORMATS)[number];

/** Menyisipkan tanda hubung pada posisi tertentu. */
function insertDash(value: string, at: number): string {
  return `${value.slice(0, at)}-${value.slice(at)}`;
}

/**
 * Mengubah nomor part dari barcode customer menjadi format yang tersimpan di
 * master.
 *
 * Aturannya ditentukan panjang kode, lalu format customer-nya:
 *
 *   12 karakter  TMMIN   XXXXX-XXXXX-XX, atau XXXXX-XXXXX bila 2 digit
 *                        terakhirnya "00"
 *   10 karakter  MMKI    dipakai apa adanya
 *                lainnya tanda hubung disisipkan setelah karakter ke-5
 *   13 karakter  SUZUKI  XXXXX-XXXXX-XXX
 *   selain itu           dipakai apa adanya
 *
 * CATATAN — ANOMALI YANG DIPERTAHANKAN:
 * Pada kode 13 karakter, bella membandingkan dua karakter terakhir dengan
 * "000" yang panjangnya tiga. Perbandingan itu tidak pernah sama, sehingga
 * cabang keduanya tidak pernah dijalankan sama sekali. Perilaku itu
 * dipertahankan apa adanya: memperbaikinya akan menghasilkan nomor part yang
 * berbeda dari sistem yang sedang berjalan, dan pencocokan loading list akan
 * gagal tanpa ada yang menduga sebabnya. PERLU DIKONFIRMASI ke tim apakah
 * cabang itu memang tidak diperlukan.
 */
export function convertCustomerPartNumber(
  customerPart: string,
  format: PartNumberFormat = 'NONE',
): string {
  const code = customerPart.trim();
  const len = code.length;

  if (len === 12) {
    const lastTwo = code.slice(-2);
    if (lastTwo !== '00') {
      return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(-2)}`;
    }
    // Sisipkan tanda hubung setelah karakter ke-5, lalu buang dua digit akhir.
    return insertDash(code, 5).slice(0, -2);
  }

  if (len === 10) {
    if (format === 'MMKI') return code;
    return insertDash(code, 5);
  }

  if (len === 13) {
    // Cabang ini SELALU diambil — lihat catatan anomali di atas.
    return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(-3)}`;
  }

  return code;
}
