import type { LucideIcon } from 'lucide-react';
import { IconBadge } from './icon-badge';
import { cn } from './cn';

/**
 * Baris informasi: ikon bulat, label tebal, lalu nilainya di bawah.
 *
 * Label dan nilai ditumpuk (bukan bersebelahan) supaya baris tetap terbaca
 * pada layar sempit tanpa perlu tabel dua kolom yang mudah pecah.
 */
export function InfoRow({
  icon,
  label,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-4 px-6 py-4', className)}>
      <IconBadge icon={icon} tone="muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold leading-snug tracking-tight">{label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-ink-soft">
          {children}
        </div>
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </div>
  );
}

/** Dua InfoRow berdampingan pada layar lebar, menumpuk saat sempit. */
export function InfoRowPair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2">{children}</div>;
}

/** Pemisah antar nilai dalam satu baris, mis. daftar klub. */
export function Sep() {
  return <span className="text-line-strong">/</span>;
}
