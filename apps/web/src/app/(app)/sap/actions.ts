'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiRequestError } from '@/lib/api';

function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return 'Tidak bisa menghubungi server.';
}

/** Mengumpulkan sekarang juga, tanpa menunggu putaran berikutnya. */
export async function collectNowAction(): Promise<
  { dikumpulkan: number; ditahan: number; dilewati: number; dilepas: number } | { error: string }
> {
  try {
    const res = await apiFetch<{
      dikumpulkan: number;
      ditahan: number;
      dilewati: number;
      dilepas: number;
    }>('/sap/collect', { method: 'POST' });
    revalidatePath('/sap');
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function retryAction(ids: number[]): Promise<{ diulang: number } | { error: string }> {
  try {
    const res = await apiFetch<{ diulang: number }>('/sap/retry', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    revalidatePath('/sap');
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function simulateSapAction(
  id: number,
  outcome: 'CONFIRMED' | 'REJECTED' | 'PENDING',
): Promise<{ id: number; status: string; sapDocNumber: string | null } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; status: string; sapDocNumber: string | null }>(
      '/sap/simulate',
      { method: 'POST', body: JSON.stringify({ id, outcome }) },
    );
    revalidatePath('/sap');
    revalidatePath('/delivery');
    revalidatePath('/trace');
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function pullDeliveryNowAction(): Promise<
  | { dibaca: number; baru: number; diperbarui: number; dilewati: number; catatan: string[] }
  | {
      error: string;
    }
> {
  try {
    const res = await apiFetch<{
      dibaca: number;
      baru: number;
      diperbarui: number;
      dilewati: number;
      catatan: string[];
    }>('/staging/pull-delivery?uji=false', { method: 'POST' });
    revalidatePath('/delivery');
    revalidatePath('/trace');
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

/** Satu baris hasil tarik per entitas master. */
export interface HasilTarikMaster {
  entitas: string;
  dibaca: number;
  baru: number;
  diperbarui: number;
  dinonaktifkan: number;
  dilewati: number;
  catatan: string[];
}

/**
 * Menarik master sekarang juga.
 *
 * `uji = true` membaca staging dan MELAPORKAN apa yang akan berubah tanpa
 * menulis apa pun. Dipakai sebagai langkah pertama yang wajar: tarik master
 * menimpa isi layar master, dan untuk sesuatu yang jarang dijalankan, melihat
 * dulu jauh lebih murah daripada membatalkan sesudahnya — yang memang tidak
 * bisa dibatalkan.
 */
export async function tarikMasterAction(
  uji: boolean,
): Promise<{ hasil: HasilTarikMaster[]; alasan?: string } | { error: string }> {
  try {
    const res = await apiFetch<{ hasil: HasilTarikMaster[]; alasan?: string }>(
      `/staging/pull?uji=${uji ? 'true' : 'false'}`,
      { method: 'POST' },
    );
    if (!uji) {
      /* Master menyentuh hampir seluruh layar; yang disebut di sini hanya yang
         isinya memang berubah karena master, bukan seluruh aplikasi. */
      revalidatePath('/sap');
      revalidatePath('/master/parts');
      revalidatePath('/master/customers');
      revalidatePath('/master/suppliers');
    }
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}
