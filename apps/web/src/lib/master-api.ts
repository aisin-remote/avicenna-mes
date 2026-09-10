import 'server-only';
import { apiFetch } from './api';
import type { MasterEntity } from '@avicenna/contracts';

/**
 * Akses data master lewat API.
 *
 * CATATAN ARSITEKTUR — ini pengecualian yang disengaja dari aturan
 * "baca langsung dari database di Server Component".
 *
 * Logika daftar master (pencarian, urutan, paginasi) bersifat generik dan sudah
 * ada satu kali di MasterService milik API. Menyalinnya ke sini berarti dua
 * tempat yang harus diubah setiap kali ada entitas atau kolom baru. Data master
 * juga kecil, jadi satu hop lokal tidak terasa.
 *
 * Halaman report yang berat tetap membaca database langsung — lihat queries.ts.
 */

export interface MasterListResult {
  data: Array<Record<string, unknown> & { id: number }>;
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export interface RefOption {
  value: number;
  /** Label lengkap "KODE — Nama", dipakai di dropdown. */
  label: string;
  /** Label ringkas (kode saja), dipakai di sel tabel. */
  short: string;
}

export function listMaster(
  entity: MasterEntity,
  params: { page: number; perPage: number; q?: string; sort?: string; dir?: 'asc' | 'desc' },
): Promise<MasterListResult> {
  const qs = new URLSearchParams({
    page: String(params.page),
    perPage: String(params.perPage),
    dir: params.dir ?? 'asc',
  });
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  return apiFetch<MasterListResult>(`/master/${entity}?${qs.toString()}`);
}

export function getMasterOptions(entity: MasterEntity): Promise<RefOption[]> {
  return apiFetch<RefOption[]>(`/master/${entity}/options`);
}

export function getMasterRow(entity: MasterEntity, id: number) {
  return apiFetch<Record<string, unknown> & { id: number }>(`/master/${entity}/${id}`);
}
