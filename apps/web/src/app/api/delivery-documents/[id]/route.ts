import { getToken } from '@/lib/session';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken();
  if (!token) return new Response('Sesi habis.', { status: 401 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return new Response('Dokumen tidak ditemukan.', { status: 404 });
  try {
    const source = await fetch(
      `${process.env.API_URL ?? 'http://127.0.0.1:3001'}/delivery-documents/${id}/file`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      },
    );
    if (!source.ok) return new Response('PDF tidak dapat dibuka.', { status: source.status });
    const download = new URL(request.url).searchParams.has('download');
    return new Response(source.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': (source.headers.get('Content-Disposition') ?? 'inline').replace(
          /^inline/,
          download ? 'attachment' : 'inline',
        ),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      },
    });
  } catch {
    return new Response('Server PDF belum dapat dihubungi.', { status: 503 });
  }
}
