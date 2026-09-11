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
