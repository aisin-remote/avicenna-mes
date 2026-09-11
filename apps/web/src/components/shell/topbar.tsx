'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, ChevronDown, Bell, Settings, Menu, X } from 'lucide-react';
import { IconButton } from '../ui/icon-button';
import { Button } from '../ui/button';
import { durations, easeSoft } from '../motion/transitions';

/**
 * Bilah atas: pencarian, aksi utama, notifikasi, dan identitas pengguna.
 *
 * Kolom pencarian melebar halus saat difokuskan — isyarat kecil bahwa fokus
 * sudah pindah ke sana, tanpa perlu garis tebal yang mengotori tampilan.
 *
 * Di layar sempit isinya menyusut menurut urutan kepentingan: pencarian,
 * lalu tombol Tambah, lalu notifikasi dan pengaturan. Menu pengguna tidak
 * pernah ikut menyingkir — di situlah satu-satunya tombol Keluar.
 */
export function Topbar({
  userName,
  role,
  navOpen = false,
  onToggleNav,
}: {
  userName: string;
  role: string | null;
  /** Keadaan panel navigasi — hanya berpengaruh di bawah lg. */
  navOpen?: boolean;
  onToggleNav?: () => void;
}) {
  const [focused, setFocused] = useState(false);
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

      {/* Pencarian disembunyikan di layar sempit: dipersempit terus ia menyusut
          jadi lingkaran tanpa guna, dan mendesak menu pengguna sampai keluar
          layar — padahal di situlah satu-satunya tombol Keluar. */}
      <motion.div
        animate={{ maxWidth: focused ? 560 : 460 }}
        transition={{ duration: durations.base, ease: easeSoft }}
        className="relative hidden w-full md:block"
      >
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted"
          strokeWidth={1.8}
          aria-hidden
        />
        <input
          type="search"
          placeholder="Cari part, line, atau nomor seri"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Pencarian"
          className="h-11 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-[14px] outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-line-strong focus:bg-card"
        />
      </motion.div>

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="hidden sm:block">
          <Button icon={Plus} trailing={ChevronDown}>
            Tambah
          </Button>
        </div>

        <div className="mx-1 hidden h-7 w-px bg-line sm:block" aria-hidden />

        {/* Notifikasi dan pengaturan menyingkir lebih dulu di layar sempit —
            keduanya tidak mendesak, dan yang harus selalu terjangkau adalah
            menu pengguna. */}
        <div className="hidden items-center gap-3 sm:flex">
          <IconButton icon={Bell} label="Notifikasi" badge />
          <IconButton icon={Settings} label="Pengaturan" />
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
            className="flex shrink-0 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-1.5 outline-none transition-colors duration-200 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink/20 sm:pr-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-[14px] font-bold text-white">
              {initials(userName)}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-[14px] font-bold">{userName}</span>
              <span className="block text-[12px] capitalize text-ink-muted">{role ?? '—'}</span>
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
                  className="absolute right-0 z-20 mt-2 w-56 origin-top-right rounded-2xl border border-line bg-card p-2 shadow-lift"
                >
                  <div className="px-3 py-2">
                    <div className="text-[14px] font-bold">{userName}</div>
                    <div className="text-[12px] capitalize text-ink-muted">{role ?? '—'}</div>
                  </div>
                  <div className="my-1 h-px bg-line" />
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
