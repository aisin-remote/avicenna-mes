'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Truck, Clock3, ShieldCheck, Camera, ScanLine, RefreshCw } from 'lucide-react';
import type {
  DriverAttendanceBoard,
  DriverAttendanceOrder,
  DriverAttendanceStart,
} from '@avicenna/contracts';
import {
  driverBoardAction,
  finishDriverPickupAction,
  resolveDriverOrderAction,
  startDriverPickupAction,
} from '@/app/(station)/delivery-return/actions';
import { DriverPhoto } from './driver-photo';
import { DriverAttendanceHistory } from './driver-attendance-history';
import { DeliveryReturnScan } from './delivery-return-scan';
import { pickupDuration, pickupTime } from './driver-attendance-format';

const button =
  'min-h-12 rounded-full border border-line px-5 text-sm font-semibold disabled:opacity-40';
const primary = `${button} border-transparent bg-accent text-white`;
export function DriverAttendance({
  initial,
  today,
  canManage,
  canOperate,
}: {
  initial: DriverAttendanceBoard;
  today: string;
  canManage: boolean;
  canOperate: boolean;
}) {
  const [board, setBoard] = useState(initial),
    [tab, setTab] = useState<'pickup' | 'history' | 'return'>('pickup');
  const [slot, setSlot] = useState<1 | 2 | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null),
    [now, setNow] = useState<number | null>(null),
    [version, setVersion] = useState(0);
  async function refresh() {
    const result = await driverBoardAction(board.plantId);
    if ('error' in result) setError(result.error ?? 'Data belum dapat dimuat.');
    else {
      setBoard(result.data);
      setVersion((v) => v + 1);
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (slot || busy) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [slot, busy, board.plantId]);
  async function finish(id: number) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await finishDriverPickupAction(id);
      if ('error' in result) setError(result.error ?? 'Pickup belum dapat diselesaikan.');
      else {
        setConfirm(null);
        setMessage(
          result.alreadyFinished
            ? 'Pickup ini sudah selesai; tidak membuat GI baru.'
            : 'Pickup selesai. Permintaan GI AII seluruh DO sudah dicatat. Status pengiriman mengikuti konfirmasi SAP.',
        );
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-card p-1.5">
          {(
            [
              ['pickup', 'Pickup Truk'],
              ['history', 'Riwayat Absensi'],
              ['return', 'Dokumen Kembali'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              disabled={!!slot || busy}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40 ${tab === key ? 'bg-accent text-white' : 'text-ink-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {board.plants.length > 1 && (
            <select
              aria-label="Pabrik absensi"
              value={board.plantId}
              disabled={!!slot || busy}
              onChange={(e) => {
                window.location.href = `/delivery-return?plantId=${e.target.value}`;
              }}
              className="min-h-11 rounded-xl border border-line bg-card px-3 text-sm"
            >
              {board.plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            aria-label="Perbarui absensi"
            disabled={busy || !!slot}
            onClick={() => {
              setError('');
              void refresh();
            }}
            className="grid size-11 place-items-center rounded-full border border-line bg-card disabled:opacity-40"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-2xl border border-ng/30 bg-ng/10 p-4 text-sm text-ng">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-2xl border border-ok/30 bg-ok/10 p-4 text-sm text-ok">
          {message}
        </p>
      )}
      {tab === 'pickup' ? (
        slot ? (
          <PickupForm
            key={slot}
            slot={slot}
            board={board}
            cancel={() => setSlot(null)}
            saved={() => {
              setSlot(null);
              setMessage('Pickup dimulai. GI AII akan dipicu setelah Selesai Pickup.');
              void refresh();
            }}
          />
        ) : (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              {([1, 2] as const).map((position) => {
                const active = board.active.find((a) => a.slot === position);
                return (
                  <section
                    key={position}
                    className={`flex min-h-[420px] flex-col rounded-3xl border bg-card p-5 sm:p-7 ${active ? 'border-amber-500/40' : 'border-line'}`}
                  >
                    <div className="mb-6 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-12 place-items-center rounded-2xl bg-surface text-accent">
                          <Truck className="size-6" />
                        </span>
                        <div>
                          <h2 className="text-xl font-bold">TRUCK 0{position}</h2>
                          <p className="text-sm text-ink-muted">
                            {position === 1 ? 'Depan' : 'Belakang'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-amber-500/10 text-amber-500' : 'bg-ok/10 text-ok'}`}
                      >
                        {active ? 'Sedang Pickup' : 'Tersedia'}
                      </span>
                    </div>
                    {active ? (
                      <>
                        <h3 className="text-2xl font-bold">{active.destinationName}</h3>
                        <div className="my-5 grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-ink-muted">Route / Dock</p>
                            <p className="mt-1 font-semibold">{active.dock}</p>
                          </div>
                          <div>
                            <p className="text-ink-muted">Cycle</p>
                            <p className="mt-1 font-semibold">C{active.cycle}</p>
                          </div>
                          <div>
                            <p className="text-ink-muted">Logistik / LP</p>
                            <p className="mt-1 font-semibold">{active.logistic}</p>
                          </div>
                          <div>
                            <p className="text-ink-muted">Mulai · WIB</p>
                            <p className="mt-1 font-semibold">{pickupTime(active.startedAt)}</p>
                          </div>
                        </div>
                        <div className="mb-4 max-h-28 overflow-auto rounded-xl border border-line p-3 text-sm">
                          {active.orders.map((o) => (
                            <p key={o.id} className="break-all py-1">
                              {o.number ?? o.pdsNumber}
                            </p>
                          ))}
                        </div>
                        <div className="mb-5 flex items-center gap-3 text-accent">
                          <Clock3 className="size-5" />
                          <span className="font-mono text-3xl font-bold tabular-nums">
                            {pickupDuration(active.startedAt, now)}
                          </span>
                          <span className="text-xs text-ink-muted">Durasi pickup</span>
                        </div>
                        {confirm === active.id ? (
                          <div className="mt-auto rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                            <p className="text-sm">
                              Selesaikan pickup dan kirim permintaan GI AII untuk{' '}
                              {active.orders.length} DO?
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                disabled={busy}
                                onClick={() => void finish(active.id)}
                                className={primary}
                              >
                                {busy ? 'Memproses…' : 'Ya, Selesai Pickup'}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => setConfirm(null)}
                                className={button}
                              >
                                Kembali
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            disabled={busy || !canOperate}
                            onClick={() => setConfirm(active.id)}
                            className={`${primary} mt-auto w-full`}
                          >
                            Selesai Pickup
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-9">
                        <Truck className="size-16 text-ink-muted/30" />
                        <p className="text-center text-sm text-ink-muted">
                          Posisi siap untuk pickup berikutnya.
                        </p>
                        <button
                          disabled={!board.destinations.length || busy || !canOperate}
                          onClick={() => {
                            setError('');
                            setMessage('');
                            setSlot(position);
                          }}
                          className={`${primary} min-w-44`}
                        >
                          Mulai
                        </button>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            {!board.destinations.length && (
              <p className="rounded-2xl border border-line bg-card p-4 text-sm">
                Tujuan pickup belum tersedia untuk pabrik ini.{' '}
                {canManage ? (
                  <Link
                    href="/master/driver-destinations"
                    className="font-semibold text-accent underline"
                  >
                    Tambah Tujuan Pickup
                  </Link>
                ) : (
                  'Hubungi admin untuk melengkapi master Tujuan Pickup.'
                )}
              </p>
            )}
            {canManage && board.destinations.length > 0 && (
              <Link
                href="/master/driver-destinations"
                className="inline-block text-sm font-semibold text-accent underline"
              >
                Kelola Tujuan Pickup
              </Link>
            )}
          </>
        )
      ) : tab === 'history' ? (
        <DriverAttendanceHistory
          key={board.plantId}
          plantId={board.plantId}
          today={today}
          version={version}
        />
      ) : (
        <div className="mx-auto max-w-2xl">
          <DeliveryReturnScan />
        </div>
      )}
    </div>
  );
}

function PickupForm({
  slot,
  board,
  cancel,
  saved,
}: {
  slot: 1 | 2;
  board: DriverAttendanceBoard;
  cancel: () => void;
  saved: () => void;
}) {
  const [step, setStep] = useState(0),
    [safety, setSafety] = useState<Array<boolean | null>>([null, null, null]);
  const [photo, setPhoto] = useState(''),
    [destinationId, setDestination] = useState(0),
    [cycle, setCycle] = useState(0);
  const [code, setCode] = useState(''),
    [orders, setOrders] = useState<DriverAttendanceOrder[]>([]),
    [choices, setChoices] = useState<DriverAttendanceOrder[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const destination = board.destinations.find((d) => d.id === destinationId);
  const safe = safety.every((s) => s === true);
  function add(order: DriverAttendanceOrder) {
    if (order.driverScannedAt || order.shippedAt || !order.number)
      return setError('DO sudah berangkat atau belum diterbitkan.');
    setOrders((old) => (old.some((o) => o.id === order.id) ? old : [...old, order]));
    setChoices([]);
    setCode('');
    setError('');
  }
  async function resolve() {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    setChoices([]);
    try {
      const result = await resolveDriverOrderAction(code.trim(), board.plantId);
      if ('error' in result) setError(result.error ?? 'DO belum dapat dicari.');
      else if (result.data.length === 1) add(result.data[0]!);
      else setChoices(result.data);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (busy || !safe || !photo || !destinationId || !cycle || !orders.length) return;
    setBusy(true);
    setError('');
    try {
      const input: DriverAttendanceStart = {
        plantId: board.plantId,
        slot,
        destinationId,
        cycle,
        helmet: true,
        vest: true,
        shoes: true,
        photo,
        orderIds: orders.map((o) => o.id),
      };
      const result = await startDriverPickupAction(input);
      if ('error' in result) setError(result.error ?? 'Pickup belum dapat dimulai.');
      else saved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-4xl rounded-3xl border border-line bg-card p-4 sm:p-7">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            TRUCK 0{slot} · {slot === 1 ? 'Depan' : 'Belakang'}
          </p>
          <h2 className="mt-1 text-xl font-bold">Mulai Pickup</h2>
        </div>
        <button disabled={busy} onClick={cancel} className={button}>
          Batal
        </button>
      </header>
      <ol className="mb-7 grid grid-cols-3 gap-2">
        {[
          { label: 'Safety', icon: ShieldCheck },
          { label: 'Foto Driver', icon: Camera },
          { label: 'Dokumen', icon: ScanLine },
        ].map(({ label, icon: Icon }, i) => (
          <li
            key={label}
            className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold sm:text-sm ${i === step ? 'border-accent bg-accent/10 text-accent' : i < step ? 'border-ok/30 text-ok' : 'border-line text-ink-muted'}`}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <div className="space-y-3">
          <h3 className="mb-4 text-lg font-bold">Checksheet Safety</h3>
          {[
            'Saya memakai Helm Safety',
            'Saya memakai Rompi Safety',
            'Saya memakai Sepatu Safety',
          ].map((label, i) => (
            <fieldset
              key={label}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4"
            >
              <legend className="sr-only">{label}</legend>
              <span className="font-semibold">{label}</span>
              <div className="flex gap-2">
                {[true, false].map((yes) => (
                  <label
                    key={String(yes)}
                    className={`cursor-pointer rounded-full border px-5 py-3 text-sm font-bold ${safety[i] === yes ? (yes ? 'border-ok bg-ok/10 text-ok' : 'border-ng bg-ng/10 text-ng') : 'border-line text-ink-muted'}`}
                  >
                    <input
                      type="radio"
                      name={`safety-${i}`}
                      checked={safety[i] === yes}
                      onChange={() => setSafety((old) => old.map((s, j) => (j === i ? yes : s)))}
                      className="sr-only"
                    />
                    {yes ? 'Ya' : 'Tidak'}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {safety.includes(false) && (
            <p role="alert" className="p-2 text-sm text-ng">
              Lengkapi seluruh APD sebelum melanjutkan pickup.
            </p>
          )}
          <button disabled={!safe} onClick={() => setStep(1)} className={`${primary} mt-4 w-full`}>
            Lanjut Ambil Foto
          </button>
        </div>
      ) : step === 1 ? (
        <div className="space-y-5">
          <DriverPhoto value={photo} onChange={setPhoto} />
          <div className="flex justify-between gap-3">
            <button onClick={() => setStep(0)} className={button}>
              Kembali
            </button>
            <button disabled={!photo} onClick={() => setStep(2)} className={primary}>
              Lanjut Dokumen
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="mb-3 font-bold">Tujuan Pickup</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {board.destinations.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDestination(d.id)}
                  aria-pressed={destinationId === d.id}
                  className={`min-h-20 rounded-2xl border p-3 text-left ${destinationId === d.id ? 'border-accent bg-accent/10' : 'border-line'}`}
                >
                  <strong className="block text-sm">{d.name}</strong>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {d.dock} · {d.logistic}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-bold">Cycle</h3>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((c) => (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  aria-pressed={cycle === c}
                  className={`min-h-12 rounded-xl border text-sm font-bold ${cycle === c ? 'border-accent bg-accent text-white' : 'border-line'}`}
                >
                  C{c}
                </button>
              ))}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void resolve();
            }}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <label htmlFor="pickup-do" className="mb-2 block font-semibold">
              Scan DO / manifest / PDS
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="pickup-do"
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setChoices([]);
                }}
                readOnly={busy}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Scan lalu Enter untuk menambah DO…"
                className="min-h-14 min-w-0 flex-1 rounded-xl border border-line bg-card px-4 text-base outline-none focus:border-accent"
              />
              <button disabled={busy || !code.trim()} className={primary}>
                {busy ? 'Memeriksa…' : 'Tambah DO'}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Scan berulang untuk menambahkan beberapa DO pada pickup yang sama.
            </p>
          </form>
          {choices.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                Manifest memuat beberapa PDS. Pilih DO yang dibawa:
              </p>
              {choices.map((o) => (
                <button
                  key={o.id}
                  disabled={!!o.driverScannedAt || !o.number}
                  onClick={() => add(o)}
                  className="block min-h-14 w-full rounded-xl border border-line p-3 text-left text-sm disabled:opacity-40"
                >
                  <strong>{o.number ?? 'DO belum terbit'}</strong> · {o.pdsNumber} ·{' '}
                  {o.customerName}
                  {o.driverScannedAt ? ' · Sudah dipakai' : ''}
                </button>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-line p-4">
            <p className="mb-2 font-semibold">{orders.length} DO pada pickup ini</p>
            {orders.length ? (
              orders.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-3 border-t border-line py-3 text-sm"
                >
                  <div className="min-w-0">
                    <strong className="break-all">{o.number}</strong>
                    <p className="text-xs text-ink-muted">
                      {o.pdsNumber} · {o.customerName}
                    </p>
                  </div>
                  <button
                    aria-label={`Hapus ${o.number} dari pickup`}
                    disabled={busy}
                    onClick={() => setOrders((old) => old.filter((d) => d.id !== o.id))}
                    className="min-h-11 px-3 text-ng"
                  >
                    Hapus
                  </button>
                </div>
              ))
            ) : (
              <p className="text-sm text-ink-muted">Belum ada DO yang discan.</p>
            )}
          </div>
          <p className="text-sm text-ink-muted">
            {destination
              ? `${destination.name} · ${destination.dock} · ${destination.logistic}`
              : 'Pilih tujuan pickup'}{' '}
            · {cycle ? `C${cycle}` : 'Pilih cycle'}. GI AII diproses setelah Selesai Pickup.
          </p>
          <div className="flex flex-wrap justify-between gap-3">
            <button disabled={busy} onClick={() => setStep(1)} className={button}>
              Kembali
            </button>
            <button
              disabled={busy || !destinationId || !cycle || !orders.length}
              onClick={() => void start()}
              className={primary}
            >
              {busy ? 'Memproses…' : 'Mulai Pickup'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-ng/10 p-4 text-sm text-ng">
          {error}
        </p>
      )}
    </section>
  );
}
