'use client';

import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from './cn';

/**
 * Tombol utama berbentuk pil. Hitam pekat hanya untuk satu aksi utama per layar.
 *
 * PENTING — hanya boleh dipakai DARI KOMPONEN KLIEN.
 *
 * Prop `icon` bertipe komponen (fungsi). Fungsi tidak bisa diserialisasi lewat
 * batas RSC, jadi memanggil komponen ini dari Server Component akan menggagalkan
 * seluruh halaman dengan 500: "Functions cannot be passed directly to Client
 * Components". Kalau butuh dari halaman server, render ikonnya di server dan
 * oper sebagai ReactNode — lihat pola pada StatCard.
 */
export function Button({
  children,
  icon: Icon,
  trailing: Trailing,
  onClick,
  type = 'button',
  variant = 'solid',
  size = 'md',
  disabled,
  className,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
  trailing?: LucideIcon;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'solid' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}) {
  const sizes = {
    sm: 'h-9 px-4 text-[13px] gap-1.5',
    md: 'h-11 px-5 text-[14px] gap-2',
    lg: 'h-13 px-6 text-[15px] gap-2',
  }[size];

  const variants = {
    solid: 'bg-accent text-white hover:bg-accent-soft',
    outline: 'border border-line bg-card text-ink hover:border-line-strong hover:bg-surface',
    ghost: 'text-ink-soft hover:bg-surface hover:text-ink',
  }[variant];

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: durations.fast, ease: easeSoft }}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold',
        'outline-none focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2',
        'transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        sizes,
        variants,
        className,
      )}
    >
      {Icon ? <Icon className="size-[18px]" strokeWidth={2.2} aria-hidden /> : null}
      {children}
      {Trailing ? <Trailing className="size-4 opacity-70" strokeWidth={2.2} aria-hidden /> : null}
    </motion.button>
  );
}
