'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiRequestError } from '@/lib/api';

/** Mengganti seluruh rute satu part. `proses` terurut sesuai jalannya barang. */
export async function simpanRuteAction(
  partId: number,
  proses: string[],
): Promise<{ jumlah: number; masalah: string[] } | { error: string }> {
  try {
    const res = await apiFetch<{ partId: number; jumlah: number; masalah?: string[] }>(
      `/routing/part/${partId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ proses }),
      },
    );
    // Dua layar membaca rute yang sama: matriks, dan CRUD SAP per langkah.
    revalidatePath('/master/part-processes');
    revalidatePath('/master/part-processes/matriks');
    // Rute boleh tersimpan meski belum wajar (mis. FG tanpa Delivery saat
    // rutenya baru separuh disusun). Peringatannya dibawa ke layar.
    return { jumlah: res.jumlah, masalah: res.masalah ?? [] };
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server.' };
  }
}
