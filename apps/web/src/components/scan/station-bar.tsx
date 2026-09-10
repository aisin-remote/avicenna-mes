'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';

/**
 * Bilah atas layar stasiun.
 *
 * Isinya dijaga seminimal mungkin: identitas line, jam, operator, dan satu
 * jalan keluar. Jam ditampilkan karena layar ini sering jadi satu-satunya yang
 * menyala di area kerja, dan operator memakainya untuk menandai pergantian
 * shift.
 */
export function StationBar({
  lineName,
  lineCode,
  processType,
  plantName,
  userName,
  npk,
}: {
  lineName: string;
  lineCode: string;
  processType: string;
  plantName: string | null;
  userName: string;
  npk: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Dimulai setelah render agar tidak ada beda jam antara server dan browser.
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-shell px-6 py-4">
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span className="text-[26px] font-extrabold leading-none tracking-tight">
            {lineName}
          </span>
          <span className="rounded-full border border-line px-3 py-1 text-[12px] font-semibold">
            {processType}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] text-ink-muted">
          Line {lineCode}
          {plantName ? ` · ${plantName}` : ''} — pastikan barcode discan pada line yang benar
        </div>
      </div>

      <div className="ml-auto flex items-center gap-6">
        <div className="text-right">
          <div className="tabular text-[26px] font-bold leading-none">
            {now ? now.toLocaleTimeString('id-ID', { hour12: false }) : '--:--:--'}
          </div>
          <div className="mt-1 text-[12px] text-ink-muted">
            {now
              ? now.toLocaleDateString('id-ID', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : ''}
          </div>
        </div>

        <div className="hidden h-10 w-px bg-line sm:block" aria-hidden />

        <div className="text-right">
          <div className="text-[14px] font-bold leading-tight">{userName}</div>
          <div className="tabular text-[12px] text-ink-muted">NPK {npk}</div>
        </div>

        <Link
          href="/scan"
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-[14px] font-semibold transition-colors hover:border-line-strong hover:bg-surface"
        >
          <LogOut className="size-4" strokeWidth={1.9} aria-hidden />
          Ganti line
        </Link>
      </div>
    </header>
  );
}
