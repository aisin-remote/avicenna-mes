'use server';

import { revalidatePath } from 'next/cache';
import type { ResolvedPart } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { unstable_rethrow } from 'next/navigation';
import type { ReceivingSession, ReceivingScanOutcome } from '@avicenna/contracts';

type ActionError = { error: string; retryable: boolean };

function receivingError(error: unknown): ActionError {
  unstable_rethrow(error);
  return {
    error:
      error instanceof ApiRequestError
        ? error.message
        : 'Tidak bisa menghubungi server. Coba lagi.',
    retryable: !(error instanceof ApiRequestError) || error.status >= 500,
  };
}

export async function openReceivingAction(
  code: string,
  locationId: number,
): Promise<ReceivingSession | ActionError> {
  try {
    const session = await apiFetch<ReceivingSession>('/receiving/open', {
      method: 'POST',
      body: JSON.stringify({ code, locationId }),
    });
    revalidatePath('/receiving');
    return session;
  } catch (error) {
    return receivingError(error);
  }
}

export async function scanReceivingAction(
  id: number,
  code: string,
  clientRef: string,
): Promise<ReceivingScanOutcome | ActionError> {
  try {
    return await apiFetch<ReceivingScanOutcome>(`/receiving/${id}/scan`, {
      method: 'POST',
      body: JSON.stringify({ code, clientRef }),
    });
  } catch (error) {
    return receivingError(error);
  }
}

export async function closeReceivingAction(
  id: number,
  reason: string,
): Promise<{ id: number } | ActionError> {
  try {
    const result = await apiFetch<{ id: number }>(`/receiving/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    revalidatePath('/receiving');
    revalidatePath(`/receiving/${id}`);
    return result;
  } catch (error) {
    return receivingError(error);
  }
}

export async function cancelReceivingAction(
  id: number,
  reason: string,
): Promise<{ id: number } | ActionError> {
  try {
    const result = await apiFetch<{ id: number }>(`/receiving/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    revalidatePath('/receiving');
    revalidatePath(`/receiving/${id}`);
    return result;
  } catch (error) {
    return receivingError(error);
  }
}

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
      message: err instanceof ApiRequestError ? err.message : 'Tidak bisa menghubungi server.',
    };
  }
}

export interface SubmitReceiptInput {
  plantId: number;
  supplierId: number;
  locationId?: number;
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

export interface UpdateReceiptInput {
  id: number;
  supplierDocNumber?: string;
  reason?: string;
  lines: Array<{
    id?: number;
    partId: number;
    qty: number;
    uom?: string;
    supplierLotNumber?: string;
  }>;
}

/**
 * Mengubah penerimaan yang sudah tercatat.
 *
 * Selisihnya dicatat API sebagai mutasi koreksi, bukan menimpa mutasi lama.
 */
export async function updateReceiptAction(
  input: UpdateReceiptInput,
): Promise<{ id: number; documentNumber: string } | { error: string }> {
  const { id, ...body } = input;
  try {
    const res = await apiFetch<{ id: number; documentNumber: string }>(`/receiving/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    revalidatePath('/receiving');
    revalidatePath(`/receiving/${id}`);
    return res;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as { details?: Array<{ field: string; message: string }> } | undefined;
      if (body?.details?.length) return { error: body.details.map((d) => d.message).join(', ') };
      return { error: err.message };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}

/** Mencari banyak part sekaligus — dipakai saat impor tempelan. */
export async function resolveBulkAction(
  partNumbers: string[],
): Promise<Record<string, ResolvedPart>> {
  try {
    return await apiFetch<Record<string, ResolvedPart>>('/receiving/resolve-bulk', {
      method: 'POST',
      body: JSON.stringify({ partNumbers }),
    });
  } catch {
    return {};
  }
}
