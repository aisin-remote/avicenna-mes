import { cache } from 'react';
import { katalogProses, type JenisProses, type KatalogProses } from '@avicenna/contracts';
import { apiFetch } from './api';

/**
 * Katalog jenis proses untuk komponen server.
 *
 * Daftarnya hidup di master `TM_PROCESS_TYPE`, jadi layar tidak boleh lagi
 * mengimpor daftar tetap dari @avicenna/contracts — yang tersisa di sana hanya
 * bentuknya.
 *
 * Dibungkus `cache()` milik React: beberapa komponen dalam SATU permintaan
 * memakai katalog yang sama (judul kolom, label baris, penyaring), dan tanpa
 * ini masing-masing memanggil API sendiri-sendiri. Cache-nya per permintaan,
 * jadi perubahan master langsung terlihat pada muat berikutnya — bukan
 * "sebentar lagi".
 */
export const katalogProsesServer = cache(async (): Promise<KatalogProses> => {
  const { data } = await apiFetch<{ data: JenisProses[] }>('/routing/process-types');
  return katalogProses(data);
});
