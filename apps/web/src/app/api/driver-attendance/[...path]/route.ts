import { getToken } from '@/lib/session';

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const token = await getToken();
  if (!token) return new Response('Sesi habis.', { status: 401 });
  const { path } = await params;
  const exportFile = path.length === 1 && path[0] === 'export';
  const photo = path.length === 2 && /^[1-9]\d*$/.test(path[0]!) && path[1] === 'photo';
  if (!exportFile && !photo) return new Response('Tidak ditemukan.', { status: 404 });
  const query = new URLSearchParams();
  if (exportFile)
    for (const key of ['plantId', 'from', 'to']) {
      const value = new URL(request.url).searchParams.get(key);
      if (value !== null) query.set(key, value);
    }
  try {
    const source = await fetch(
      `${process.env.API_URL ?? 'http://127.0.0.1:3001'}/driver-attendance/${path.join('/')}?${query}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    );
    if (!source.ok) return new Response('Berkas tidak dapat diakses.', { status: source.status });
    const headers = new Headers({
      'Content-Type': source.headers.get('Content-Type') ?? 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const disposition = source.headers.get('Content-Disposition');
    if (disposition) headers.set('Content-Disposition', disposition);
    return new Response(source.body, { headers });
  } catch {
    return new Response('Server belum dapat dihubungi.', { status: 503 });
  }
}
