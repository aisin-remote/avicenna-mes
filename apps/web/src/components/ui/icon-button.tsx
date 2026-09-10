'use client';

import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from './cn';

/**
 * Tombol ikon bulat bergaris — dipakai di kanan judul kartu dan di topbar.
 *
 * Umpan balik sentuhnya kecil dan cepat (skala 0.94, 160ms). Gerak yang lebih
 * besar dari ini pada tombol sekecil ini terasa berlebihan, dan tombol-tombol
 * ini sering ditekan berkali-kali dalam satu sesi.
 *
 * PENTING — hanya boleh dipakai DARI KOMPONEN KLIEN.
 *
 * Prop `icon` bertipe komponen (fungsi). Fungsi tidak bisa diserialisasi lewat
 * batas RSC, jadi memanggil komponen ini dari Server Component akan menggagalkan
 * seluruh halaman dengan 500: "Functions cannot be passed directly to Client
 * Components". Kalau butuh dari halaman server, render ikonnya di server dan
 * oper sebagai ReactNode — lihat pola pada StatCard.
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  size = 'md',
  variant = 'outline',
  className,
  badge,
}: {
  icon: LucideIcon;
  /** Wajib: tombol ini tidak punya teks, jadi pembaca layar bergantung padanya. */
  label: string;
  onClick?: () => void;
  size?: 'sm' | 'md';
  variant?: 'outline' | 'ghost' | 'solid';
  className?: string;
  /** Titik notifikasi kecil di pojok kanan atas. */
  badge?: boolean;
}) {
  const box = size === 'sm' ? 'size-9' : 'size-11';
  const glyph = size === 'sm' ? 'size-4' : 'size-[18px]';

  const variants = {
    outline: 'border border-line bg-card text-ink hover:border-line-strong hover:bg-surface',
    ghost: 'text-ink-muted hover:bg-surface hover:text-ink',
    solid: 'bg-accent text-white hover:bg-accent-soft',
  }[variant];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: durations.fast, ease: easeSoft }}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2',
        'transition-colors duration-200',
        box,
        variants,
        className,
      )}
    >
      <Icon className={glyph} strokeWidth={1.7} aria-hidden />
      {badge ? (
        <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-ng ring-2 ring-card" />
      ) : null}
    </motion.button>
  );
}
