'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/monitor', label: 'Monitor Line' },
  { href: '/master/parts', label: 'Master Part' },
];

export function Sidebar({ userName, role }: { userName: string; role: string | null }) {
  const pathname = usePathname();

  return (
    <aside
      className="flex w-60 shrink-0 flex-col border-r"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <div className="text-lg font-semibold tracking-tight">Avicenna MES</div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          AIIA Manufacturing
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-sm font-medium transition"
              style={
                active
                  ? { background: 'var(--color-brand-500)', color: '#fff' }
                  : { color: 'var(--muted)' }
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <div className="text-sm font-medium">{userName}</div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          {role ?? 'tanpa role'}
        </div>
        <form action="/api/logout" method="post" className="mt-3">
          <button
            type="submit"
            className="text-xs underline underline-offset-2"
            style={{ color: 'var(--muted)' }}
          >
            Keluar
          </button>
        </form>
      </div>
    </aside>
  );
}
