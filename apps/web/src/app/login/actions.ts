'use server';

import { redirect } from 'next/navigation';
import { loginSchema, type LoginResponse } from '@avicenna/contracts';
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

  try {
    const res = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      authenticated: false,
    });
    await setToken(res.accessToken);
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server API' };
  }

  redirect('/dashboard');
}
