'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Truck, Check, AlertCircle, Ban, AlertTriangle } from 'lucide-react';
import {
  shipLoadingAction,
  setTruckStatusAction,
  cancelLoadingAction,
  type ShipResult,
} from '@/app/(app)/delivery/actions';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

const TRUCK_STEPS = [
  { value: 'PENDING', label: 'Belum datang' },
  { value: 'ARRIVED', label: 'Sudah datang' },
  { value: 'LOADING', label: 'Sedang dimuat' },
  { value: 'DEPARTED', label: 'Sudah berangkat' },
] as const;

/**
 * Tombol-tombol keputusan pada satu loading list.
 *
 * Menutup dokumen adalah tindakan yang mengurangi stok dan tidak bisa
 * dibatalkan, jadi dimintakan konfirmasi lebih dulu — beserta angka yang akan
 * dipakai, karena yang tercatat adalah jumlah AKTUAL hasil scan, bukan rencana.
 */
export function LoadingActions({
  id,
  status,
  truckStatus,
  totalActual,
  totalPlanned,
}: {
  id: number;
  status: string;
  truckStatus: string;
  totalActual: number;
  totalPlanned: number;
}) {
  const [confirming, setConfirming] = useState<'ship' | 'cancel' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [shortages, setShortages] = useState<ShipResult['shortages']>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const closed = status === 'SHIPPED' || status === 'RECEIVED' || status === 'CANCELLED';

  async function ship() {
    setConfirming(null);
    const res = await shipLoadingAction(id);
    if ('error' in res) return setMessage({ tone: 'bad', text: res.error });
    setShortages(res.shortages);
    setMessage({
      tone: 'ok',
      text: `${res.documentNumber} dinyatakan berangkat — ${res.shippedLines} baris keluar stok.`,
    });
    startTransition(() => router.refresh());
  }

  async function cancel() {
    setConfirming(null);
    const res = await cancelLoadingAction(id);
    if ('error' in res) return setMessage({ tone: 'bad', text: res.error });
    setMessage({ tone: 'ok', text: 'Loading list dibatalkan.' });
    startTransition(() => router.refresh());
  }

  async function setTruck(value: (typeof TRUCK_STEPS)[number]['value']) {
    const res = await setTruckStatusAction(id, value);
    if ('error' in res) return setMessage({ tone: 'bad', text: res.error });
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {!closed ? (
        <section className="rounded-card border border-line bg-card p-5">
          <h2 className="text-[15px] font-bold">Status truk</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Terpisah dari status dokumen — truk bisa datang sebelum barangnya dimuat.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {TRUCK_STEPS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => void setTruck(s.value)}
                disabled={pending}
                className={cn(
                  'h-10 rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:opacity-50',
                  truckStatus === s.value
                    ? 'border-accent bg-accent text-white'
                    : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {shortages.length > 0 ? (
        <section className="rounded-card border border-warn/40 bg-warn/10 p-5">
          <p className="flex items-center gap-2 text-[15px] font-bold text-warn">
            <AlertTriangle className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
            Stok tercatat tidak cukup
          </p>
          <p className="mt-1 text-[14px] text-warn">
            Pengiriman tetap dicatat — barangnya sudah naik truk. Selisih ini perlu ditelusuri:
            kemungkinan ada produksi atau penerimaan yang belum tercatat.
          </p>
          <ul className="tabular mt-3 space-y-1 text-[14px] text-warn">
            {shortages.map((s) => (
              <li key={s.partId}>
                <span className="font-semibold">{s.partNumber}</span> — kirim{' '}
                {s.needed.toLocaleString('id-ID')}, tercatat {s.available.toLocaleString('id-ID')}{' '}
                (kurang {s.short.toLocaleString('id-ID')})
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AnimatePresence>
        {message ? (
          <motion.p
            key={message.text}
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className={cn(
              'flex items-center gap-2 text-[14px]',
              message.tone === 'ok' ? 'text-ok' : 'text-ng',
            )}
          >
            {message.tone === 'ok' ? (
              <Check className="size-4 shrink-0" strokeWidth={2.4} aria-hidden />
            ) : (
              <AlertCircle className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            )}
            {message.text}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {!closed ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setConfirming('ship')}
            disabled={pending || totalActual === 0}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[15px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Truck className="size-[18px]" strokeWidth={2.2} aria-hidden />
            Nyatakan berangkat
          </button>
          <button
            type="button"
            onClick={() => setConfirming('cancel')}
            disabled={pending}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-line px-6 text-[15px] font-semibold text-ink-muted transition-colors hover:border-ng/40 hover:text-ng disabled:opacity-50"
          >
            <Ban className="size-[18px]" strokeWidth={1.9} aria-hidden />
            Batalkan
          </button>
          {totalActual === 0 ? (
            <span className="text-[13px] text-ink-muted">
              Belum ada kanban yang discan — muat barangnya dulu.
            </span>
          ) : null}
        </div>
      ) : null}

      <AnimatePresence>
        {confirming ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="rounded-card border border-line bg-card p-5"
          >
            {confirming === 'ship' ? (
              <>
                <p className="text-[15px] font-bold">Nyatakan berangkat?</p>
                {/* Angka aktual ditegaskan di sini: yang keluar stok adalah yang
                    benar-benar discan, bukan rencananya. */}
                <p className="mt-1 text-[14px] text-ink-soft">
                  Stok akan berkurang sesuai jumlah yang benar-benar discan —{' '}
                  <span className="tabular font-semibold text-ink">{totalActual} kanban</span> dari
                  rencana {totalPlanned}. Setelah ini dokumen tidak bisa diubah lagi; koreksi harus
                  dicatat sebagai penyesuaian stok.
                </p>
              </>
            ) : (
              <>
                <p className="text-[15px] font-bold">Batalkan loading list?</p>
                <p className="mt-1 text-[14px] text-ink-soft">
                  Dokumen ditandai dibatalkan dan tidak bisa discan lagi. Stok tidak berubah.
                </p>
              </>
            )}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void (confirming === 'ship' ? ship() : cancel())}
                className={cn(
                  'inline-flex h-11 items-center rounded-full px-6 text-[14px] font-semibold text-white transition-colors',
                  confirming === 'ship' ? 'bg-accent hover:bg-accent-soft' : 'bg-ng hover:opacity-90',
                )}
              >
                Ya, lanjutkan
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="inline-flex h-11 items-center rounded-full border border-line px-6 text-[14px] font-semibold transition-colors hover:border-ink"
              >
                Kembali
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
