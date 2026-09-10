import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

/**
 * Pil "label: nilai" bergaris tipis.
 *
 * Dipakai untuk atribut pendek yang tidak layak jadi baris penuh. Label dibuat
 * tebal dan nilainya reguler, jadi sekumpulan chip tetap mudah dipindai
 * walaupun berjejer rapat.
 */
export function Chip({
  label,
  value,
  icon: Icon,
  tone = 'default',
  className,
}: {
  label?: string;
  value?: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'solid' | 'ok' | 'ng';
  className?: string;
}) {
  const tones = {
    default: 'border border-line bg-card text-ink',
    solid: 'bg-accent text-white',
    ok: 'border border-ok/25 bg-ok/8 text-ok',
    ng: 'border border-ng/25 bg-ng/8 text-ng',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] leading-none',
        tones,
        className,
      )}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden /> : null}
      {label ? <span className="font-bold">{label}</span> : null}
      {value !== undefined && value !== null ? (
        <span className={cn(tone === 'default' && 'text-ink-soft')}>{value}</span>
      ) : null}
    </span>
  );
}

/**
 * Penanda status dengan ikon berwarna.
 * Warna TIDAK menjadi satu-satunya pembeda — selalu disertai ikon dan teks,
 * supaya tetap terbaca oleh yang kesulitan membedakan warna.
 */
export function StatusBadge({
  icon: Icon,
  children,
  tone = 'ok',
  className,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  tone?: 'ok' | 'warn' | 'ng' | 'live' | 'muted';
  className?: string;
}) {
  const color = {
    ok: 'text-ok',
    warn: 'text-warn',
    ng: 'text-ng',
    live: 'text-live',
    muted: 'text-ink-muted',
  }[tone];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[15px]', color, className)}>
      <Icon className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** Titik berdenyut untuk keadaan langsung (koneksi realtime). */
export function LiveDot({ tone = 'live' }: { tone?: 'live' | 'ok' | 'warn' | 'ng' }) {
  const bg = {
    live: 'bg-live',
    ok: 'bg-ok',
    warn: 'bg-warn',
    ng: 'bg-ng',
  }[tone];

  return (
    <span className="relative inline-flex size-2.5 shrink-0">
      <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', bg)} />
      <span className={cn('relative inline-flex size-2.5 rounded-full', bg)} />
    </span>
  );
}
