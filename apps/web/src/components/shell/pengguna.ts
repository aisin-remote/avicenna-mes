/**
 * Identitas yang ditampilkan di bilah atas dan sidebar.
 *
 * Dikumpulkan di server dari /me (database), dengan isi token sebagai cadangan
 * saat API tidak menjawab. Bentuknya dipisah ke berkas sendiri karena dipakai
 * tiga komponen sekaligus — mengetiknya ulang di masing-masing berarti tiga
 * tempat yang harus diubah setiap kali ada kolom baru.
 */
export interface PenggunaShell {
  nama: string;
  npk: string;
  /** Nama yang dibaca orang, mis. "Casting Lasman". Jatuh ke nama teknis bila belum diisi. */
  role: string | null;
  /** SCANNING / VIEW / ADMIN. Kosong bila API tidak menjawab. */
  jabatan: 'SCANNING' | 'VIEW' | 'ADMIN' | null;
  lingkupProses: string | null;
  pabrik: string | null;
}

export const LABEL_JABATAN: Record<NonNullable<PenggunaShell['jabatan']>, string> = {
  SCANNING: 'Scanning di lini',
  VIEW: 'Cek data',
  ADMIN: 'Administrator',
};
