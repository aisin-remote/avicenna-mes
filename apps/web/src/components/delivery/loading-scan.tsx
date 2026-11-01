'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import { completePickingAction } from '@/app/(app)/delivery/actions';
import Link from 'next/link';
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Volume2,
  VolumeX,
  Undo2,
  Pause,
} from 'lucide-react';
import type { LoadingPhase, LoadingScanResult } from '@avicenna/contracts';
import { bacaKanban } from '@avicenna/domain';
import { scanKanbanAction, undoKanbanAction } from '@/app/(app)/delivery/actions';
import type { LoadingDetail } from '@/lib/loading-api';
import { useScanSound } from '../scan/use-scan-sound';
import { usePreferences } from '../shell/preferences-provider';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

interface LineState {
  id: number;
  /** Loading list pemilik item; pada pulling per manifest tiap item bisa berbeda. */
  deliveryId: number;
  partNumber: string | null;
  partName: string | null;
  customerPartNumber: string | null;
  /** Sasaran tahap ini: rencana saat pulling, hasil pulling saat muat. */
  plannedKanban: number;
  actualKanban: number;
  qtyPerKanban: number;
  orderedKanban: number;
  plannedQty: number;
  uom: string | null;
}

interface QueuedScan {
  customerPart: string;
  internalKanban?: string;
  clientRef: string;
}

/** Kata-kata yang berbeda antara kedua tahap. Sisanya identik. */
const KATA = {
  PULLING: {
    judul: 'Scan kanban customer',
    sisa: 'Sisa diambil',
    muatan: 'Yang harus diambil',
    selesai:
      'Semua kanban sudah diambil. Tekan Finish Pulling untuk melanjutkan GI AIIA dan GR AII.',
  },
  LOADING: {
    judul: 'Scan kanban customer',
    sisa: 'Sisa kanban',
    muatan: 'Muatan',
    selesai:
      'Semua kanban sudah cocok. Selesaikan pengiriman di halaman Delivery untuk membuat antrean Good Issue lokal.',
  },
} as const;

/**
 * Layar muat barang — satu kanban satu scan.
 *
 * Mengikuti aturan yang sama dengan layar stasiun produksi:
 *  1. Fokus SELALU kembali ke input, dan input tidak pernah di-disable —
 *     scanner mengetik lalu menekan Enter, kalau fokus lepas scan berikutnya
 *     hilang tanpa jejak.
 *  2. Status terbaca dari jarak beberapa meter, karena orang yang men-scan
 *     berdiri di dekat truk, bukan di depan layar.
 *  3. Hasilnya terdengar — tangan sedang memegang kanban, mata melihat barang.
 *
 * Perbedaannya dengan layar produksi: di sini yang penting bukan hanya
 * "diterima atau tidak", melainkan SISA — berapa kanban lagi yang harus naik ke
 * truk. Itu yang ditaruh paling besar.
 */
