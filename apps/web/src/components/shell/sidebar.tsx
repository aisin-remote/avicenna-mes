'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { NAV_GROUPS, type NavGroup } from './nav-config';
import { iconFor } from '../ui/icon-map';
import { springSnappy, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

/**
 * Navigasi utama.
 *
 * Pil hitam penanda menu aktif memakai `layoutId`, sehingga saat berpindah
 * halaman ia MELUNCUR dari posisi lama ke posisi baru alih-alih berkedip
 * hilang-muncul.
 */
export function Sidebar({ userName, role }: { userName: string; role: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-shell">
      <div className="px-7 pb-6 pt-8">
        <Link href="/dashboard" className="block">
          <div className="text-[22px] font-extrabold leading-none tracking-tight">AVICENNA</div>
          <div className="mt-1.5 text-[13px] text-ink-muted">Manufacturing Execution</div>
        </Link>
      </div>

      <nav className="scroll-slim flex-1 overflow-y-auto px-4 pb-4">
        {NAV_GROUPS.map((group) => (
          <Group key={group.title} group={group} pathname={pathname} />
        ))}
      </nav>

      <div className="border-t border-line px-6 py-5">
        <div className="text-[14px] font-bold leading-tight">{userName}</div>
        <div className="mt-0.5 text-[13px] capitalize text-ink-muted">{role ?? 'tanpa role'}</div>
        <form action="/api/logout" method="post" className="mt-3">
          <motion.button
            type="submit"
            whileTap={{ scale: 0.96 }}
            transition={{ duration: durations.fast, ease: easeSoft }}
            className="rounded-full text-[13px] text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
          >
            Keluar
          </motion.button>
        </form>
      </div>
    </aside>
  );
}

function Group({ group, pathname }: { group: NavGroup; pathname: string }) {
  const hasActive = group.items.some((i) => isActive(pathname, i.href));
  // Grup yang dilipat tetap terbuka kalau salah satu isinya sedang aktif —
  // pengguna tidak boleh kehilangan jejak posisinya setelah berpindah halaman.
  const [open, setOpen] = useState(!group.collapsible || hasActive);

  return (
    <div className="mb-5">
      {group.collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          {group.title}
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: durations.base, ease: easeSoft }}
          >
            <ChevronDown className="size-3.5" strokeWidth={2.2} aria-hidden />
          </motion.span>
        </button>
      ) : (
        <div className="px-3 pb-2 text-[12px] font-semibold text-ink-muted">{group.title}</div>
      )}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            initial={group.collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="space-y-0.5 overflow-hidden pt-1"
          >
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = iconFor(item.icon);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-full px-3.5 py-2.5',
                      'text-[14px] font-semibold outline-none',
                      'focus-visible:ring-2 focus-visible:ring-ink/20',
                      active ? 'text-white' : 'text-ink-soft hover:text-ink',
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="nav-pill"
                        transition={springSnappy}
                        className="absolute inset-0 rounded-full bg-accent"
                      />
                    ) : (
                      <span className="absolute inset-0 rounded-full bg-transparent transition-colors duration-200 group-hover:bg-surface" />
                    )}
                    <Icon
                      className="relative size-[18px] shrink-0"
                      strokeWidth={active ? 2 : 1.7}
                      aria-hidden
                    />
                    <span className="relative">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
