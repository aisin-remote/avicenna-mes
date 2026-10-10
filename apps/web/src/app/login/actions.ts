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
 * Server Action untuk login — diketik maupun discan.
 *
 * Perhatikan: action ini hanya memanggil API lalu menyimpan cookie —
 * tidak ada query database dan tidak ada bcrypt di sini. Pekerjaan berat
 * tetap di API. Server Action yang menjalankan proses lama akan menahan
 * request Next.js persis seperti controller PHP dulu.
 *
 * ── Satu kolom untuk dua cara masuk ─────────────────────────────────────────
 *
 * Scanner mengetik `NPK|sandi` ke kolom NPK, persis seperti jari mengetik NPK.
 * Dulu ada kotak "Scan kartu" tersendiri di atas formulir; kotak itu dibuang
 * karena kolom NPK sudah cukup — dan dua kotak di satu layar berarti kartu yang
 * discan ke kotak yang salah ditolak tanpa sebab yang terlihat operator.
 *
 * Yang membedakan keduanya adalah tanda "|": NPK tidak pernah memuatnya.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const npkMentah = String(formData.get('npk') ?? '');
  const sandiMentah = String(formData.get('password') ?? '');

  let kredensial: { npk: string; password: string };
  if (npkMentah.includes('|')) {
    try {
      kredensial = bacaQrLogin(npkMentah);
    } catch (err) {
      return { error: err instanceof QrLoginTidakTerbaca ? err.message : 'Kartu tidak terbaca.' };
    }
  } else {
    // Hanya NPK yang dirapikan. Kata sandi dibiarkan apa adanya — yang sah bisa
    // saja diawali atau diakhiri spasi, dan memangkasnya menolak orangnya masuk
    // tanpa petunjuk apa pun. Aturan yang sama dipakai bacaQrLogin.
    kredensial = { npk: npkMentah.trim(), password: sandiMentah };
  }

  const parsed = loginSchema.safeParse(kredensial);

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
