import type { LucideIcon } from 'lucide-react';
import { IconBadge } from './icon-badge';
import { cn } from './cn';

/**
 * Kartu putih bersudut besar — wadah dasar seluruh konten.
 *
 * Sengaja tanpa bayangan dalam keadaan diam; kedalaman datang dari garis tipis
 * saja. Bayangan hanya muncul saat kartu bisa diklik (lihat prop `interactive`),
 * sehingga bayangan menjadi penanda "ini bisa ditekan", bukan hiasan.
 */
export function Card({
  children,
  className,
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-line bg-card',
        interactive &&
          'transition-all duration-300 ease-[var(--ease-out-soft)] hover:border-line-strong hover:shadow-lift',
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * Judul kartu: ikon dalam lingkaran, judul, keterangan opsional, lalu tombol
 * aksi di ujung kanan. Susunan ini konsisten di semua kartu supaya mata tahu
 * ke mana harus mencari aksi.
 */
export function CardHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start gap-4 px-6 py-5', className)}>
      <IconBadge icon={icon} />
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 className="text-[17px] font-bold leading-tight tracking-tight">{title}</h2>
        {subtitle ? <div className="mt-1 text-sm text-ink-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Garis pemisah setipis mungkin, ditarik penuh selebar kartu. */
export function CardDivider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-line', className)} />;
}

export function CardBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('px-6 py-5', className)}>{children}</div>;
}
