import { getToken } from '@/lib/session';

export async function GET(request: Request) {
  const token = await getToken();
  if (!token) return new Response('Sesi habis.', { status: 401 });
  const params = new URLSearchParams();
  const incoming = new URL(request.url).searchParams;
  for (const key of ['plantId', 'part', 'mode', 'dock']) {
    const value = incoming.get(key);
    if (value !== null) params.set(key, value);
  }
  try {
    const res = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:3001'}/pis/image?${params}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!res.ok) return new Response('Gambar belum tersedia.', { status: res.status });
    return new Response(res.body, { headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return new Response('Server belum dapat dihubungi.', { status: 503 });
  }
}
