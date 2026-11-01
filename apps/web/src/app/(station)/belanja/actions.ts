'use server';

import type {
  BatalBelanjaInput,
  ScanBelanjaInput,
  ScanBelanjaResult,
  SimpanBelanjaInput,
  SimpanBelanjaResult,
} from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Aksi stasiun belanja.
 *
 * TIDAK memanggil revalidatePath: layarnya memperbarui dirinya dari balasan
 * ini, dan memuat ulang halaman di tengah belanja berarti fokus kotak scan
 * lepas — tembakan berikutnya mendarat entah di mana tanpa operator sadar.
 */
function pesanGalat(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const body = err.body as { message?: string } | undefined;
    return body?.message ?? err.message;
  }
  return 'Tidak bisa menghubungi server.';
}

export async function scanBelanjaAction(
  input: ScanBelanjaInput,
): Promise<ScanBelanjaResult | { error: string }> {
  try {
    return await apiFetch<ScanBelanjaResult>('/belanja/scan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return { error: pesanGalat(err) };
  }
}

export async function simpanBelanjaAction(
  input: SimpanBelanjaInput,
): Promise<SimpanBelanjaResult | { error: string }> {
  try {
    return await apiFetch<SimpanBelanjaResult>('/belanja/simpan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return { error: pesanGalat(err) };
  }
}

export async function batalBelanjaAction(
  input: BatalBelanjaInput,
): Promise<{ hasil: 'DITERIMA' | 'DITOLAK'; pesan: string } | { error: string }> {
  try {
    return await apiFetch<{ hasil: 'DITERIMA' | 'DITOLAK'; pesan: string }>('/belanja/batal', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return { error: pesanGalat(err) };
  }
}
