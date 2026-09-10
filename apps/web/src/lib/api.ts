import 'server-only';
import { getToken } from './session';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3001';

/**
 * Pemanggil API untuk operasi TULIS.
 *
 * Pembagian tugas di aplikasi ini:
 *   BACA  -> Server Component query DB langsung lewat src/lib/queries.ts.
 *            Paling cepat untuk halaman report, tidak ada hop jaringan.
 *   TULIS -> selalu lewat API di sini, supaya aturan bisnis, antrean, dan
 *            siaran realtime hanya ada di satu tempat.
 *
 * Jangan menulis ke database langsung dari web, walaupun secara teknis bisa.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { authenticated?: boolean } = {},
): Promise<T> {
  const { authenticated = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Content-Type', 'application/json');

  if (authenticated) {
    const token = await getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${BASE}${path}`, { ...rest, headers, cache: 'no-store' });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiRequestError(body?.message ?? `Permintaan gagal (${res.status})`, res.status);
  }

  return res.json() as Promise<T>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
