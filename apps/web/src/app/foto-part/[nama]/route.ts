import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from '@/lib/session';

/**
 * Menyajikan foto part dari penyimpanan API.
 *
 * Gambar diminta langsung oleh peramban lewat atribut <img src>, yang tidak
 * bisa membawa header Authorization. Route ini yang menjembatani: sesi dibaca
 * dari cookie httpOnly di sisi server, lalu berkasnya diambil dari API dengan
 * token itu. Dengan begitu foto tetap di balik sesi tanpa membuka API ke
 * peramban secara langsung.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/foto-part/[nama]'>) {
  const { nama } = await ctx.params;
  const token = await getToken();
  if (!token) return new NextResponse('Tidak ada sesi', { status: 401 });

  const base = process.env.API_URL ?? 'http://127.0.0.1:3001';
  const res = await fetch(`${base}/master/foto/${encodeURIComponent(nama)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    return new NextResponse('Gambar tidak ditemukan', { status: res.status });
  }

  return new NextResponse(res.body, {
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      // Nama berkas tidak pernah dipakai ulang, jadi isinya aman disimpan lama.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
