'use client';

import { useEffect, useState } from 'react';
import type { DashboardProduksi, KartuLini } from '@avicenna/contracts';
import { muatPapanLiniAction } from '@/app/(app)/produksi/dashboard/actions';
import { cn } from '../ui/cn';

/** Setiap berapa detik papan menyegarkan dirinya. */
const DETIK_SEGAR = 20;

/**
 * Papan monitor per lini.
 *
 * Layar ini menyala sepanjang shift di lantai produksi dan tidak pernah
 * disentuh orang, jadi ia menyegarkan dirinya sendiri. Penyegarannya mengganti
 * data di tempat — bukan memuat ulang halaman — supaya papan tidak berkedip
 * tiap dua puluh detik di depan orang yang sedang bekerja.
 */
export function PapanLini({ awal, plant }: { awal: DashboardProduksi; plant?: string }) {
  const [data, setData] = useState(awal);

  useEffect(() => {
    const t = setInterval(async () => {
      const baru = await muatPapanLiniAction(plant);
      if (baru) setData(baru);
    }, DETIK_SEGAR * 1000);
    return () => clearInterval(t);
  }, [plant]);

  if (data.kartu.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line p-10 text-center text-[15px] text-ink-muted">
        Belum ada lini aktif untuk ditampilkan.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {data.kartu.map((k) => (
        <Kartu key={k.lineCode} k={k} />
      ))}
    </div>
  );
}

function jam(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const dua = (n: number) => String(n).padStart(2, '0');
  return `${dua(d.getDate())}-${dua(d.getMonth() + 1)}-${d.getFullYear()} ${dua(d.getHours())}:${dua(d.getMinutes())}`;
}

/**
 * Satu kartu lini.
 *
 * Warnanya yang pertama terbaca dari jauh: biru berjalan, merah berhenti, abu
 * diam. Teksnya menyusul. Itu sebabnya status tidak hanya ditulis — lini yang
 * berhenti harus terlihat sebelum ada yang membaca satu kata pun.
 */
function Kartu({ k }: { k: KartuLini }) {
  const warna =
    k.status === 'RUNNING'
      ? 'bg-[#1b3a93] text-white'
      : k.status === 'STOP'
        ? 'bg-[#cf3030] text-white'
        : 'bg-line text-ink-soft';

  return (
    <article className={cn('flex min-h-[230px] flex-col rounded-card p-5 text-center', warna)}>
      <h2 className="text-[30px] font-extrabold leading-none tracking-tight">{k.lineCode}</h2>
      <div className="mt-1 text-[15px] font-semibold uppercase tracking-wide opacity-90">
        {k.status}
      </div>

      <div className="mt-4 text-[12px] uppercase tracking-wide opacity-70">Material</div>
      <div className="mt-0.5 line-clamp-3 text-[13px] font-semibold leading-snug">
        {k.partName ?? '-'}
        {k.backNumber ? ` (${k.backNumber})` : ''}
      </div>

      <div className="mt-3 text-[12px] uppercase tracking-wide opacity-70">
        {k.status === 'STOP' ? 'Berhenti sejak' : 'Start Date'}
      </div>
      <div className="tabular text-[13px] font-semibold">
        {k.status === 'STOP' ? jam(k.berhentiSejak) : jam(k.startedAt)}
      </div>
      {k.status === 'STOP' && k.alasanBerhenti ? (
        <div className="mt-0.5 truncate text-[12px] font-semibold opacity-90">
          {k.alasanBerhenti}
        </div>
      ) : null}

      <div className="mt-auto pt-3 text-[12px] uppercase tracking-wide opacity-70">QTY OK</div>
      <div className="tabular text-[26px] font-extrabold leading-none">
        {k.qtyOk.toLocaleString('id-ID')}
      </div>
    </article>
  );
}
