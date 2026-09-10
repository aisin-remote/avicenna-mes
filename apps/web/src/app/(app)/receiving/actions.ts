'use server';

import { revalidatePath } from 'next/cache';
import type { ResolvedPart } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Mencari part dari barcode yang discan.
 *
 * Lewat server action, bukan fetch langsung dari browser: token sesi ada di
 * cookie httpOnly yang sengaja tidak bisa dibaca skrip halaman.
 */
export async function resolveBarcodeAction(code: string): Promise<ResolvedPart> {
  try {
    return await apiFetch<ResolvedPart>(`/receiving/resolve?code=${encodeURIComponent(code)}`);
  } catch (err) {
    return {
      found: false,
      message:
        err instanceof ApiRequestError ? err.message : 'Tidak bisa menghubungi server.',
    };
  }
}

export interface SubmitReceiptInput {
  plantId: number;
  supplierId: number;
  supplierDocNumber?: string;
  note?: string;
  lines: Array<{ partId: number; qty: number; uom?: string; supplierLotNumber?: string }>;
}

export async function submitReceiptAction(
  input: SubmitReceiptInput,
): Promise<{ id: number; documentNumber: string } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; documentNumber: string }>('/receiving', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/receiving');
    return res;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as { details?: Array<{ field: string; message: string }> } | undefined;
      if (body?.details?.length) {
        return { error: body.details.map((d) => d.message).join(', ') };
      }
      return { error: err.message };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
