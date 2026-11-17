import { cache } from 'react';
import {
  katalogProses,
  type GrupProses,
  type JenisProses,
  type KatalogProses,
} from '@avicenna/contracts';
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
  const { data, grup } = await apiFetch<{ data: JenisProses[]; grup?: GrupProses[] }>(
    '/routing/process-types',
  );
  // Grup dari master TM_PROCESS_GROUP — label dan urutannya ikut dari sana.
  return katalogProses(data, grup);
});
