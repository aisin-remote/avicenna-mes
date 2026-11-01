'use client';

import { useState, useTransition } from 'react';
import { Printer } from 'lucide-react';
import type { PratinjauCetakKanban } from '@avicenna/contracts';
import { buatKanbanAction } from '@/app/(app)/produksi/kanban/actions';
import { useToast } from '../ui/toast';

/**
 * Tombol "Buat & Cetak".
 *
 * Membuat barisnya lebih dulu, lalu membuka lembar cetak di tab baru. Dua
 * langkah, bukan satu halaman yang membuat baris saat dirender: halaman cetak
 * yang menulis akan membuat baris baru setiap kali orang menekan muat-ulang
 * atau mencetak kartu sobek bulan depan.
 */
export function TombolBuatCetak({ pratinjau }: { pratinjau: PratinjauCetakKanban }) {
  const [pending, mulai] = useTransition();
  const [selesai, setSelesai] = useState(false);
  const toast = useToast();

  const alamat =
    `/produksi/kanban/cetak?partId=${pratinjau.part.id}` +
    `&dari=${pratinjau.dari}&sampai=${pratinjau.sampai}`;

  function jalan() {
    mulai(async () => {
      const hasil = await buatKanbanAction({
        partId: pratinjau.part.id,
        dari: pratinjau.dari,
        sampai: pratinjau.sampai,
      });
      if ('error' in hasil) {
        toast.galat(hasil.error, 'Kartu tidak dibuat');
        return;
      }
      setSelesai(true);
      toast.ok(
        `${hasil.dibuat} kartu baru, ${hasil.sudahAda} sudah ada sebelumnya.`,
        'Master kanban siap',
      );
      /*
       * Tab baru, bukan navigasi di tab ini: setelah mencetak, OMD hampir
       * selalu kembali ke layar ini untuk rentang berikutnya.
       */
      window.open(alamat, '_blank', 'noopener');
    });
  }

  const terhalang = pratinjau.penghalang.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={jalan}
        disabled={pending || terhalang}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
      >
        <Printer className="size-[18px]" strokeWidth={2.2} aria-hidden />
        {pending ? 'Menyiapkan…' : `Buat & cetak ${pratinjau.total} kartu`}
      </button>

      {/* Setelah dibuat, lembarnya bisa dibuka lagi tanpa membuat baris baru. */}
      {selesai ? (
        <a
          href={alamat}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 items-center rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:bg-surface"
        >
          Buka lembar cetak lagi
        </a>
      ) : null}
    </div>
  );
}
