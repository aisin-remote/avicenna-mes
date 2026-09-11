'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { collectNowAction, retryAction } from '@/app/(app)/sap/actions';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

/**
 * Tombol untuk mengumpulkan sekarang dan mencoba ulang yang gagal.
 *
 * Keduanya sebenarnya berjalan otomatis tiap menit. Tombol ini ada untuk saat
 * seseorang sedang menunggui layar — setelah memperbaiki koneksi, atau setelah
 * mengisi movement type — dan perlu tahu hasilnya sekarang, bukan semenit lagi.
 */
export function OutboxActions({ idGagal }: { idGagal: number[] }) {
  const [pesan, setPesan] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [sibuk, setSibuk] = useState(false);
  const router = useRouter();

  async function kumpulkan() {
    setSibuk(true);
    const res = await collectNowAction();
    setSibuk(false);
    if ('error' in res) return setPesan({ tone: 'bad', text: res.error });
    setPesan({
      tone: 'ok',
      text: `${res.dikumpulkan} dokumen siap kirim, ${res.ditahan} ditahan, ${res.dilewati} dilewati${
        res.dilepas > 0 ? `, ${res.dilepas} dilepas dari tahanan` : ''
      }.`,
    });
    startTransition(() => router.refresh());
  }

  async function ulangi() {
    setSibuk(true);
    const res = await retryAction(idGagal);
    setSibuk(false);
    if ('error' in res) return setPesan({ tone: 'bad', text: res.error });
    setPesan({ tone: 'ok', text: `${res.diulang} dokumen dikembalikan ke antrean kirim.` });
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

      <AnimatePresence>
        {pesan ? (
          <motion.p
            key={pesan.text}
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className={cn(
              'flex items-center gap-2 text-[14px]',
              pesan.tone === 'ok' ? 'text-ok' : 'text-ng',
            )}
          >
            {pesan.tone === 'ok' ? (
              <Check className="size-4 shrink-0" strokeWidth={2.4} aria-hidden />
            ) : (
              <AlertCircle className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            )}
            {pesan.text}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
