'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Download, RefreshCw, RotateCcw } from 'lucide-react';
import { collectNowAction, pullDeliveryNowAction, retryAction } from '@/app/(app)/sap/actions';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

/**
 * Tombol untuk mengumpulkan sekarang dan mencoba ulang yang gagal.
 *
 * Keduanya sebenarnya berjalan otomatis tiap menit. Tombol ini ada untuk saat
 * seseorang sedang menunggui layar — setelah memperbaiki koneksi, atau setelah
 * mengisi movement type — dan perlu tahu hasilnya sekarang, bukan semenit lagi.
 */
export function OutboxActions({ idGagal, tarikAktif }: { idGagal: number[]; tarikAktif: boolean }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [sibuk, setSibuk] = useState(false);
  const router = useRouter();

  async function kumpulkan() {
    setSibuk(true);
    const res = await collectNowAction();
    setSibuk(false);
    if ('error' in res) return toast.galat(res.error);
    toast.ok(
      `${res.dikumpulkan} dokumen siap kirim, ${res.ditahan} ditahan, ${res.dilewati} dilewati${
        res.dilepas > 0 ? `, ${res.dilepas} dilepas dari tahanan` : ''
      }.`,
    );
    startTransition(() => router.refresh());
  }

  async function ulangi() {
    setSibuk(true);
    const res = await retryAction(idGagal);
    setSibuk(false);
    if ('error' in res) return toast.galat(res.error);
    toast.ok(`${res.diulang} dokumen dikembalikan ke antrean kirim.`);
    startTransition(() => router.refresh());
  }

  async function tarikDelivery() {
    setSibuk(true);
    const res = await pullDeliveryNowAction();
    setSibuk(false);
    if ('error' in res) return toast.galat(res.error);
    toast.ok(
      `${res.dibaca} delivery dibaca, ${res.baru} baru, ${res.diperbarui} diperbarui, ${res.dilewati} dilewati.`,
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void kumpulkan()}
        disabled={sibuk || pending}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
      >
        <RefreshCw className="size-[18px]" strokeWidth={2.2} aria-hidden />
        {sibuk ? 'Memproses…' : 'Kumpulkan sekarang'}
      </button>

      {idGagal.length > 0 ? (
        <button
          type="button"
          onClick={() => void ulangi()}
          disabled={sibuk || pending}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:border-ink disabled:opacity-50"
        >
          <RotateCcw className="size-4" strokeWidth={1.9} aria-hidden />
          Coba ulang {idGagal.length} yang gagal
        </button>
      ) : null}

      {tarikAktif ? (
        <button
          type="button"
          onClick={() => void tarikDelivery()}
          disabled={sibuk || pending}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:border-ink disabled:opacity-50"
        >
          <Download className="size-4" strokeWidth={1.9} aria-hidden />
          Tarik delivery sekarang
        </button>
      ) : null}
    </div>
  );
}
