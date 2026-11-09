'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import type { HasilSalinBom } from '@avicenna/contracts';
import { salinBomAction } from '@/app/(app)/master/actions';
import { useToast } from '../ui/toast';

/**
 * Menyalin BOM SAP ke Part Pairing, lalu menampilkan apa yang berubah.
 *
 * Baris yang dilewati ikut ditampilkan, karena part yang belum ada di master
 * berarti rantainya terputus dan scan tidak bisa menemukan part tahapnya.
 */
export function TombolSalinBom() {
  const [pending, startTransition] = useTransition();
  const [hasil, setHasil] = useState<Extract<HasilSalinBom, { tersedia: true }> | null>(null);
  const router = useRouter();
  const toast = useToast();

  function salin() {
    startTransition(async () => {
      const res = await salinBomAction();
      if ('error' in res) {
        toast.galat(res.error, 'BOM tidak tersalin');
        return;
      }
      if (!res.tersedia) {
        toast.galat(res.galat, 'BOM tidak tersalin');
        return;
      }
      setHasil(res);
      toast.ok(`Part Pairing diperbarui: ${res.ditambah} ditambah, ${res.diakhiri} diakhiri.`);
      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-[240px] flex-1 text-[13px] text-ink-soft">
          Scan memilih part tiap tahap (DC, MA, AS) dari rantai Part Pairing. Salin ulang setiap
          kali BOM di SAP berubah.
        </p>
        <button
          type="button"
          onClick={salin}
          disabled={pending}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-[14px] font-semibold transition-colors hover:bg-surface disabled:opacity-60"
        >
          <RefreshCw className={pending ? 'size-4 animate-spin' : 'size-4'} strokeWidth={2} aria-hidden />
          Salin BOM ke Part Pairing
        </button>
      </div>
      {hasil ? (
        <div className="mt-3 border-t border-line pt-3 text-[13px]">
          <p>
            {hasil.induk} induk · {hasil.ditambah} ditambah · {hasil.diakhiri} diakhiri ·{' '}
            {hasil.tetap} tetap
          </p>
          {hasil.dilewati.length ? (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-warn">
                {hasil.dilewati.length} baris BOM dilewati
              </summary>
              <ul className="mt-1.5 space-y-0.5 text-ink-muted">
                {hasil.dilewati.map((d) => (
                  <li key={`${d.induk}>${d.komponen}`} className="tabular">
                    {d.induk} → {d.komponen}: {d.sebab}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
