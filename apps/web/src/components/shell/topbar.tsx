'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Settings, Menu, X } from 'lucide-react';
import { IconButton } from '../ui/icon-button';
import type { PenggunaShell } from './pengguna';
import type { NavGroup } from './nav-config';
import { GlobalSearch } from './global-search';
import { NotificationMenu } from './notification-menu';
import { durations, easeSoft } from '../motion/transitions';

/**
 * Bilah atas: pencarian, aksi utama, notifikasi, dan identitas pengguna.
 *
 * Pencarian membuka command palette lintas menu dan data; lonceng menampilkan
 * ringkasan tindakan operasional dari data AVICENNA.
 *
 * Di layar sempit isinya menyusut menurut urutan kepentingan: pencarian lebih
 * dulu, lalu notifikasi dan pengaturan. Menu pengguna tidak pernah ikut
 * menyingkir — di situlah tombol Keluar, dan jalan ke pengaturan saat ikonnya
 * sudah disembunyikan.
 */
export function Topbar({
  pengguna,
  groups,
  navOpen = false,
  onToggleNav,
  onOpenSettings,
}: {
  /** Identitas yang sedang masuk — dibaca server dari database, bukan dari token. */
  pengguna: PenggunaShell;
  groups: NavGroup[];
  /** Keadaan panel navigasi — hanya berpengaruh di bawah lg. */
  navOpen?: boolean;
  onToggleNav?: () => void;
  onOpenSettings?: () => void;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="flex h-[76px] shrink-0 items-center gap-4 border-b border-line bg-shell px-4 sm:gap-5 sm:px-7">
      {/* Satu-satunya jalan ke navigasi di layar sempit, jadi selalu di paling
          kiri — tempat yang sama dengan logo di layar lebar. */}
      {onToggleNav ? (
        <button
          type="button"
          onClick={onToggleNav}
          aria-label={navOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'}
          aria-expanded={navOpen}
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink-soft transition-colors hover:border-ink hover:text-ink lg:hidden"
        >
          {navOpen ? (
            <X className="size-5" strokeWidth={2} aria-hidden />
          ) : (
            <Menu className="size-5" strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}

      <GlobalSearch groups={groups} />

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Notifikasi menyingkir lebih dulu di layar sempit; pengaturan ikut,
            karena keduanya tidak mendesak dan yang harus selalu terjangkau
            adalah menu pengguna. */}
        <div className="hidden items-center gap-3 sm:flex">
          <NotificationMenu accountKey={pengguna.npk} />
          <IconButton icon={Settings} label="Pengaturan tampilan" onClick={onOpenSettings} />
        </div>

        <div className="mx-1 hidden h-7 w-px bg-line sm:block" aria-hidden />

        <div className="relative">
          <motion.button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: durations.fast, ease: easeSoft }}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            className="flex shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-1.5 outline-none transition-colors duration-200 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink/20 sm:pr-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-[14px] font-bold text-white">
              {initials(pengguna.nama)}
            </span>
            <span className="hidden max-w-40 truncate text-[14px] font-bold sm:block">
              {pengguna.nama}
            </span>
            <motion.span
              animate={{ rotate: userMenuOpen ? 180 : 0 }}
              transition={{ duration: durations.base, ease: easeSoft }}
              className="hidden text-ink-muted sm:block"
            >
              <ChevronDown className="size-4" strokeWidth={2} aria-hidden />
            </motion.span>
          </motion.button>

          <AnimatePresence>
            {userMenuOpen ? (
              <>
                {/* Lapisan penutup: klik di mana saja menutup menu. */}
                <button
                  type="button"
                  aria-label="Tutup menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setUserMenuOpen(false)}
                />
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: durations.base, ease: easeSoft }}
                  className="absolute right-0 z-20 mt-2 w-52 origin-top-right rounded-2xl border border-line bg-card p-2 shadow-lift"
                >
                  <div className="px-3 py-2.5">
                    <div className="text-[14px] font-bold">{pengguna.nama}</div>
                    <div className="tabular mt-0.5 text-[12px] text-ink-muted">
                      {pengguna.npk}
                      {pengguna.pabrik ? ` · ${pengguna.pabrik}` : ''}
                    </div>
                  </div>
                  <div className="my-1 h-px bg-line" />
                  {/* Di layar sempit ikon pengaturan di bilah atas disembunyikan,
                      jadi ini satu-satunya jalan ke sana. */}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      onOpenSettings?.();
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-[14px] font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink sm:hidden"
                  >
                    Pengaturan tampilan
                  </button>
                  <form action="/api/logout" method="post">
                    <button
                      type="submit"
                      role="menuitem"
                      className="w-full rounded-xl px-3 py-2 text-left text-[14px] font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                    >
                      Keluar
                    </button>
                  </form>
                </motion.div>
              </>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
