import 'server-only';
import { cookies } from 'next/headers';
import { NAMA_COOKIE_SESI } from '@avicenna/contracts';

const COOKIE = NAMA_COOKIE_SESI;

export interface SessionUser {
  id: number;
  npk: string;
  name: string;
  role: string | null;
  /**
   * Jabatan, ikut di dalam token.
   *
   * Dipakai HANYA untuk memilih apa yang digambar — mis. mengarahkan yang bukan
   * admin keluar dari /admin sebelum halamannya dirender. Bukan pembatasan:
   * isinya dibaca tanpa verifikasi tanda tangan (lihat catatan di bawah), dan
   * yang benar-benar menjaga adalah @AdminOnly di API.
   */
  roleKind: 'SCANNING' | 'VIEW' | 'ADMIN' | null;
  plantId: number | null;
}

/**
 * Token disimpan di cookie httpOnly, bukan localStorage.
 *
 * Alasannya: layar pabrik dipakai bergantian antar shift dan sering dibiarkan
 * terbuka. Cookie httpOnly tidak terbaca skrip apa pun di halaman, dan hilang
 * mengikuti masa berlakunya tanpa perlu diingat operator.
 */
export async function getToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE)?.value;
}

export async function setToken(token: string, maxAgeSeconds = 8 * 3600): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function clearToken(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Membaca isi JWT tanpa verifikasi — hanya untuk menampilkan nama di UI. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as {
      sub: number;
      npk: string;
      name: string;
      role: string | null;
      roleKind: SessionUser['roleKind'];
      plantId: number | null;
      exp?: number;
    };
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      id: payload.sub,
      npk: payload.npk,
      name: payload.name,
      role: payload.role,
      roleKind: payload.roleKind ?? null,
      plantId: payload.plantId,
    };
  } catch {
    return null;
  }
}
