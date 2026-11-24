'use server';

import { revalidatePath } from 'next/cache';
import type { NgKoreksiBaris } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/** Koreksi satu catatan NG: qty baru (0 = batal), jenis baru, dan alasannya. */
export async function koreksiNgAction(
  id: number,
  input: { qty: number; ngMasterId?: number; alasan: string },
): Promise<NgKoreksiBaris | { error: string }> {
  try {
    const res = await apiFetch<NgKoreksiBaris>(`/ng/${id}/koreksi`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/koreksi-ng');
    return res;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as { message?: string | string[] } | undefined;
      const m = body?.message;
      return { error: Array.isArray(m) ? m.join(', ') : (m ?? err.message) };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
