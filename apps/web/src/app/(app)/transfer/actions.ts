'use server';

import { revalidatePath } from 'next/cache';
import type { StockAvailability } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/** Stok tercatat sebuah part, dirinci per lot. */
export async function availabilityAction(
  partId: number,
): Promise<StockAvailability | { error: string }> {
  try {
    return await apiFetch<StockAvailability>(`/transfer/availability?partId=${partId}`);
  } catch (err) {
    return { error: err instanceof ApiRequestError ? err.message : 'Gagal mengambil stok' };
  }
}

export interface SubmitTransferInput {
  plantId: number;
  fromLineId?: number;
  toLineId?: number;
  fromLocationId?: number;
  toLocationId?: number;
  note?: string;
  lines: Array<{ partId: number; lotId?: number; qty: number }>;
}

export async function submitTransferAction(
  input: SubmitTransferInput,
): Promise<{ id: number; documentNumber: string } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; documentNumber: string }>('/transfer', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/transfer');
    return res;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as { details?: Array<{ message: string }> } | undefined;
      if (body?.details?.length) return { error: body.details.map((d) => d.message).join(', ') };
      return { error: err.message };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
