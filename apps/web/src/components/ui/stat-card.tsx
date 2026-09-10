import type { LucideIcon } from 'lucide-react';
import { IconBadge } from './icon-badge';
import { CountUp } from '../motion/count-up';
import { cn } from './cn';

/**
 * Kartu metrik.
 *
 * INI SERVER COMPONENT — dan itu disengaja.
 *
 * Komponen ikon (fungsi) tidak bisa dioper dari Server Component ke Client
 * Component: React tidak bisa menyerialisasinya lewat batas RSC. Kalau kartu
 * ini dibuat 'use client' dan menerima prop `icon`, seluruh halaman gagal
 * dengan 500.
 *
 * Jadi kartunya dirender di server, dan hanya dua bagian yang benar-benar
 * butuh browser dipisah menjadi komponen klien kecil: HoverLift (gerak) dan
 * CountUp (angka menghitung naik). Ini juga mengurangi JavaScript yang dikirim.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-card p-5',
        // Terangkat sedikit saat disapu kursor. Memakai CSS, bukan Motion:
        // efek sesederhana ini tidak sepadan dengan biaya JavaScript-nya.
        'transition-all duration-300 ease-[var(--ease-out-soft)]',
        'hover:-translate-y-[3px] hover:border-line-strong hover:shadow-lift',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        <IconBadge icon={icon} size="sm" tone="muted" />
      </div>
      <div className="tabular mt-4 text-[34px] font-extrabold leading-none tracking-tight">
        <CountUp value={value} />
      </div>
      {hint ? <div className="mt-1.5 text-[13px] text-ink-muted">{hint}</div> : null}
    </div>
  );
}
