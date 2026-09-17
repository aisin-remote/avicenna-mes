'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiRequestError } from '@/lib/api';

/** Mengganti seluruh rute satu part. `proses` terurut sesuai jalannya barang. */
export async function simpanRuteAction(
  partId: number,
  proses: string[],
): Promise<{ jumlah: number } | { error: string }> {
  try {
    const res = await apiFetch<{ partId: number; jumlah: number }>(`/routing/part/${partId}`, {
      method: 'PUT',
      body: JSON.stringify({ proses }),
    });
    revalidatePath('/master/part-processes');
    return { jumlah: res.jumlah };
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
