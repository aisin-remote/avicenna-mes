'use server';

import type { CetakKanbanInput, HasilCetakKanban } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Membuat baris master untuk rentang seri yang diminta.
 *
 * Idempoten di server: yang sudah ada dilewati, tidak ditimpa. Jadi menekan
 * tombol dua kali — hal yang pasti terjadi saat printer macet — tidak
 * menghasilkan kartu kedua untuk seri yang sama.
 */
export async function buatKanbanAction(
  input: CetakKanbanInput,
): Promise<HasilCetakKanban | { error: string }> {
  try {
    return await apiFetch<HasilCetakKanban>('/kanban-master/buat', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as { message?: string } | undefined;
      return { error: body?.message ?? err.message };
    }
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
