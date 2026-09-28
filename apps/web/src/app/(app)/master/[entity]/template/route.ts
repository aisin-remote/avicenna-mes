import { NextResponse } from 'next/server';
import { isMasterEntity } from '@avicenna/contracts';
import { getToken } from '@/lib/session';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3001';

/**
 * Meneruskan unduhan template dari API.
 *
 * Route handler, bukan Server Action: Server Action mengembalikan nilai ke
 * komponen, sedangkan yang dibutuhkan di sini adalah respons berkas dengan
 * Content-Disposition supaya browser menyimpannya. Tautan biasa ke API juga
 * tidak bisa — token sesi ada di cookie httpOnly milik domain web, dan browser
 * tidak akan mengirimkannya ke API.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  if (!isMasterEntity(entity)) {
    return NextResponse.json({ message: 'Entitas tidak dikenal' }, { status: 400 });
  }

  const token = await getToken();
  if (!token) return NextResponse.redirect(new URL('/login', _req.url));

  const res = await fetch(`${BASE}/master/${entity}/template`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json(
      { message: 'Template gagal dibuat. Coba lagi, atau hubungi administrator.' },
      { status: res.status },
    );
  }

  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="template-${entity}.xlsx"`,
      // Template memuat daftar kode yang sah saat ini (dropdown referensi);
      // versi yang disimpan cache akan menawarkan kode yang sudah dihapus.
      'Cache-Control': 'no-store',
    },
  });
}
