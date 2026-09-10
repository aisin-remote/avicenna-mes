import Link from 'next/link';
import { House, ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

/** Jejak navigasi. Ruas terakhir tidak berupa tautan karena itu halaman aktif. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[14px]">
      <Link
        href="/dashboard"
        aria-label="Dashboard"
        className="grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface hover:text-ink"
      >
        <House className="size-4" strokeWidth={1.8} aria-hidden />
      </Link>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-2">
            <ChevronRight className="size-3.5 text-line-strong" strokeWidth={2} aria-hidden />
            {item.href && !last ? (
              <Link
                href={item.href}
                className="text-ink-muted transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ) : (
              <span className={last ? 'font-semibold text-ink' : 'text-ink-muted'}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
