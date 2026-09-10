import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

/**
 * Ikon di dalam lingkaran bergaris tipis.
 *
 * Elemen ini muncul di hampir setiap baris informasi dan judul kartu; ia yang
 * memberi ritme visual khas pada desain ini. Ukuran dan ketebalan garis dijaga
 * konsisten supaya deretannya terlihat sejajar.
 */
export function IconBadge({
  icon: Icon,
  size = 'md',
  tone = 'default',
  className,
}: {
  icon: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'solid' | 'muted';
  className?: string;
}) {
  const box = {
    sm: 'size-8',
    md: 'size-10',
    lg: 'size-12',
  }[size];

  const glyph = {
    sm: 'size-3.5',
    md: 'size-[18px]',
    lg: 'size-5',
  }[size];

  const tones = {
    default: 'border border-line text-ink',
    solid: 'bg-accent text-white',
    muted: 'border border-line text-ink-muted',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        box,
        tones,
        className,
      )}
    >
      <Icon className={glyph} strokeWidth={1.6} aria-hidden />
    </span>
  );
}
