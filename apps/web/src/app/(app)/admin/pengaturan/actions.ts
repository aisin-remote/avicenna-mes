'use server';

import { revalidatePath } from 'next/cache';
import type { DefinisiPengaturan, NilaiPengaturan } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface HasilUbah {
  ok?: boolean;
  error?: string;
}

export async function ambilPengaturan(): Promise<{
  definisi: DefinisiPengaturan[];
  nilai: NilaiPengaturan[];
}> {
  return apiFetch<{ definisi: DefinisiPengaturan[]; nilai: NilaiPengaturan[] }>('/setting');
}

/**
 * Menggeser satu saklar.
 *
 * Satu saklar per permintaan, bukan satu tombol "Simpan" untuk seluruh
 * halaman. Alasannya: tiap saklar punya akibat sendiri, dan beberapa di
 * antaranya tidak bisa dibatalkan dengan mematikannya lagi. Simpan massal
 * membuat orang menggeser tiga saklar lalu menekan satu tombol tanpa pernah
 * berhadapan dengan peringatan masing-masing.
 */
export async function ubahPengaturanAction(key: string, nilai: boolean): Promise<HasilUbah> {
  try {
    await apiFetch(`/setting/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ nilai }),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as { message?: string } | undefined;
      return { error: body?.message ?? err.message };
    }
    return { error: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan' };
  }

  revalidatePath('/admin/pengaturan');
  /*
   * Halaman SAP ikut di-revalidate: tombol simulasi di sana muncul atau hilang
   * tergantung saklar di halaman ini, dan tombol yang masih terlihat padahal
   * saklarnya sudah dimatikan akan menghasilkan galat yang membingungkan.
   */
  revalidatePath('/sap');
  return { ok: true };
}
