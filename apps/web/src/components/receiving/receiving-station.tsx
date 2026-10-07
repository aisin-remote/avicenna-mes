'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Keyboard,
  ScanLine,
  Volume2,
  VolumeX,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { ReceivingSession, ReceivingScanOutcome } from '@avicenna/contracts';
import { receivingScanSchema } from '@avicenna/contracts';
import { scanReceivingAction, closeReceivingAction } from '@/app/(app)/receiving/actions';
import { useScanSound } from '@/components/scan/use-scan-sound';
import { usePreferences } from '@/components/shell/preferences-provider';

type PendingScan = { code: string; clientRef: string };
type Feedback = {
  result: ReceivingScanOutcome['result'];
  message: string;
  code: string;
  lineId?: number;
  serial?: number | null;
};

// Android lewat HTTP LAN tidak menyediakan randomUUID; getRandomValues tetap tersedia.
function scanRef() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function ReceivingStation({
  initial,
  userId,
  userName,
}: {
  initial: ReceivingSession;
  userId: number;
  userName: string;
}) {
  const router = useRouter();
  const { prefs } = usePreferences();
  const [sound, setSound] = useState(prefs.scanSound);
  const audio = useScanSound(sound);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const queue = useRef<PendingScan[]>([]);
  const running = useRef(false);
  const paused = useRef(false);
  const pumpRef = useRef<() => Promise<void>>(async () => {});
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [lines, setLines] = useState(initial.lines);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reason, setReason] = useState('');
  const [closeError, setCloseError] = useState('');
  const [closing, setClosing] = useState(false);
  const storageKey = `avicenna:receiving:${userId}:${initial.id}`;
  const boxScanned = lines.reduce((sum, line) => sum + line.boxScanned, 0);
  const boxOrdered = initial.totals.boxOrdered;
  const missing = Math.max(0, boxOrdered - boxScanned);
  const activeLine = lines.find((line) => line.id === feedback?.lineId);

  // Simpan sebelum kirim; hapus hanya setelah server mengakui UUID scan yang sama.
  function persist(next: PendingScan[]) {
    localStorage.setItem(storageKey, JSON.stringify(next));
    queue.current = next;
    setCount(next.length);
  }

  pumpRef.current = async () => {
    if (running.current || paused.current || !queue.current.length) return;
    running.current = true;
    setBusy(true);
    try {
      while (queue.current.length && !paused.current) {
        const scan = queue.current[0]!;
        const outcome = await scanReceivingAction(initial.id, scan.code, scan.clientRef);
        if ('error' in outcome && outcome.retryable) {
          paused.current = true;
          setConnectionError(outcome.error);
          break;
        }
        if ('error' in outcome) {
          setFeedback({ result: 'REJECTED', message: outcome.error, code: scan.code });
          audio.reject();
        } else {
          setFeedback({
            result: outcome.result,
            message: outcome.message,
            code: scan.code,
            lineId: outcome.line?.id,
            serial: outcome.kanbanSerial,
          });
          if (outcome.line)
            setLines((previous) =>
              previous.map((line) =>
                line.id === outcome.line!.id
                  ? {
                      ...line,
                      boxScanned: outcome.line!.boxScanned,
                      pcsReceived: outcome.line!.boxScanned * line.qtyPerBox,
                    }
                  : line,
              ),
            );
          if (outcome.result === 'OK') audio.ok();
          else audio.reject();
        }
        persist(queue.current.slice(1));
      }
    } catch {
      paused.current = true;
      setConnectionError(
        'Belum bisa mengirim atau menyimpan scan. Antrean tidak dihapus; coba kirim ulang.',
      );
    } finally {
      running.current = false;
      setBusy(false);
      input.current?.focus();
    }
  };

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (
        !Array.isArray(saved) ||
        !saved.every((scan) => receivingScanSchema.safeParse(scan).success)
      )
        throw new Error('Antrean tidak valid');
      queue.current = saved as PendingScan[];
      setCount(saved.length);
      setReady(true);
      void pumpRef.current();
      input.current?.focus();
    } catch {
      setConnectionError(
        'Penyimpanan scan perangkat tidak tersedia atau antreannya rusak. Hubungi IT sebelum scan.',
      );
    }
    const retry = () => {
      paused.current = false;
      setConnectionError('');
      void pumpRef.current();
    };
    const beforeLeave = (event: BeforeUnloadEvent) => {
      if (queue.current.length) event.preventDefault();
    };
    window.addEventListener('online', retry);
    window.addEventListener('beforeunload', beforeLeave);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('beforeunload', beforeLeave);
    };
  }, [storageKey]);

  useEffect(() => {
    if (ready) input.current?.focus();
  }, [ready]);

  function enqueue() {
    const value = code.trim();
    if (!value || !ready || closing) return;
    try {
      const scan = receivingScanSchema.parse({ code: value, clientRef: scanRef() });
      persist([...queue.current, scan]);
      setCode('');
      input.current?.focus();
      void pumpRef.current();
    } catch {
      setConnectionError(
        'Barcode belum masuk antrean. Pastikan panjang barcode maksimal 64 karakter dan penyimpanan perangkat tersedia.',
      );
    }
  }

  const tone =
    feedback?.result === 'OK'
      ? 'border-ok/40 bg-ok/10 text-ok'
      : feedback?.result === 'DUPLICATE'
        ? 'border-warn/40 bg-warn/10 text-warn'
        : feedback
          ? 'border-ng/40 bg-ng/10 text-ng'
          : 'border-line bg-card text-ink-muted';
  const Icon =
    feedback?.result === 'OK'
      ? CheckCircle2
      : feedback?.result === 'DUPLICATE'
        ? AlertTriangle
        : feedback
          ? XCircle
          : ScanLine;

  return (
    <main className="flex h-dvh flex-col overflow-hidden text-ink">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-card px-3 py-3 sm:px-6">
        <Link
          href="/receiving"
          aria-label="Kembali ke receiving"
          onClick={(event) => {
            if (queue.current.length) {
              event.preventDefault();
              setConnectionError('Kirim seluruh antrean sebelum meninggalkan sesi.');
            }
          }}
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-line"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-extrabold sm:text-xl">{initial.orderNumber}</h1>
          <p className="truncate text-xs text-ink-muted">
            {initial.supplierName} · {initial.plantCode} · {initial.locationName}
          </p>
        </div>
        <button
          type="button"
          disabled={!ready || count > 0 || busy || closing}
          onClick={() => {
            setCloseError('');
            dialog.current?.showModal();
          }}
          className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-40"
        >
          Tutup sesi
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-5 xl:grid xl:grid-cols-[1fr_1fr_1.4fr] xl:gap-5 xl:overflow-visible">
        <section
          aria-live="polite"
          aria-atomic="true"
          className={`min-w-0 shrink-0 rounded-2xl border p-4 sm:p-5 xl:flex xl:flex-col xl:justify-center ${tone}`}
        >
          <div className="flex items-center gap-3">
            <Icon className="size-8 shrink-0 sm:size-10" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold sm:text-2xl">
                {feedback
                  ? feedback.result === 'OK'
                    ? 'Box diterima'
                    : feedback.result === 'DUPLICATE'
                      ? 'Scan duplikat'
                      : 'Scan ditolak'
                  : 'Menunggu kanban'}
              </h2>
              <p className="mt-1 text-sm">
                {feedback?.message ?? 'Tempelkan barcode kanban ke pemindai.'}
              </p>
            </div>
          </div>
          {activeLine && (
            <div className="mt-3 border-t border-current/15 pt-3">
              <p className="text-xl font-bold text-ink sm:text-3xl">
                {activeLine.backNumber || activeLine.partNumber}
              </p>
              <p className="text-sm text-ink-muted">
                {activeLine.partNumber} · {activeLine.qtyPerBox} pcs/box · kartu{' '}
                {feedback?.serial ?? '—'}
              </p>
            </div>
          )}
          {feedback && !activeLine && (
            <p className="mt-2 break-all font-mono text-xs">{feedback.code}</p>
          )}
        </section>
        <section className="min-w-0 shrink-0 rounded-2xl border border-line bg-card p-4 sm:p-5 xl:flex xl:flex-col xl:justify-center">
          <div className="mb-3 flex items-center justify-between gap-3">
            <label htmlFor="receiving-code" className="text-sm font-bold">
              Scan kanban
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Keyboard manual"
                aria-pressed={manual}
                onClick={() => {
                  setManual(!manual);
                  input.current?.focus();
                }}
                className="grid size-11 place-items-center rounded-xl border border-line"
              >
                <Keyboard className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Suara scan"
                aria-pressed={sound}
                onClick={() => setSound(!sound)}
                className="grid size-11 place-items-center rounded-xl border border-line"
              >
                {sound ? (
                  <Volume2 className="size-5" aria-hidden />
                ) : (
                  <VolumeX className="size-5" aria-hidden />
                )}
              </button>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              enqueue();
            }}
            className="flex gap-2"
          >
            <input
              id="receiving-code"
              ref={input}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={!ready || closing}
              inputMode={manual ? 'text' : 'none'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Scan kanban…"
              className="h-14 min-w-0 flex-1 rounded-xl border-2 border-line bg-surface px-3 font-mono text-base focus:border-accent focus:outline-none"
            />
            <button
              disabled={!ready || closing}
              className="min-h-14 rounded-xl border border-line px-4 text-sm font-bold"
            >
              Scan
            </button>
          </form>
          <p className="mt-2 text-xs text-ink-muted">
            {busy
              ? `Mengirim · ${count} scan dalam antrean`
              : count
                ? `${count} scan belum terkirim`
                : `Siap scan · ${userName}`}
          </p>
          {connectionError && (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm"
            >
              <p>{connectionError}</p>
              {count > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    paused.current = false;
                    setConnectionError('');
                    void pumpRef.current();
                  }}
                  className="mt-2 min-h-11 rounded-lg border border-line px-3 font-bold"
                >
                  Kirim ulang
                </button>
              )}
            </div>
          )}
        </section>
        <section className="flex min-h-32 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-card xl:min-h-0">
          <div className="shrink-0 border-b border-line p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold">Item Order Sheet</h2>
              <p className="font-bold">
                <span className="text-ok">{boxScanned}</span> / {boxOrdered}{' '}
                <span className="text-xs text-ink-muted">box</span>
              </p>
            </div>
            <progress
              value={boxScanned}
              max={boxOrdered || 1}
              aria-label="Box diterima"
              className="mt-2 h-2 w-full accent-[var(--color-ok)]"
            />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {lines.map((line) => (
              <li
                key={line.id}
                className={`mb-2 rounded-xl border p-3 ${feedback?.lineId === line.id ? 'border-ok/40 bg-ok/5' : 'border-line bg-surface'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-extrabold">{line.backNumber || line.partNumber}</p>
                    <p className="break-all text-xs text-ink-muted">{line.partNumber}</p>
                  </div>
                  <p
                    className={`shrink-0 text-lg font-extrabold ${line.boxScanned === line.boxOrdered ? 'text-ok' : 'text-ink'}`}
                  >
                    {line.boxScanned}
                    <span className="text-sm font-normal text-ink-muted"> / {line.boxOrdered}</span>
                  </p>
                </div>
                <p className="mt-1 truncate text-xs text-ink-muted">{line.partName}</p>
                <p className="mt-2 text-xs">
                  {line.qtyPerBox} pcs/box · {line.pcsReceived.toLocaleString('id-ID')} pcs diterima
                  {line.boxScanned < line.boxOrdered
                    ? ` · kurang ${line.boxOrdered - line.boxScanned} box`
                    : ' · Lengkap'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <dialog
        ref={dialog}
        onClose={() => input.current?.focus()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-card p-5 text-ink backdrop:bg-black/60"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (queue.current.length || running.current || closing) return;
            setClosing(true);
            setCloseError('');
            try {
              const result = await closeReceivingAction(initial.id, reason);
              if ('error' in result) setCloseError(result.error);
              else {
                dialog.current?.close();
                router.replace(`/receiving/${initial.id}`);
              }
            } finally {
              setClosing(false);
            }
          }}
        >
          <h2 className="text-xl font-bold">Tutup receiving?</h2>
          <p className="mt-2 text-sm text-ink-muted">
            {boxScanned} dari {boxOrdered} box diterima.{' '}
            {missing
              ? `Masih kurang ${missing} box; sesi akan selesai parsial.`
              : 'Semua box sudah lengkap.'}{' '}
            Stok masuk sesuai hasil scan, bukan jumlah pesanan.
          </p>
          <label className="mt-4 block text-sm font-bold">
            {missing ? 'Alasan kekurangan (wajib)' : 'Catatan (opsional)'}
            <textarea
              required={missing > 0}
              maxLength={255}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 min-h-24 w-full rounded-xl border border-line bg-surface p-3 text-base font-normal"
            />
          </label>
          {closeError && (
            <p role="alert" className="mt-3 text-sm text-ng">
              {closeError}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              disabled={closing}
              onClick={() => dialog.current?.close()}
              className="min-h-12 rounded-xl border border-line px-4"
            >
              Kembali
            </button>
            <button
              disabled={closing}
              className="min-h-12 rounded-xl bg-accent px-4 font-bold text-white disabled:opacity-50"
            >
              {closing ? 'Menyimpan…' : 'Konfirmasi tutup'}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
