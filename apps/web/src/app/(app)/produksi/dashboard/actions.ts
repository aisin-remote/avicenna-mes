'use server';

import type { DashboardProduksi } from '@avicenna/contracts';
import { getDashboardProduksi } from '@/lib/dashboard-api';

/**
 * Menyegarkan papan lini tanpa memuat ulang halaman.
 *
 * Lewat server action, bukan fetch dari browser: token sesi ada di cookie
 * httpOnly yang sengaja tidak bisa dibaca skrip halaman.
 *
 * Kegagalan mengembalikan null, bukan melempar — papan yang menyala sepanjang
 * shift tidak boleh menjadi layar galat hanya karena satu penyegaran meleset;
 * angka yang tertinggal dua puluh detik jauh lebih berguna.
 */
export async function muatPapanLiniAction(plant?: string): Promise<DashboardProduksi | null> {
  try {
    return await getDashboardProduksi(plant);
  } catch {
    return null;
  }
}
