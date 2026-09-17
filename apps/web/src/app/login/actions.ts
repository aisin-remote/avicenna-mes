'use server';

import { redirect } from 'next/navigation';
import { loginSchema, type LoginResponse } from '@avicenna/contracts';
import { bacaQrLogin, QrLoginTidakTerbaca } from '@avicenna/domain';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { setToken } from '@/lib/session';

export interface LoginState {
  error?: string;
}

/**
 * Server Action untuk login.
 *
 * Perhatikan: action ini hanya memanggil API lalu menyimpan cookie —
 * tidak ada query database dan tidak ada bcrypt di sini. Pekerjaan berat
 * tetap di API. Server Action yang menjalankan proses lama akan menahan
 * request Next.js persis seperti controller PHP dulu.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    npk: formData.get('npk'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Data tidak valid' };
  }

  /*
   * Tujuan datang dari server, bukan ditetapkan di sini.
   *
   * Lasman casting dibawa ke layar scan casting, leader ke pemantauan, admin ke
   * dashboard. Aturannya ada di @avicenna/domain dan ikut teruji; menyalinnya
   * ke sini berarti dua tempat yang harus dijaga sama.
   */
  let tujuan = '/dashboard';

  try {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      authenticated: false,
    });
    await setToken(res.accessToken);
    tujuan = res.user.landing;
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server API' };
  }

  redirect(tujuan);
}

/**
 * Login dengan men-scan kartu: `NPK|password`.
 *
 * Dipisah dari loginAction karena bentuk masukannya berbeda — satu baris dari
 * scanner, bukan dua kolom yang diketik. Penguraiannya di @avicenna/domain
 * supaya bisa ditest tanpa browser, dan supaya kata sandi ber-"|" tidak
 * terpotong diam-diam.
 */
export async function loginQrAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = String(formData.get('kartu') ?? '');

  let kredensial;
  try {
    kredensial = bacaQrLogin(raw);
  } catch (err) {
    return { error: err instanceof QrLoginTidakTerbaca ? err.message : 'Kartu tidak terbaca.' };
  }

  const parsed = loginSchema.safeParse(kredensial);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Isi kartu tidak valid' };
  }

  let tujuan = '/dashboard';
  try {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      authenticated: false,
    });
    await setToken(res.accessToken);
    tujuan = res.user.landing;
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server API' };
  }

  redirect(tujuan);
}
