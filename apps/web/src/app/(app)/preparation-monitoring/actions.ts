'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiRequestError } from '@/lib/api';
import type { PreparationDetail, PreparationScheduleInput } from '@avicenna/contracts';

const message = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : 'Server belum dapat dihubungi. Coba lagi.';
export async function preparationDetailAction(id: number) {
  try {
    return { data: await apiFetch<PreparationDetail>(`/preparation/${id}`) };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function savePreparationCycleAction(
  id: number | null,
  input: PreparationScheduleInput,
) {
  try {
    await apiFetch(id ? `/preparation/cycles/${id}` : '/preparation/cycles', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/preparation-monitoring');
    return { message: 'Master Cycle tersimpan.' };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function deletePreparationCycleAction(id: number) {
  try {
    await apiFetch(`/preparation/cycles/${id}`, { method: 'DELETE' });
    revalidatePath('/preparation-monitoring');
    return { message: 'Master Cycle dihapus. Dokumen dan scan tidak dihapus.' };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function syncPreparationAction(date: string) {
  try {
    const result = await apiFetch<{
      results: Array<{
        entitas: string;
        dibaca: number;
        baru: number;
        diperbarui: number;
        dilewati: number;
        catatan: string[];
      }>;
    }>('/preparation/sync', { method: 'POST', body: JSON.stringify({ date }) });
    revalidatePath('/preparation-monitoring');
    revalidatePath('/delivery');
    return { data: result };
  } catch (e) {
    return { error: message(e) };
  }
}