export function LoadingScan({
  docs,
  phase = 'LOADING',
}: {
  /** Satu loading list, atau semua loading list terbuka dalam satu manifest. */
  docs: LoadingDetail[];
  phase?: LoadingPhase;
}) {
  const doc = docs[0]!;
  const ids = docs.map((d) => d.id);
  const manifestGroup = docs.length > 1;
  const kata = KATA[phase];
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishWarning, setFinishWarning] = useState('');
  const [code, setCode] = useState('');
  const [lines, setLines] = useState<LineState[]>(
    docs.flatMap((d) => d.lines.map((l) => toLineState(l, phase, d.id))),
  );
  const [result, setResult] = useState<LoadingScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoLine, setUndoLine] = useState<number | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoBusy, setUndoBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [customerKanban, setCustomerKanban] = useState<string | null>(null);
  const [currentScan, setCurrentScan] = useState<{
    customer: string | null;
    internal: string | null;
  }>({ customer: null, internal: null });
  // Diawali dari preferensi tersimpan, lalu masih bisa dimatikan sesaat dari
  // layar ini tanpa mengubah pengaturan perangkat.
  const { prefs } = usePreferences();
  const [soundOn, setSoundOn] = useState(prefs.scanSound);

  /*
   * Preferensi tersimpan baru terbaca setelah komponen terpasang — membaca
   * localStorage saat render akan membuat hasil render server dan klien
   * berbeda. Nilai awal useState karena itu selalu bawaan, dan efek inilah
   * yang menyusulkan pilihan yang sebenarnya.
   */
  useEffect(() => {
    setSoundOn(prefs.scanSound);
  }, [prefs.scanSound]);

  const inputRef = useRef<HTMLInputElement>(null);
  const undoDialog = useRef<HTMLDialogElement>(null);
  const queue = useRef<QueuedScan[]>([]);
  const queueKey = `delivery-scan:${ids.join('-')}:${phase}`;
  const draining = useRef(false);
  const sound = useScanSound(soundOn);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(queueKey) ?? '[]');
      if (Array.isArray(stored)) {
        queue.current = stored.filter(
          (scan): scan is QueuedScan =>
            typeof scan?.customerPart === 'string' &&
            typeof scan?.clientRef === 'string' &&
            (scan.internalKanban === undefined || typeof scan.internalKanban === 'string'),
        );
        setPending(queue.current.length);
      }
    } catch {
      setError('Antrean tersimpan tidak terbaca. Periksa progres sebelum scan ulang.');
    }
  }, [queueKey]);

  function persistQueue() {
    setPending(queue.current.length);
    try {
      if (queue.current.length) localStorage.setItem(queueKey, JSON.stringify(queue.current));
      else localStorage.removeItem(queueKey);
    } catch {
      setError('Antrean belum tersimpan di perangkat. Jangan tutup halaman sampai terkirim.');
    }
  }

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    if (undoLine === null) undoDialog.current?.close();
    else if (!undoDialog.current?.open) undoDialog.current?.showModal();
  }, [undoLine]);

  // Fokus dikembalikan setelah render dan setelah dialog koreksi ditutup.
  useEffect(() => {
    if (!busy && undoLine === null) focusInput();
  }, [busy, undoLine, focusInput]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (undoDialog.current?.open) return;
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('input')) return;
      setTimeout(focusInput, 0);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [focusInput]);

  /*
   * Scan dimasukkan ke antrean, tidak pernah dibuang.
   *
   * Pemindai barcode mengetik lalu menekan Enter secepat orang menempelkan
   * kanban — jauh lebih cepat daripada satu perjalanan ke server. Menolak
   * scan yang datang saat permintaan sebelumnya masih terbang berarti kanban
   * itu naik ke truk tanpa pernah tercatat, dan tidak ada yang menyadarinya
   * sampai customer menghitung ulang. Antrean membuat urutannya tetap terjaga
   * dan tidak ada yang hilang.
   */
  const threeWay = doc.loadingMode === 'TIGA_ARAH';
  const scanTitle = threeWay && customerKanban ? 'Scan kanban internal' : kata.judul;

  function acceptScan(raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (threeWay && !customerKanban) {
      setCustomerKanban(value);
      setCurrentScan({ customer: displayKanban(value), internal: null });
      setCode('');
      setError(null);
      setResult(null);
      return;
    }

    setCurrentScan((current) =>
      threeWay
        ? { ...current, internal: displayKanban(value) }
        : { customer: displayKanban(value), internal: null },
    );
    queue.current.push({
      customerPart: customerKanban ?? value,
      clientRef:
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
      ...(threeWay ? { internalKanban: value } : {}),
    });
    if (threeWay) setCustomerKanban(null);
    persistQueue();
    setCode('');
    void drain();
  }

  async function drain() {
    if (draining.current) return;
    draining.current = true;
    setBusy(true);
    try {
      while (queue.current.length > 0) {
        const value = queue.current[0]!;
        setCurrentScan({
          customer: displayKanban(value.customerPart),
          internal: value.internalKanban ? displayKanban(value.internalKanban) : null,
        });

        const res = await scanKanbanAction({
          deliveryId: doc.id,
          phase,
          customerPart: value.customerPart,
          ...(value.internalKanban ? { internalKanban: value.internalKanban } : {}),
          // Kunci idempoten dari sisi klien: kalau jaringan putus dan
          // permintaan dikirim ulang, kanban yang sama tidak terhitung dua kali.
          clientRef: value.clientRef,
          // Server yang memilih loading list tujuan di dalam manifest.
          ...(manifestGroup ? { groupDeliveryIds: ids } : {}),
        });

        if ('error' in res) {
          setError(res.error);
          setResult(null);
          sound.reject();
          if (res.retryable) break;
          queue.current.shift();
          persistQueue();
          continue;
        }

        queue.current.shift();
        persistQueue();
        setError(null);
        setResult(res);
        if (res.status === 'REJECTED') sound.reject();
        else sound.ok();

        if (res.status !== 'REJECTED' && res.lineId !== null) {
          setLines((prev) =>
            prev.map((l) => (l.id === res.lineId ? { ...l, actualKanban: res.actualKanban } : l)),
          );
        }
      }
    } catch {
      setError('Koneksi terputus. Scan tetap tersimpan; tekan Kirim ulang saat koneksi kembali.');
    } finally {
      draining.current = false;
      setBusy(false);
    }
  }

  async function undo(lineId: number) {
    if (draining.current || queue.current.length) {
      setError('Selesaikan antrean scan sebelum melakukan koreksi.');
      return;
    }
    setUndoReason('');
    setError(null);
    setUndoLine(lineId);
  }

  async function submitUndo() {
    const reason = undoReason.trim();
    if (undoLine === null || undoBusy || reason.length < 3) return;
    setUndoBusy(true);
    try {
      const owner = lines.find((line) => line.id === undoLine)?.deliveryId ?? doc.id;
      const res = await undoKanbanAction(owner, undoLine, phase, reason);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setError(null);
      setResult(null);
      setCurrentScan({ customer: null, internal: null });
      setLines((prev) =>
        prev.map((l) => (l.id === undoLine ? { ...l, actualKanban: res.actualKanban } : l)),
      );
      setUndoLine(null);
    } finally {
      setUndoBusy(false);
    }
  }

  const totalPlanned = lines.reduce((s, l) => s + l.plannedKanban, 0);
  const totalActual = lines.reduce((s, l) => s + l.actualKanban, 0);
  const remaining = Math.max(0, totalPlanned - totalActual);
  const done = remaining === 0 && totalPlanned > 0;

  async function finishPulling() {
    if (busy || pending > 0 || finishing || customerKanban) return;
    setFinishing(true);
    // Satu manifest ditutup per loading list; yang gagal dilaporkan dengan nomornya.
    const shortages = [];
    for (const d of docs) {
      const result = await completePickingAction(d.id);
      if ('error' in result) {
        setError(manifestGroup ? `${d.documentNumber}: ${result.error}` : result.error);
        setFinishing(false);
        return;
      }
      shortages.push(...result.shortages);
    }
    if (shortages.length) {
      setFinishWarning(
        `Pulling selesai, tetapi saldo gudang kurang: ${shortages.map((s) => `${s.partNumber} perlu ${s.needed}, tersedia ${s.available}, kurang ${s.short}`).join('; ')}.`,
      );
      return;
    }
    router.push(`/delivery/${doc.id}`);
  }

  if (finishWarning)
    return (
      <section className="rounded-2xl border border-warn/40 bg-warn/10 p-5">
        <h2 className="font-bold text-warn">Periksa saldo gudang</h2>
        <p role="alert" className="mt-3 text-sm">
          {finishWarning}
        </p>
        <Link
          href={`/delivery/${doc.id}`}
          className="mt-4 inline-flex min-h-12 items-center rounded-full border border-line px-5 font-semibold"
        >
          Lihat status pengiriman
        </Link>
      </section>
    );

  // Warna tile kanban mengikuti hasil scan terakhir, seperti stasiun pulling lama.
  const scanTone: TileTone = error
    ? 'bad'
    : result
      ? result.status === 'ACCEPTED'
        ? 'ok'
        : result.status === 'OVER'
          ? 'warn'
          : 'bad'
      : 'default';
  // Hasil pasangan terakhir tetap terlihat; tanda "giliran scan" kembali setelah layar bersih.
  const customerTone: TileTone = customerKanban
    ? 'ok'
    : currentScan.customer && (result || error)
      ? scanTone
      : threeWay
        ? 'active'
        : 'default';
  const internalTone: TileTone = !threeWay
    ? 'muted'
    : customerKanban
      ? 'active'
      : currentScan.internal
        ? scanTone
        : 'default';

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-4 md:grid-cols-2 md:items-start md:gap-x-8 md:gap-y-5">
      <dialog
        ref={undoDialog}
        aria-labelledby="undo-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!undoBusy) setUndoLine(null);
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-card border border-line bg-card p-5 text-ink shadow-shell backdrop:bg-black/40"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitUndo();
          }}
        >
          <h2 id="undo-title" className="text-[18px] font-bold">
            Batalkan satu kanban
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {lines.find((line) => line.id === undoLine)?.partNumber} · Koreksi dicatat dalam audit.
          </p>
          <label htmlFor="undo-reason" className="mt-4 block text-[14px] font-semibold">
            Alasan koreksi
          </label>
          <input
            id="undo-reason"
            autoFocus
            required
            minLength={3}
            maxLength={255}
            value={undoReason}
            onChange={(e) => setUndoReason(e.target.value)}
            disabled={undoBusy}
            className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3 text-[16px] outline-none focus:border-accent"
          />
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-ng">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={undoBusy}
              onClick={() => setUndoLine(null)}
              className="h-12 rounded-full border border-line px-5 text-[14px] font-semibold disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={undoBusy || undoReason.trim().length < 3}
              className="h-12 rounded-full bg-accent px-5 text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {undoBusy ? 'Menyimpan…' : 'Simpan koreksi'}
            </button>
          </div>
        </form>
      </dialog>

      {/* ── Kiri: info dokumen dan pasangan kanban ─────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold">Loading list</span>
          <span className="tabular grid min-w-6 place-items-center rounded-full bg-accent px-2 text-[12px] font-bold text-white">
            {docs.length}
          </span>
        </div>
        {manifestGroup && doc.manifestNumber ? (
          <p className="tabular -mt-1 text-[12px] text-ink-muted">
            Manifest <span className="font-bold text-ink">{doc.manifestNumber}</span>
          </p>
        ) : null}
        <ul className="grid gap-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="tabular flex min-h-11 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 px-3 text-center text-[17px] font-bold break-all"
            >
              {d.documentNumber}
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-4 gap-2.5">
          <Tile label="Customer" className="col-span-3">
            {doc.customerName ?? '—'}
          </Tile>
          <Tile label="Cycle">{[...new Set(docs.map((d) => d.cycle))].join(', ')}</Tile>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="Kanban Customer" tone={customerTone}>
            {currentScan.customer ?? '-'}
          </Tile>
          <Tile label="Kanban Internal" tone={internalTone}>
            {threeWay ? (currentScan.internal ?? '-') : 'Tidak diperlukan'}
          </Tile>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {/* Kode SLOC di depan: nama seperti "Finish Good" berulang di tiap pabrik. */}
          <Tile label="Dari" compact>
            {doc.locationCode ?? '—'}
            {doc.locationName ? <Sub>{doc.locationName}</Sub> : null}
          </Tile>
          <Tile label="Ke" compact>
            {doc.stagingLocationCode ?? '—'}
            {doc.stagingLocationName ? <Sub>{doc.stagingLocationName}</Sub> : null}
          </Tile>
        </div>
      </section>

      {/* ── Kanan: hitungan, scan, aksi, status, item ──────────────────────── */}
      <section className="flex min-w-0 flex-col gap-2.5">
        <div
          className={cn(
            'flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors',
            done ? 'border-ok/40 bg-ok/10' : 'border-line bg-card',
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-card">Qty</span>
            {/* Yang sudah diambil dari rencana; sisa ditulis kecil di sampingnya. */}
            <p className="tabular text-[24px] font-extrabold leading-none">
              <span className={done ? 'text-ok' : undefined}>{totalActual}</span>
              <span className="text-[16px] font-semibold text-ink-muted"> / {totalPlanned}</span>
            </p>
            <span className="tabular text-[13px] text-ink-muted">
              {kata.sisa.toLowerCase()} <span className="font-bold text-ink">{remaining}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'size-3.5 rounded-full',
                error || result?.status === 'REJECTED'
                  ? 'bg-ng'
                  : result?.status === 'OVER'
                    ? 'bg-warn'
                    : busy
                      ? 'animate-pulse bg-accent'
                      : 'bg-ok',
              )}
            />
            <button
              type="button"
              onClick={() => {
                setSoundOn((v) => !v);
                focusInput();
              }}
              aria-label={soundOn ? 'Matikan suara' : 'Nyalakan suara'}
              className="grid size-9 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink"
            >
              {soundOn ? (
                <Volume2 className="size-4" strokeWidth={1.9} aria-hidden />
              ) : (
                <VolumeX className="size-4" strokeWidth={1.9} aria-hidden />
              )}
            </button>
          </div>
        </div>

        {/* Pemindai barcode mengetik lalu menekan Enter — ditangani sebagai submit form. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            acceptScan(code);
          }}
          className="relative"
        >
          <label htmlFor="kanban" className="sr-only">
            {scanTitle}
          </label>
          <ScanLine
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
            strokeWidth={1.8}
            aria-hidden
          />
          {/* Input TIDAK PERNAH di-disable: elemen yang dinonaktifkan kehilangan
              fokus, dan scan berikutnya akan hilang tanpa disadari operator. */}
          <input
            id="kanban"
            ref={inputRef}
            readOnly={finishing}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={customerKanban ? 'scan kanban internal…' : 'scan kanban customer…'}
            className="tabular h-14 w-full rounded-lg border-2 border-line bg-card px-11 text-center text-[18px] font-semibold outline-none transition-colors focus:border-accent"
          />
        </form>
        {customerKanban ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[12px]">
            <span className="tabular min-w-0 truncate">Kanban customer tersimpan: {customerKanban}</span>
            <button
              type="button"
              onClick={() => {
                setCustomerKanban(null);
                setResult(null);
                setError(null);
                focusInput();
              }}
              className="shrink-0 font-bold text-accent"
            >
              Ganti customer
            </button>
          </div>
        ) : null}

        {phase === 'PULLING' ? (
          <div className="grid grid-cols-[2fr_3fr] gap-3">
            {/*
             * Delay = tunda dokumen ini dan kembali ke scan loading list, seperti
             * stasiun pulling lama. Progres sudah tersimpan per scan di server;
             * berbeda dari stasiun lama, localStorage TIDAK dihapus — isinya antrean
             * scan yang belum terkirim, jadi tombol ini menunggu antrean kosong.
             */}
            <button
              type="button"
              disabled={busy || pending > 0 || finishing}
              title={pending > 0 ? 'Tunggu antrean scan terkirim sebelum menunda.' : undefined}
              onClick={() => router.push('/delivery-scan')}
              className="inline-flex h-13 items-center justify-center gap-2 rounded-lg bg-ng text-[16px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Pause className="size-4" aria-hidden />
              Delay
            </button>
            <button
              type="button"
              disabled={busy || pending > 0 || finishing || !!customerKanban || totalActual === 0}
              onClick={() => setConfirmFinish(true)}
              className="inline-flex h-13 items-center justify-center gap-2 rounded-lg bg-ok text-[16px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <CheckCircle2 className="size-4" aria-hidden />
              Finish Pulling
            </button>
          </div>
        ) : null}
        {confirmFinish ? (
          <div className="rounded-lg border border-ok/40 bg-ok/10 p-3">
            <p className="text-[14px]">
              Selesaikan <span className="font-bold">{totalActual}</span> dari {totalPlanned} kanban?
              Qty yang dipakai adalah hasil scan aktual, lalu lanjut GI AIIA → GR AII → surat jalan.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                disabled={busy || pending > 0 || finishing || !!customerKanban}
                onClick={() => void finishPulling()}
                className="h-11 rounded-lg bg-ok px-4 text-[14px] font-bold text-white disabled:opacity-40"
              >
                {finishing ? 'Memproses…' : 'Ya, Finish Pulling'}
              </button>
              <button
                type="button"
                disabled={finishing}
                onClick={() => setConfirmFinish(false)}
                className="h-11 px-3 text-[14px] font-semibold"
              >
                Kembali
              </button>
            </div>
          </div>
        ) : null}

        {/* Status satu baris, hanya muncul setelah ada hasil scan. */}
        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <StatusBar key={`err-${error}`} tone="bad" icon={XCircle} title="Gagal" detail={error} />
          ) : result ? (
            <StatusBar
              key={`${result.status}-${result.partNumber}-${result.actualKanban}`}
              tone={result.status === 'ACCEPTED' ? 'ok' : result.status === 'OVER' ? 'warn' : 'bad'}
              icon={
                result.status === 'ACCEPTED'
                  ? CheckCircle2
                  : result.status === 'OVER'
                    ? AlertTriangle
                    : XCircle
              }
              title={
                result.status === 'ACCEPTED'
                  ? 'Diterima'
                  : result.status === 'OVER'
                    ? 'Melebihi rencana'
                    : 'Ditolak'
              }
              detail={
                result.partNumber &&
                result.convertedPartNumber &&
                result.convertedPartNumber !== result.partNumber
                  ? `${result.message} · dibaca sebagai ${result.convertedPartNumber}`
                  : result.message
              }
              counter={
                result.status === 'REJECTED' ? null : `${result.actualKanban}/${result.plannedKanban}`
              }
            />
          ) : done ? (
            <StatusBar key="done" tone="ok" icon={CheckCircle2} title="Selesai" detail={kata.selesai} />
          ) : null}
        </AnimatePresence>

        {/* Antrean ditampilkan supaya jelas scan-nya tertahan, bukan hilang. */}
        {pending > 0 ? (
          <p className="tabular flex items-center justify-between rounded-lg border border-warn/40 bg-warn/10 px-3 py-1.5 text-[13px] font-semibold text-warn">
            {pending} scan menunggu dikirim
            {!busy ? (
              <button type="button" onClick={() => void drain()} className="font-bold text-accent">
                Kirim ulang
              </button>
            ) : null}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="text-[13px] font-bold">{kata.muatan}</h2>
            <span className="tabular grid min-w-6 place-items-center rounded-full bg-surface px-2 text-[12px] font-bold">
              {lines.length}
            </span>
          </div>
          <ul className="scroll-slim max-h-[42dvh] divide-y divide-line overflow-y-auto">
            {lines.map((line) => (
              <ItemRow
                key={line.id}
                line={line}
                onUndo={undo}
                documentNumber={
                  manifestGroup ? docs.find((d) => d.id === line.deliveryId)?.documentNumber : undefined
                }
              />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function toLineState(
  l: LoadingDetail['lines'][number],
  phase: LoadingPhase,
  deliveryId: number,
): LineState {
  return {
    id: l.id,
    deliveryId,
    partNumber: l.partNumber,
    partName: l.partName,
    customerPartNumber: l.customerPartNumber,
    // Saat memuat, sasarannya bukan rencana melainkan yang benar-benar sudah
    // diambil dari gudang — barang yang tidak ada di staging tidak bisa dimuat.
    plannedKanban: phase === 'PULLING' ? l.plannedKanban : l.pickedKanban,
    actualKanban: phase === 'PULLING' ? l.pickedKanban : l.actualKanban,
    qtyPerKanban: l.qtyPerKanban,
    orderedKanban: l.plannedKanban,
    plannedQty: l.plannedQty,
    uom: l.uom,
  };
}

/** Satu baris item: part customer besar, progres kanban di kanan, bar tipis di bawah. */
function ItemRow({
  line,
  onUndo,
  documentNumber,
}: {
  line: LineState;
  onUndo: (lineId: number) => Promise<void>;
  /** Diisi pada pulling per manifest: loading list pemilik item ini. */
  documentNumber?: string;
}) {
  const pct =
    line.plannedKanban > 0 ? Math.min(100, (line.actualKanban / line.plannedKanban) * 100) : 0;
  const over = line.actualKanban > line.plannedKanban;
  const complete = !over && line.actualKanban === line.plannedKanban;

  return (
    <li className={cn('px-3 py-2', complete && 'bg-ok/5')}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="tabular truncate text-[15px] font-bold" title={line.customerPartNumber ?? undefined}>
            {line.customerPartNumber ?? line.partNumber}
          </p>
          <p className="truncate text-[12px] text-ink-muted">
            {documentNumber ? <span className="font-semibold text-ink-soft">{documentNumber} · </span> : null}
            {line.partNumber} · {line.partName} · {line.plannedQty.toLocaleString('id-ID')}{' '}
            {line.uom ?? 'pcs'}
          </p>
        </div>
        <p className="tabular shrink-0 text-right leading-tight">
          <span
            className={cn(
              'text-[18px] font-extrabold',
              over ? 'text-ng' : complete ? 'text-ok' : undefined,
            )}
          >
            {line.actualKanban}
          </span>
          <span className="text-[13px] text-ink-muted"> / {line.plannedKanban}</span>
          <span className="block text-[11px] text-ink-muted">
            {(line.actualKanban * line.qtyPerKanban).toLocaleString('id-ID')} pcs
          </span>
        </p>
        <button
          type="button"
          onClick={() => void onUndo(line.id)}
          disabled={line.actualKanban === 0}
          aria-label={`Batalkan satu kanban ${line.partNumber}`}
          className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-30"
        >
          <Undo2 className="size-3.5" strokeWidth={1.9} aria-hidden />
        </button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface">
        <motion.div
          className={cn('h-full rounded-full', over ? 'bg-ng' : complete ? 'bg-ok' : 'bg-accent')}
          initial={false}
          animate={{ width: `${over ? 100 : pct}%` }}
          transition={springSoft}
        />
      </div>
    </li>
  );
}

type TileTone = 'default' | 'active' | 'ok' | 'warn' | 'bad' | 'muted';
const TILE_TONES: Record<TileTone, string> = {
  default: 'border-accent/25 bg-accent/5',
  active: 'border-accent bg-accent/15 ring-2 ring-accent/20',
  ok: 'border-ok/50 bg-ok/10',
  warn: 'border-warn/50 bg-warn/10',
  bad: 'border-ng/50 bg-ng/10',
  muted: 'border-line bg-surface/60 text-ink-muted',
};

/** Tile label-kecil + nilai-tebal-di-tengah, ukuran yang sama seperti stasiun pulling lama. */
function Tile({
  label,
  tone = 'muted',
  compact = false,
  className,
  children,
}: {
  label: string;
  tone?: TileTone;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-center rounded-lg border px-3 py-2 transition-colors',
        compact ? 'min-h-14' : 'min-h-16',
        TILE_TONES[tone],
        className,
      )}
    >
      <p className="text-[12px] font-medium text-ink-muted">{label}</p>
      <div className="tabular mt-0.5 text-center text-[16px] font-bold leading-snug break-words text-ink">
        {children}
      </div>
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="block truncate text-[11px] font-medium text-ink-muted">{children}</span>;
}

function displayKanban(raw: string): string {
  try {
    const parsed = bacaKanban(raw, { scanMode: 'PER_KANBAN' });
    return parsed.backNumber ?? parsed.customerPartNumber ?? parsed.partNumber ?? raw;
  } catch {
    return raw;
  }
}

const TONES = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  bad: 'border-ng/40 bg-ng/10 text-ng',
} as const;

function StatusBar({
  tone,
  icon: Icon,
  title,
  detail,
  counter,
}: {
  tone: keyof typeof TONES;
  icon: typeof CheckCircle2;
  title: string;
  detail: string;
  counter?: string | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: durations.base, ease: easeSoft }}
      role="status"
      className={cn('flex min-h-16 items-center gap-3 rounded-lg border px-3 py-2', TONES[tone])}
    >
      <Icon className="size-7 shrink-0" strokeWidth={1.9} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[18px] font-extrabold leading-tight">{title}</p>
        <p className="line-clamp-2 text-[13px] text-ink-soft">{detail}</p>
      </div>
      {counter ? (
        <p className="tabular shrink-0 text-[24px] font-extrabold text-ink">{counter}</p>
      ) : null}
    </motion.div>
  );
}
