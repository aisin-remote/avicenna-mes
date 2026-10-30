'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  completePickingAction,
  setTruckStatusAction,
  type ShipResult,
} from '@/app/(app)/delivery/actions';
export function LoadingActions({
  id,
  status,
  truckStatus,
  totalPicked,
  flowStarted = false,
}: {
  id: number;
  status: string;
  truckStatus: string;
  totalPlanned: number;
  totalPicked: number;
  totalActual: number;
  flowStarted?: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shortages, setShortages] = useState<ShipResult['shortages']>([]);
  if (['SHIPPED', 'RECEIVED', 'CANCELLED'].includes(status)) return null;
  const picking = ['DRAFT', 'PICKING'].includes(status);
  async function finish() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await completePickingAction(id);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setShortages(result.shortages);
      setConfirm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function truck(value: 'PENDING' | 'ARRIVED' | 'LOADING') {
    if (busy) return;
    setBusy(true);
    try {
      const result = await setTruckStatusAction(id, value);
      if ('error' in result) setError(result.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-card border border-line bg-card p-5">
      <div>
        <h2 className="font-bold">Status truk</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              { value: 'PENDING', label: 'Belum datang' },
              { value: 'ARRIVED', label: 'Sudah datang' },
              { value: 'LOADING', label: 'Sedang dimuat' },
            ] as const
          ).map((s) => (
            <button
              key={s.value}
              disabled={busy}
              onClick={() => void truck(s.value)}
              className={`min-h-11 rounded-full border px-4 text-sm ${truckStatus === s.value ? 'border-accent bg-accent text-white' : 'border-line'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {picking ? (
        <>
          <button
            disabled={busy || totalPicked === 0}
            onClick={() => setConfirm(true)}
            className="min-h-12 rounded-full bg-accent px-6 font-bold text-white disabled:opacity-40"
          >
            Finish Pulling
          </button>
          {confirm ? (
            <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
              <p className="font-semibold">Selesaikan pulling {totalPicked} kanban?</p>
              <p className="mt-1 text-sm text-ink-muted">
                Qty aktual dipindahkan ke staging. GI AIIA diproses setelah seluruh loading list PDS
                selesai. Surat jalan menunggu GI AIIA dan GR AII berhasil.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  disabled={busy}
                  onClick={() => void finish()}
                  className="min-h-11 rounded-full bg-accent px-5 font-bold text-white"
                >
                  {busy ? 'Memproses…' : 'Ya, Finish Pulling'}
                </button>
                <button disabled={busy} onClick={() => setConfirm(false)} className="min-h-11 px-4">
                  Kembali
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div>
          <p className="text-sm text-ink-muted">
            Keberangkatan dicatat melalui scan driver, setelah GI AIIA dan GR AII berhasil.
          </p>
          {!flowStarted ? (
            <button
              disabled={busy}
              onClick={() => void finish()}
              className="mt-3 min-h-11 rounded-full border border-line px-5"
            >
              Mulai alur SAP AIIA → AII
            </button>
          ) : null}
          <Link
            href="/delivery-return"
            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold"
          >
            Buka Absensi Driver
          </Link>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-ng">
          {error}
        </p>
      ) : null}
      {shortages.length ? (
        <div role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-4">
          <p className="font-semibold text-warn">Saldo gudang kurang saat pulling:</p>
          {shortages.map((s) => (
            <p key={s.partId} className="text-sm">
              {s.partNumber}: perlu {s.needed}, tersedia {s.available}, kurang {s.short}.
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
