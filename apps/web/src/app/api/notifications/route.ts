import type { MenuRow } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { getNavNotifications } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ message: 'Sesi berakhir' }, { status: 401 });
  if (user.plantId == null) return Response.json({ notifications: [], total: 0 });

  const menus = await apiFetch<MenuRow[]>('/me/menus');
  const notifications = await getNavNotifications({
    plantId: user.plantId,
    menuHrefs: menus.map((menu) => menu.href),
  });

  return Response.json(
    {
      notifications,
      total: notifications.reduce((sum, item) => sum + item.count, 0),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
