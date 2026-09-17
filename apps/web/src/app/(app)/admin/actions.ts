'use server';

import { revalidatePath } from 'next/cache';
import type { UserRow, RoleRow, MenuRow } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface AksiState {
  ok?: boolean;
  error?: string;
  /** Galat per kolom, ditampilkan tepat di bawah input yang bersangkutan. */
  fieldErrors?: Record<string, string>;
}

interface BodyValidasi {
  message?: string;
  details?: Array<{ field: string; message: string }>;
}

/**
 * Menerjemahkan kegagalan API menjadi keadaan formulir.
 *
 * Galat validasi dipecah per kolom supaya pesannya muncul tepat di bawah input
 * yang bersangkutan — satu pesan di atas formulir memaksa orang menebak kolom
 * mana yang dimaksud, dan pada formulir pengguna ada tujuh kolom untuk ditebak.
 */
function terjemahkan(err: unknown): AksiState {
  if (err instanceof ApiRequestError) {
    const body = err.body as BodyValidasi | undefined;
    if (body?.details?.length) {
      const fieldErrors: Record<string, string> = {};
      for (const d of body.details) fieldErrors[d.field] = d.message;
      return { error: body.message ?? 'Data tidak valid', fieldErrors };
    }
    return { error: err.message };
  }
  return { error: 'Tidak bisa menghubungi server API' };
}

/* ── Pengguna ─────────────────────────────────────────────────────────────── */

export async function simpanPenggunaAction(
  _prev: AksiState,
  formData: FormData,
): Promise<AksiState> {
  const id = String(formData.get('__id') ?? '');
  const sunting = id !== '';

  const isi: Record<string, unknown> = {
    npk: String(formData.get('npk') ?? ''),
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    roleId: String(formData.get('roleId') ?? ''),
    plantId: String(formData.get('plantId') ?? ''),
    // Checkbox tidak mengirim apa pun saat tidak dicentang, jadi nilainya
    // diturunkan dari keberadaan — bukan dari isi.
    isActive: formData.get('isActive') !== null,
  };

  /*
   * Kata sandi hanya ikut saat MEMBUAT.
   *
   * Pada penyuntingan ia diganti lewat tombol tersendiri. Kolom sandi yang ikut
   * di formulir sunting berarti setiap penyimpanan biasa berpeluang menulis
   * ulang sandi — dan yang paling sering terjadi adalah mengosongkannya tanpa
   * sengaja, membuat orangnya tidak bisa masuk tanpa tahu sebabnya.
   */
  if (!sunting) isi.password = String(formData.get('password') ?? '');

  try {
    await apiFetch(sunting ? `/admin/users/${id}` : '/admin/users', {
      method: sunting ? 'PATCH' : 'POST',
      body: JSON.stringify(isi),
    });
  } catch (err) {
    return terjemahkan(err);
  }

  revalidatePath('/admin/users');
  return { ok: true };
}

export async function gantiSandiAction(
  _prev: AksiState,
  formData: FormData,
): Promise<AksiState> {
  const id = String(formData.get('__id') ?? '');
  const password = String(formData.get('password') ?? '');
  const ulangi = String(formData.get('ulangi') ?? '');

  if (!id) return { error: 'Pengguna tidak dikenali' };
  if (password !== ulangi) {
    // Diperiksa di sini, bukan di API: API hanya menerima satu sandi, dan
    // pengulangannya memang urusan formulir.
    return { error: 'Ulangan kata sandi tidak sama', fieldErrors: { ulangi: 'Tidak sama' } };
  }

  try {
    await apiFetch(`/admin/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  } catch (err) {
    return terjemahkan(err);
  }
  return { ok: true };
}

export async function aktifkanPenggunaAction(id: number, isActive: boolean): Promise<AksiState> {
  try {
    await apiFetch(`/admin/users/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  } catch (err) {
    return terjemahkan(err);
  }
  revalidatePath('/admin/users');
  return { ok: true };
}

/* ── Role ─────────────────────────────────────────────────────────────────── */

export async function simpanRoleAction(
  _prev: AksiState,
  formData: FormData,
): Promise<AksiState> {
  const id = String(formData.get('__id') ?? '');
  const sunting = id !== '';

  const isi = {
    name: String(formData.get('name') ?? ''),
    label: String(formData.get('label') ?? ''),
    kind: String(formData.get('kind') ?? ''),
    processGroup: String(formData.get('processGroup') ?? ''),
    isActive: formData.get('isActive') !== null,
    // getAll: seluruh centang yang dikirim, bukan hanya yang pertama.
    menuKeys: formData.getAll('menuKeys').map(String),
  };

  try {
    await apiFetch(sunting ? `/admin/roles/${id}` : '/admin/roles', {
      method: sunting ? 'PATCH' : 'POST',
      body: JSON.stringify(isi),
    });
  } catch (err) {
    return terjemahkan(err);
  }

  revalidatePath('/admin/roles');
  // Sidebar setiap orang dibangun dari hak ini; tanpa ini perubahannya baru
  // terlihat setelah halaman dibuka ulang dengan keras.
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function hapusRoleAction(_prev: AksiState, formData: FormData): Promise<AksiState> {
  const id = String(formData.get('__id') ?? '');
  if (!id) return { error: 'Role tidak dikenali' };
  try {
    await apiFetch(`/admin/roles/${id}`, { method: 'DELETE' });
  } catch (err) {
    return terjemahkan(err);
  }
  revalidatePath('/admin/roles');
  return { ok: true };
}

/* ── Bacaan ───────────────────────────────────────────────────────────────── */

export async function ambilPengguna(params: { q?: string; page?: number }) {
  const q = new URLSearchParams({ page: String(params.page ?? 1), perPage: '25' });
  if (params.q) q.set('q', params.q);
  return apiFetch<{
    data: UserRow[];
    meta: { page: number; perPage: number; total: number; totalPages: number };
  }>(`/admin/users?${q.toString()}`);
}

export async function ambilRole() {
  return apiFetch<RoleRow[]>('/admin/roles');
}

export async function ambilKatalogMenu() {
  return apiFetch<MenuRow[]>('/admin/menus');
}
