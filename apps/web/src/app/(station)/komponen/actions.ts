'use server';

import type { ScanKomponenInput, ScanKomponenResult } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Satu scan kartu di stasiun kanban.
 *
 * TIDAK memanggil revalidatePath: layarnya memperbarui dirinya dari balasan
 * ini, dan memuat ulang halaman di tengah shift berarti fokus kotak scan
 * lepas — tembakan berikutnya mendarat entah di mana tanpa operator sadar.
 */
export async function scanKomponenAction(
  input: ScanKomponenInput,
): Promise<ScanKomponenResult | { error: string }> {
  try {
    return await apiFetch<ScanKomponenResult>('/komponen/scan', {
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
