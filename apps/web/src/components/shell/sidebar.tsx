'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, LogOut } from 'lucide-react';
import { NAV_GROUPS, type NavGroup } from './nav-config';
import type { SidebarMode } from '@/lib/preferences';
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
export function Sidebar({
  userName,
  role,
  open = false,
  mode = 'penuh',
}: {
  userName: string;
  role: string | null;
  /** Hanya berlaku di bawah lg; di layar lebar sidebar selalu tampak. */
  open?: boolean;
  /** 'ikon' menyusutkan sidebar jadi deretan ikon saja. */
  mode?: SidebarMode;
}) {
  const pathname = usePathname();

  /*
   * Mode ikon hanya berlaku saat sidebar menjadi bagian tetap tata letak.
   * Sebagai panel geser ia sudah menutupi halaman, jadi menyusutkannya tidak
   * memberi ruang apa pun — yang ada isinya malah jadi lebih sulit dikenali.
   */
  const ringkas = mode === 'ikon' && !open;

  return (
    <aside
      /*
       * Di bawah lg: panel geser di atas isi halaman. Mulai lg: kembali
       * menjadi kolom biasa di dalam flex.
       *
       * Saat tertutup dipakai `invisible`, bukan sekadar digeser keluar layar.
       * Panel yang hanya digeser tetap ada di urutan Tab: menekan Tab dari
       * halaman akan memindahkan fokus ke menu yang tidak terlihat, dan
       * pengguna keyboard kehilangan jejak di mana fokusnya berada.
       * `visibility` ikut ditransisikan supaya animasi menutupnya tetap
       * terlihat — tanpa itu panel langsung lenyap alih-alih meluncur.
       */
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col border-r border-line bg-shell',
        'transition-[transform,visibility,width] duration-300 ease-out motion-reduce:transition-none',
        // Lebar dasar selalu ada: mode ikon hanya berlaku mulai lg, karena di
        // bawah itu sidebar berperan sebagai panel geser.
        'w-[264px]',
        ringkas && 'lg:w-[76px]',
        'lg:visible lg:static lg:z-auto lg:translate-x-0 lg:shadow-none',
        open ? 'visible translate-x-0 shadow-shell' : 'invisible -translate-x-full',
      )}
    >
      <div className={cn('pb-6 pt-8', ringkas ? 'px-0 text-center' : 'px-7')}>
        <Link href="/dashboard" className="block" title="Avicenna MES">
          {ringkas ? (
            <span className="text-[20px] font-extrabold tracking-tight">A</span>
          ) : (
            <>
              <div className="text-[22px] font-extrabold leading-none tracking-tight">AVICENNA</div>
              <div className="mt-1.5 text-[13px] text-ink-muted">Manufacturing Execution</div>
            </>
          )}
        </Link>
      </div>

      <nav className={cn('scroll-slim flex-1 overflow-y-auto pb-4', ringkas ? 'px-3' : 'px-4')}>
        {NAV_GROUPS.map((group) => (
          <Group key={group.title} group={group} pathname={pathname} ringkas={ringkas} />
        ))}
      </nav>

      <div className={cn('border-t border-line py-5', ringkas ? 'px-3' : 'px-6')}>
        {ringkas ? (
          <form action="/api/logout" method="post">
            <motion.button
              type="submit"
              whileTap={{ scale: 0.96 }}
              transition={{ duration: durations.fast, ease: easeSoft }}
              title={`Keluar — ${userName}`}
              aria-label={`Keluar — ${userName}`}
              className="grid size-11 w-full place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <LogOut className="size-[18px]" strokeWidth={1.8} aria-hidden />
            </motion.button>
          </form>
        ) : (
          <>
            <div className="text-[14px] font-bold leading-tight">{userName}</div>
            <div className="mt-0.5 text-[13px] capitalize text-ink-muted">
              {role ?? 'tanpa role'}
            </div>
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
          </>
        )}
      </div>
    </aside>
  );
}

function Group({
  group,
  pathname,
  ringkas,
}: {
  group: NavGroup;
  pathname: string;
  ringkas: boolean;
}) {
  const hasActive = group.items.some((i) => isActive(pathname, i.href));
  // Grup yang dilipat tetap terbuka kalau salah satu isinya sedang aktif —
  // pengguna tidak boleh kehilangan jejak posisinya setelah berpindah halaman.
  const [open, setOpen] = useState(!group.collapsible || hasActive);

  /*
   * Dalam mode ikon, grup yang bisa dilipat ditampilkan terbuka begitu saja.
   * Judul grupnya tidak muat, dan tombol lipat tanpa judul hanya menyisakan
   * anak panah yang tidak menjelaskan apa pun. Pemisah tipis sudah cukup
   * menandai bahwa kelompoknya berganti.
   */
  const terbuka = ringkas ? true : open;

  return (
    <div className={cn('mb-5', ringkas && 'mb-3 border-t border-line pt-3 first:border-0 first:pt-0')}>
      {ringkas ? null : group.collapsible ? (
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
        {terbuka ? (
          <motion.ul
            initial={group.collapsible && !ringkas ? { height: 0, opacity: 0 } : false}
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
                    // Tanpa teks, nama menu harus tetap sampai ke pembaca layar
                    // dan ke penunjuk tetikus yang berhenti di atasnya.
                    title={ringkas ? item.label : undefined}
                    aria-label={ringkas ? item.label : undefined}
                    className={cn(
                      'group relative flex items-center rounded-full py-2.5',
                      'text-[14px] font-semibold outline-none',
                      'focus-visible:ring-2 focus-visible:ring-ink/20',
                      ringkas ? 'justify-center px-0' : 'gap-3 px-3.5',
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
                    {ringkas ? null : <span className="relative">{item.label}</span>}
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
