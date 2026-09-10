'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Plus, ChevronDown, Bell, Settings } from 'lucide-react';
import { IconButton } from '../ui/icon-button';
import { Button } from '../ui/button';
import { durations, easeSoft } from '../motion/transitions';

/**
 * Bilah atas: pencarian, aksi utama, notifikasi, dan identitas pengguna.
 *
 * Kolom pencarian melebar halus saat difokuskan — isyarat kecil bahwa fokus
 * sudah pindah ke sana, tanpa perlu garis tebal yang mengotori tampilan.
 */
export function Topbar({ userName, role }: { userName: string; role: string | null }) {
  const [focused, setFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-[76px] shrink-0 items-center gap-5 border-b border-line bg-shell px-7">
      <motion.div
        animate={{ maxWidth: focused ? 560 : 460 }}
        transition={{ duration: durations.base, ease: easeSoft }}
        className="relative w-full"
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

      <div className="ml-auto flex items-center gap-3">
        <Button icon={Plus} trailing={ChevronDown}>
          Tambah
        </Button>

        <div className="mx-1 h-7 w-px bg-line" aria-hidden />

        <IconButton icon={Bell} label="Notifikasi" badge />
        <IconButton icon={Settings} label="Pengaturan" />

        <div className="mx-1 h-7 w-px bg-line" aria-hidden />

        <div className="relative">
          <motion.button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: durations.fast, ease: easeSoft }}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-3 outline-none transition-colors duration-200 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-[14px] font-bold text-white">
              {initials(userName)}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-[14px] font-bold">{userName}</span>
              <span className="block text-[12px] capitalize text-ink-muted">{role ?? '—'}</span>
            </span>
            <motion.span
              animate={{ rotate: menuOpen ? 180 : 0 }}
              transition={{ duration: durations.base, ease: easeSoft }}
              className="text-ink-muted"
            >
              <ChevronDown className="size-4" strokeWidth={2} aria-hidden />
            </motion.span>
          </motion.button>

          <AnimatePresence>
            {menuOpen ? (
              <>
                {/* Lapisan penutup: klik di mana saja menutup menu. */}
                <button
                  type="button"
                  aria-label="Tutup menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
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
