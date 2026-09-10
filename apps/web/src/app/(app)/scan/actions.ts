'use server';

import type { StationResult } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Mengirim satu scan dari layar stasiun.
 *
 * Server Action, bukan fetch dari browser: token sesi tersimpan di cookie
 * httpOnly yang sengaja tidak bisa dibaca skrip halaman. Perantaraan di server
 * membuat token tidak perlu diturunkan ke klien sama sekali.
 *
 * Sengaja tidak memakai revalidatePath: layar ini memperbarui dirinya sendiri
 * dari hasil yang dikembalikan. Memuat ulang seluruh halaman di antara dua
 * scan yang datang beruntun justru membuat operator menunggu.
 */
export async function submitScanAction(input: {
  rawCode: string;
  lineCode: string;
  clientRef: string;
}): Promise<StationResult | { error: string }> {
  try {
    return await apiFetch<StationResult>('/scan/station', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'PRODUCTION',
        rawCode: input.rawCode,
        lineCode: input.lineCode,
        clientRef: input.clientRef,
      }),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server. Periksa jaringan.' };
  }
}
