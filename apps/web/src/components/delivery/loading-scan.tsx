'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Volume2,
  VolumeX,
  Undo2,
} from 'lucide-react';
import type { LoadingPhase, LoadingScanResult } from '@avicenna/contracts';
import { bacaKanban, MODE_LOADING_INSTRUKSI } from '@avicenna/domain';
import { scanKanbanAction, undoKanbanAction } from '@/app/(app)/delivery/actions';
import type { LoadingDetail } from '@/lib/loading-api';
import { useScanSound } from '../scan/use-scan-sound';
import { usePreferences } from '../shell/preferences-provider';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

interface LineState {
  id: number;
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
}

/** Kata-kata yang berbeda antara kedua tahap. Sisanya identik. */
const KATA = {
  PULLING: {
    judul: 'Ambil dari gudang',
    sisa: 'Sisa diambil',
    muatan: 'Yang harus diambil',
    selesai: 'Semua kanban sudah diambil. Tutup pulling di halaman pengiriman.',
  },
  LOADING: {
    judul: 'Scan kanban customer',
    sisa: 'Sisa kanban',
    muatan: 'Muatan',
    selesai:
      'Semua kanban sudah cocok. Selesaikan pengiriman untuk mengantrekan Good Issue 601 ke SAP.',
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
  doc,
  phase = 'LOADING',
}: {
  doc: LoadingDetail;
  phase?: LoadingPhase;
}) {
  const kata = KATA[phase];
  const [code, setCode] = useState('');
  const [lines, setLines] = useState<LineState[]>(doc.lines.map((l) => toLineState(l, phase)));
  const [result, setResult] = useState<LoadingScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const queue = useRef<QueuedScan[]>([]);
  const draining = useRef(false);
  const sound = useScanSound(soundOn);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Fokus dikembalikan SETELAH render selesai. Memanggilnya langsung setelah
  // setBusy(false) tidak cukup — saat itu komponen belum dirender ulang.
  useEffect(() => {
    if (!busy) focusInput();
  }, [busy, focusInput]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
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
  const threeWay = phase === 'LOADING' && doc.loadingMode === 'TIGA_ARAH';
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
      ...(threeWay ? { internalKanban: value } : {}),
    });
    if (threeWay) setCustomerKanban(null);
    setPending(queue.current.length);
    setCode('');
    void drain();
  }

  async function drain() {
    if (draining.current) return;
    draining.current = true;
    setBusy(true);
    try {
      while (queue.current.length > 0) {
        const value = queue.current.shift()!;
        setPending(queue.current.length);

        const res = await scanKanbanAction({
          deliveryId: doc.id,
          phase,
          customerPart: value.customerPart,
          ...(value.internalKanban ? { internalKanban: value.internalKanban } : {}),
          // Kunci idempoten dari sisi klien: kalau jaringan putus dan
          // permintaan dikirim ulang, kanban yang sama tidak terhitung dua kali.
          clientRef: crypto.randomUUID(),
        });

        if ('error' in res) {
          setError(res.error);
          setResult(null);
          sound.reject();
          continue;
        }

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
    } finally {
      draining.current = false;
      setBusy(false);
    }
  }

  async function undo(lineId: number) {
    const res = await undoKanbanAction(doc.id, lineId, phase);
    focusInput();
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setError(null);
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, actualKanban: res.actualKanban } : l)),
    );
  }

  const totalPlanned = lines.reduce((s, l) => s + l.plannedKanban, 0);
  const totalActual = lines.reduce((s, l) => s + l.actualKanban, 0);
  const remaining = Math.max(0, totalPlanned - totalActual);
  const done = remaining === 0 && totalPlanned > 0;

  return (
    <div className="grid gap-3 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ── Kiri: input dan status ──────────────────────────────────────── */}
      <div className="space-y-3 sm:space-y-6">
        <section className="rounded-card border border-line bg-card p-4 sm:p-6">
          {phase === 'LOADING' ? (
            <div className="mb-5 grid grid-cols-2 gap-2 sm:mb-6 sm:grid-cols-3">
              <ScanState
                label="Dokumen"
                value={doc.documentNumber}
                done
                className="col-span-2 sm:col-span-1"
              />
              <ScanState
                label="Kanban customer"
                value={currentScan.customer ?? 'Menunggu scan'}
                done={Boolean(customerKanban)}
                active={!customerKanban}
              />
              <ScanState
                label="Kanban internal"
                value={threeWay ? (currentScan.internal ?? 'Menunggu scan') : 'Tidak diperlukan'}
                done={Boolean(currentScan.internal)}
                active={threeWay && Boolean(customerKanban)}
                optional={!threeWay}
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="kanban" className="text-[15px] font-bold">
                {scanTitle}
              </label>
              {customerKanban ? (
                <p className="tabular mt-1 max-w-lg truncate text-[13px] text-ink-muted">
                  Kanban customer tersimpan: {customerKanban}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {customerKanban ? (
                <button
                  type="button"
                  onClick={() => {
                    setCustomerKanban(null);
                    setResult(null);
                    setError(null);
                    focusInput();
                  }}
                  className="h-10 rounded-full border border-line px-4 text-[13px] font-semibold text-ink-muted transition-colors hover:border-ink hover:text-ink"
                >
                  Ganti customer
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setSoundOn((v) => !v);
                  focusInput();
                }}
                aria-label={soundOn ? 'Matikan suara' : 'Nyalakan suara'}
                className="grid size-10 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink"
              >
                {soundOn ? (
                  <Volume2 className="size-[18px]" strokeWidth={1.9} aria-hidden />
                ) : (
                  <VolumeX className="size-[18px]" strokeWidth={1.9} aria-hidden />
                )}
              </button>
            </div>
          </div>

          {/* Pemindai barcode mengetik lalu menekan Enter — ditangani sebagai
              submit form, sama seperti layar stasiun produksi. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              acceptScan(code);
            }}
            className="relative mt-4"
          >
            <ScanLine
              className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-ink-muted"
              strokeWidth={1.8}
              aria-hidden
            />
            {/* Input TIDAK PERNAH di-disable: elemen yang dinonaktifkan kehilangan
                fokus, dan scan berikutnya akan hilang tanpa disadari operator. */}
            <input
              id="kanban"
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={scanTitle}
              placeholder={customerKanban ? 'scan kanban internal…' : 'scan kanban customer…'}
              className="tabular h-16 w-full rounded-2xl border-2 border-line bg-surface pl-14 pr-4 text-[18px] font-semibold outline-none transition-colors focus:border-accent focus:bg-card sm:h-20 sm:rounded-3xl sm:pr-5 sm:text-[26px]"
            />
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-ink-muted">
              {phase === 'LOADING'
                ? MODE_LOADING_INSTRUKSI[doc.loadingMode]
                : 'Scan setiap kanban yang diambil dari gudang ke area staging.'}{' '}
              <span className="font-semibold">
                Format {doc.partNumberFormat ?? 'NONE'} dibaca otomatis.
              </span>
            </p>
            {/* Antrean ditampilkan supaya jelas scan-nya tertahan, bukan hilang. */}
            {pending > 0 ? (
              <span className="tabular rounded-full border border-line px-3 py-1 text-[13px] font-semibold text-ink-muted">
                {pending} menunggu dikirim
              </span>
            ) : null}
          </div>
        </section>

        {/* Status besar — dibaca dari dekat truk, bukan dari depan layar. */}
        <section className="sm:min-h-[210px]">
          <AnimatePresence mode="wait">
            {error ? (
              <StatusPanel
                key={`err-${error}`}
                tone="bad"
                icon={XCircle}
                title="Gagal"
                detail={error}
              />
            ) : result ? (
              <StatusPanel
                key={`${result.status}-${result.partNumber}-${result.actualKanban}`}
                tone={
                  result.status === 'ACCEPTED' ? 'ok' : result.status === 'OVER' ? 'warn' : 'bad'
                }
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
                detail={result.message}
                partNumber={result.partNumber}
                converted={result.convertedPartNumber}
                counter={
                  result.status === 'REJECTED'
                    ? null
                    : `${result.actualKanban} / ${result.plannedKanban}`
                }
              />
            ) : customerKanban ? (
              <StatusPanel
                key="customer-ok"
                tone="idle"
                icon={ScanLine}
                title="Lanjut scan internal"
                detail="Kanban customer sudah dibaca. Scan kanban internal pada box yang sama."
              />
            ) : (
              <StatusPanel
                key="idle"
                tone="idle"
                icon={ScanLine}
                title="Menunggu scan"
                detail="Tempelkan barcode kanban ke pemindai."
              />
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* ── Kanan: sisa muatan ──────────────────────────────────────────── */}
      <div className="space-y-3 sm:space-y-6">
        <section
          className={cn(
            'rounded-card border p-4 transition-colors sm:p-6',
            done ? 'border-ok/40 bg-ok/10' : 'border-line bg-card',
          )}
        >
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
                {kata.sisa}
              </p>
              {/* Angka terpenting di layar ini: berapa lagi yang harus naik truk. */}
              <p
                className={cn(
                  'tabular mt-1 text-[48px] font-extrabold leading-none sm:text-[64px]',
                  done ? 'text-ok' : undefined,
                )}
              >
                {remaining}
              </p>
            </div>
            <p className="tabular pb-2 text-right text-[15px] text-ink-muted">
              sudah dimuat
              <span className="block text-[24px] font-bold text-ink">
                {totalActual} <span className="font-normal text-ink-muted">/ {totalPlanned}</span>
              </span>
            </p>
          </div>
          {done ? <p className="mt-3 text-[14px] font-semibold text-ok">{kata.selesai}</p> : null}
        </section>

        <section className="rounded-card border border-line bg-card">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-bold">Item customer yang akan discan</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">{kata.muatan}</p>
          </header>
          <div className="space-y-2 p-3 md:hidden">
            {lines.map((line) => (
              <MobileItem key={line.id} line={line} onUndo={undo} />
            ))}
          </div>
          <div className="scroll-slim hidden overflow-x-auto md:block">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Part</Th>
                  <Th>Pesanan</Th>
                  <Th>Scan</Th>
                  <Th>Progres</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const pct =
                    l.plannedKanban > 0
                      ? Math.min(100, (l.actualKanban / l.plannedKanban) * 100)
                      : 0;
                  const over = l.actualKanban > l.plannedKanban;
                  const complete = !over && l.actualKanban === l.plannedKanban;
                  return (
                    <tr key={l.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <div className="tabular font-semibold">
                          {l.customerPartNumber ?? l.partNumber}
                        </div>
                        <div className="text-[13px] text-ink-muted">
                          {l.partNumber} · {l.partName}
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap px-5 py-3">
                        <span className="font-semibold">
                          {l.plannedQty.toLocaleString('id-ID')} {l.uom ?? 'pcs'}
                        </span>
                        <div className="text-[12px] text-ink-muted">{l.orderedKanban} kanban</div>
                      </td>
                      <td className="tabular whitespace-nowrap px-5 py-3">
                        <span
                          className={cn(
                            'text-[19px] font-bold',
                            over ? 'text-ng' : complete ? 'text-ok' : undefined,
                          )}
                        >
                          {l.actualKanban}
                        </span>
                        <span className="text-ink-muted"> / {l.plannedKanban}</span>
                        <div className="text-[12px] text-ink-muted">
                          {(l.actualKanban * l.qtyPerKanban).toLocaleString('id-ID')} pcs
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-surface">
                          <motion.div
                            className={cn(
                              'h-full rounded-full',
                              over ? 'bg-ng' : complete ? 'bg-ok' : 'bg-accent',
                            )}
                            initial={false}
                            animate={{ width: `${over ? 100 : pct}%` }}
                            transition={springSoft}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void undo(l.id)}
                          disabled={l.actualKanban === 0}
                          aria-label={`Batalkan satu kanban ${l.partNumber}`}
                          className="grid size-9 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-30"
                        >
                          <Undo2 className="size-4" strokeWidth={1.9} aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function toLineState(l: LoadingDetail['lines'][number], phase: LoadingPhase): LineState {
  return {
    id: l.id,
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

function MobileItem({
  line,
  onUndo,
}: {
  line: LineState;
  onUndo: (lineId: number) => Promise<void>;
}) {
  const pct =
    line.plannedKanban > 0 ? Math.min(100, (line.actualKanban / line.plannedKanban) * 100) : 0;
  const over = line.actualKanban > line.plannedKanban;
  const complete = !over && line.actualKanban === line.plannedKanban;

  return (
    <article className="rounded-2xl border border-line bg-surface/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular break-all text-[16px] font-extrabold">
            {line.customerPartNumber ?? line.partNumber}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {line.partNumber} · {line.partName}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onUndo(line.id)}
          disabled={line.actualKanban === 0}
          aria-label={`Batalkan satu kanban ${line.partNumber}`}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-muted disabled:opacity-30"
        >
          <Undo2 className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <p className="text-ink-muted">Pesanan customer</p>
          <p className="tabular mt-0.5 font-bold">
            {line.plannedQty.toLocaleString('id-ID')} {line.uom ?? 'pcs'}
          </p>
          <p className="text-ink-muted">{line.orderedKanban} kanban</p>
        </div>
        <div className="text-right">
          <p className="text-ink-muted">Progres scan</p>
          <p
            className={cn(
              'tabular mt-0.5 text-[22px] font-extrabold',
              over ? 'text-ng' : complete ? 'text-ok' : '',
            )}
          >
            {line.actualKanban}{' '}
            <span className="text-[14px] font-normal text-ink-muted">/ {line.plannedKanban}</span>
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-card">
        <motion.div
          className={cn('h-full rounded-full', over ? 'bg-ng' : complete ? 'bg-ok' : 'bg-accent')}
          initial={false}
          animate={{ width: `${over ? 100 : pct}%` }}
          transition={springSoft}
        />
      </div>
    </article>
  );
}

function ScanState({
  label,
  value,
  done = false,
  active = false,
  optional = false,
  className,
}: {
  label: string;
  value: string;
  done?: boolean;
  active?: boolean;
  optional?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-2xl border px-3 py-3 transition-colors',
        active
          ? 'border-accent bg-accent/10'
          : done
            ? 'border-ok/40 bg-ok/10 text-ok'
            : 'border-line bg-surface/50',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            active ? 'bg-accent' : done ? 'bg-ok' : 'bg-ink-muted/40',
          )}
        />
        <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </p>
      </div>
      <p
        className={cn(
          'tabular mt-1 truncate text-[14px] font-extrabold text-ink sm:text-[15px]',
          !done && !active && 'text-ink-muted',
        )}
        title={value}
      >
        {value}
      </p>
      {optional ? (
        <p className="mt-0.5 text-[10px] text-ink-muted">Mode customer langsung</p>
      ) : null}
    </div>
  );
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
  idle: 'border-line bg-card text-ink-muted',
} as const;

function StatusPanel({
  tone,
  icon: Icon,
  title,
  detail,
  partNumber,
  converted,
  counter,
}: {
  tone: keyof typeof TONES;
  icon: typeof CheckCircle2;
  title: string;
  detail: string;
  partNumber?: string | null;
  converted?: string | null;
  counter?: string | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: durations.base, ease: easeSoft }}
      role="status"
      className={cn('rounded-card border p-6', TONES[tone])}
    >
      <div className="flex items-start gap-4">
        <Icon className="mt-1 size-9 shrink-0" strokeWidth={1.9} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[30px] font-extrabold leading-tight">{title}</p>
          {partNumber ? (
            <p className="tabular mt-1 text-[20px] font-bold text-ink">{partNumber}</p>
          ) : null}
          <p className="mt-1 text-[15px] text-ink-soft">{detail}</p>
          {converted && converted !== partNumber ? (
            <p className="tabular mt-2 text-[13px] text-ink-muted">
              barcode dibaca sebagai <span className="font-semibold">{converted}</span>
            </p>
          ) : null}
        </div>
        {counter ? (
          <p className="tabular shrink-0 text-[34px] font-extrabold text-ink">{counter}</p>
        ) : null}
      </div>
    </motion.div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}
