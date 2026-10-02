import type { MenuRow } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { searchGlobalData } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ message: 'Sesi berakhir' }, { status: 401 });
  if (user.plantId == null) return Response.json({ results: [] });

  const q = new URL(request.url).searchParams.get('q')?.trim().slice(0, 80) ?? '';
  if (q.length < 2) return Response.json({ query: q, results: [] });

  const menus = await apiFetch<MenuRow[]>('/me/menus');
  const results = await searchGlobalData({
    q,
    plantId: user.plantId,
    menuHrefs: menus.map((menu) => menu.href),
  });

  return Response.json(
    { query: q, results },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
