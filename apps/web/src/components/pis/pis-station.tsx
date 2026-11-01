'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, CheckCheck, ClipboardCheck, ImageOff, LockKeyhole,
  Maximize, Minimize, Pause, RefreshCw, ScanLine, Volume2, VolumeX } from 'lucide-react';
import { PIS_DOCKS, type PisBoard, type PisContextInput, type PisMessage } from '@avicenna/contracts';
import { PIS_DANDORY_DOCKS } from '@avicenna/domain';
import { confirmPisAction, contextPisAction, readPisAction, resetPisAction,
  scanPisAction, unlockPisAction, type PisResult } from '@/app/(station)/pis/actions';

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-semibold transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45';
const field = 'min-h-12 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none focus:border-live focus:ring-2 focus:ring-live/20';
const numbers = new Intl.NumberFormat('id-ID');
// Rekaman suara yang sama dengan stasiun PIS lama (stagging-body).
const SOUNDS = {
  OK: 'ok', NOT_MATCH: 'notMatch', LABEL_INVALID: 'lblTidakValid',
  LL_DONE: 'LLSelesai', PDS_DIFFERENT: 'pdsBerbeda', MOVE_KANBAN: 'pindahKanban',
} as const;
type Sound = keyof typeof SOUNDS;
const soundOf = (m: PisMessage): Sound =>
  m.sound ?? (m.status === 'COMPLETE' ? 'LL_DONE' : ['ERROR', 'WARNING'].includes(m.status) ? 'NOT_MATCH' : 'OK');

/** Native dialog traps focus and keeps a scanner from feeding the station behind an interlock. */
function BlockingDialog({ children, title }: { children: ReactNode; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={(e) => e.preventDefault()}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-3xl border border-line bg-card p-6 text-ink shadow-2xl backdrop:bg-black/70">
    {children}
  </dialog>;
}

function InstructionImage({ url, mode }: { url: string; mode: PisBoard['mode'] }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center text-ink-muted">
    <ImageOff className="size-12" aria-hidden />
    <p className="font-semibold text-ink-soft">Gambar instruksi belum tersedia</p>
    <p className="max-w-sm text-sm">Periksa part dan instruksi kerja yang berlaku sebelum konfirmasi packing.</p>
  </div> : <img src={url} alt="Gambar part atau instruksi packing yang sedang diperiksa"
    onError={() => setFailed(true)}
    className={`h-full min-h-80 w-full ${mode === 'DANDORY' ? 'object-contain' : 'object-cover'}`} />;
}

export function PisStation({ initial, initialPlantId, operator }: {
  initial: PisResult; initialPlantId?: number; operator: string;
}) {
  const [board, setBoard] = useState<PisBoard | null>(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? '');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [code, setCode] = useState('');
  const attempt = useRef<{ code: string; clientRef: string } | null>(null);
  const scanner = useRef<HTMLInputElement>(null);
  const station = useRef<HTMLDivElement>(null);
  const [npk, setNpk] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [sound, setSound] = useState(true);
  const audio = useRef<HTMLAudioElement | null>(null);

  const play = useCallback((name: Sound) => {
    if (!sound) return;
    audio.current?.pause();
    audio.current = new Audio(`/sounds/pis/${SOUNDS[name]}.mp3`);
    // Status text remains the primary feedback when autoplay is blocked.
    void audio.current.play().catch(() => undefined);
  }, [sound]);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    const update = () => setSeconds(board?.cooldownUntil
      ? Math.max(0, Math.ceil((Date.parse(board.cooldownUntil) - Date.now()) / 1000)) : 0);
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [board?.cooldownUntil]);
  useEffect(() => {
    if (!busy && !board?.interlock && !board?.complete) scanner.current?.focus({ preventScroll: true });
  }, [busy, board?.interlock, board?.complete]);

  const run = async (operation: () => Promise<PisResult>, audible = true) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await operation();
      if (result.error) { setError(result.error); if (audible) play('NOT_MATCH'); return false; }
      if (result.data) {
        setBoard(result.data);
        if (audible) play(soundOf(result.data.message));
      }
      return true;
    } catch {
      setError('Koneksi terputus. Coba ulangi aksi yang sama atau perbarui status.');
      if (audible) play('NOT_MATCH');
      return false;
    } finally {
      inFlight.current = false; setBusy(false);
    }
  };

  const scan = async (raw: string) => {
    if (!board || !raw.trim() || inFlight.current) return;
    if (board.pending || board.interlock || board.complete) {
      setError(board.pending ? 'Konfirmasi packing yang sedang diperiksa terlebih dahulu.' : 'Selesaikan instruksi pada layar terlebih dahulu.');
      play('NOT_MATCH'); return;
    }
    if (attempt.current?.code !== raw) attempt.current = { code: raw, clientRef: crypto.randomUUID() };
    const input = { plantId: board.plantId, ...attempt.current };
    if (await run(() => scanPisAction(input))) { attempt.current = null; setCode(''); }
  };

  // A keyboard-wedge scanner also works after clicking non-input areas of the screen.
  const scanHandler = useRef(scan);
  scanHandler.current = scan;
  useEffect(() => {
    let buffer = '';
    let lastKey = 0;
    const capture = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,dialog,[contenteditable="true"]')) return;
      if (event.key === 'Enter' && buffer) {
        event.preventDefault(); void scanHandler.current(buffer); buffer = ''; return;
      }
      if (event.key.length !== 1) return;
      if (Date.now() - lastKey > 250) buffer = '';
      lastKey = Date.now(); buffer += event.key;
      if (event.key !== ' ') event.preventDefault();
    };
    window.addEventListener('keydown', capture);
    return () => window.removeEventListener('keydown', capture);
  }, []);

  const changeContext = (mode: PisBoard['mode'], dock: string) => {
    if (board) void run(() => contextPisAction({ plantId: board.plantId, mode, dock } as PisContextInput));
  };
  const locked = busy || Boolean(board?.pending || board?.interlock);
  const lines = board?.documents.flatMap((doc) => doc.lines) ?? [];
  const total = lines.reduce((sum, line) => sum + line.targetQty, 0);
  const packed = lines.reduce((sum, line) => sum + line.packedQty, 0);
  const docks = board?.mode === 'DANDORY' ? PIS_DANDORY_DOCKS : PIS_DOCKS;
  const stageIndex = board?.stage === 'LABEL' ? 2 : board?.stage === 'KANBAN' ? 1 : 0;
  const status = error ? 'ERROR' : board?.message.status ?? 'READY';
  const statusClass = status === 'ERROR' ? 'border-ng/30 bg-ng/10 text-ng' :
    status === 'WARNING' ? 'border-warn/30 bg-warn/10 text-warn' :
    ['SUCCESS', 'COMPLETE'].includes(status) ? 'border-ok/30 bg-ok/10 text-ok' : 'border-line bg-card text-ink';

  return <div ref={station} className="flex min-h-dvh flex-col bg-surface text-ink">
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-3">
      <Link href="/delivery" aria-label="Kembali ke delivery" className={`${button} px-3`}><ArrowLeft className="size-5" /></Link>
      <span className="grid size-11 place-items-center rounded-xl bg-accent text-white"><ClipboardCheck className="size-6" /></span>
      <div><h1 className="text-xl font-extrabold">PIS</h1><p className="text-xs text-ink-muted">Pemeriksaan packing per pcs</p></div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden max-w-48 truncate text-sm text-ink-soft sm:block">{operator}</span>
        {board && board.plants.length > 1 && <select aria-label="Pabrik PIS" value={board.plantId} disabled={locked}
          onChange={(e) => { const id = Number(e.target.value); setCode(''); attempt.current = null; void run(() => readPisAction(id), false); }}
          className="min-h-11 max-w-44 rounded-xl border border-line bg-surface px-2 text-sm">
          {board.plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
        </select>}
        <button type="button" className={button} aria-label={sound ? 'Matikan suara scan' : 'Aktifkan suara scan'} aria-pressed={sound} onClick={() => setSound(!sound)}>
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </button>
        <button type="button" className={button} disabled={busy} aria-label="Perbarui status PIS"
          onClick={() => void run(() => readPisAction(board?.plantId ?? initialPlantId), false)}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} /></button>
      </div>
    </header>

    {!board ? <main className="m-auto max-w-lg p-6 text-center"><p role="alert" className="mb-4 text-ng">{error}</p>
      <button className={button} disabled={busy} onClick={() => void run(() => readPisAction(initialPlantId), false)}>Coba lagi</button>
    </main> : <main className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(250px,2fr)_minmax(0,8fr)_minmax(160px,1.5fr)]">
      <aside className="flex min-w-0 flex-col gap-3">
        <section className="rounded-2xl border border-line bg-card p-4">
          <form onSubmit={(e) => { e.preventDefault(); void scan(code); }}>
            <label htmlFor="pis-scan" className="mb-2 flex items-center gap-2 text-sm font-bold"><ScanLine className="size-4" /> Scan barcode</label>
            <input ref={scanner} id="pis-scan" value={code} onChange={(e) => setCode(e.target.value)} className={field}
              autoComplete="off" autoCapitalize="off" spellCheck={false} readOnly={busy}
              placeholder={board.stage === 'DOCUMENT' ? 'Loading list / manifest' : board.stage === 'KANBAN' ? 'Kanban customer' : 'Label part'} />
            <button className={`${button} mt-2 w-full bg-accent text-white hover:bg-accent-soft`} disabled={locked || board.complete || !code.trim()}>
              {busy ? 'Memproses…' : 'Proses scan'}
            </button>
          </form>
          <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
            <div><p className="text-xs font-semibold text-ink-muted">Counter hari ini (pcs)</p><p className="mt-1 text-4xl font-extrabold tabular-nums">{numbers.format(board.dailyCount)}</p></div>
            <span className="rounded-full bg-ok/10 p-2 text-ok"><CheckCheck className="size-5" /></span>
          </div>
        </section>
        <section className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-3 py-3"><h2 className="text-sm font-bold">Loading list</h2><span className="text-xs tabular-nums text-ink-muted">{packed} / {total} pcs</span></div>
          {!board.documents.length ? <p className="px-4 py-8 text-center text-sm text-ink-muted">Scan loading list untuk menampilkan daftar part.</p> :
            <div className="max-h-[48dvh] overflow-auto lg:max-h-[55dvh]">
              {board.documents.map((doc) => <div key={doc.id}>
                <div className="border-b border-line bg-surface px-3 py-3"><p className="break-all text-xs font-bold">{doc.documentNumber}</p>
                  <p className="mt-1 break-words text-[11px] text-ink-muted">PDS {doc.pdsNumber ?? '—'} · {doc.customerName ?? '—'}</p></div>
                <table className="w-full table-fixed text-left text-[11px]"><thead className="text-ink-muted"><tr>
                  <th className="w-[35%] px-2 py-2 font-medium">PN (Int)</th><th className="w-[35%] px-1 py-2 font-medium">PN (Cust)</th><th className="px-1 text-right font-medium">Cur</th><th className="px-2 text-right font-medium">Tar</th>
                </tr></thead><tbody>{doc.lines.map((line) => <tr key={line.id}
                  className={`border-t border-line ${line.remainingQty === 0 ? 'bg-ok/10 text-ok' : board.activeKanban?.lineId === line.id ? 'bg-live/10' : ''}`}>
                  <td className="break-all px-2 py-3 font-semibold">{line.partNumber}</td><td className="break-all px-1 py-3">{line.customerPartNumber ?? '—'}</td>
                  <td className="px-1 text-right font-bold tabular-nums">{line.packedQty}</td><td className="px-2 text-right tabular-nums">{line.targetQty}</td>
                </tr>)}</tbody></table>
              </div>)}
            </div>}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={button} disabled={locked || !board.documents.length}
            onClick={() => void run(() => resetPisAction(board.plantId))}><Pause className="size-4" /> Delay</button>
          <button type="button" className={button} onClick={async () => {
            try { if (document.fullscreenElement) await document.exitFullscreen(); else await station.current?.requestFullscreen(); }
            catch { setError('Mode fullscreen belum tersedia di browser ini.'); }
          }}>{fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />} {fullscreen ? 'Keluar' : 'Fullscreen'}</button>
        </div>
        <button type="button" className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-lg font-extrabold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || !board.pending || Boolean(board.interlock)}
          onClick={() => { if (board.pending) void run(() => confirmPisAction({ plantId: board.plantId, pendingId: board.pending!.id })); }}>
          <CheckCheck className="size-6" /> Confirm Packing {board.pending ? '(1)' : ''}
        </button>
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2" aria-label="Tahapan pemeriksaan packing">
          {['Loading list', 'Kanban', board.dock === 'TTI' ? 'Confirm' : 'Label part'].map((label, i) => <div key={label}
            className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-xs font-bold sm:text-sm ${i === stageIndex ? 'border-live/40 bg-live/10 text-live' : i < stageIndex ? 'border-ok/20 bg-ok/10 text-ok' : 'border-line bg-card text-ink-muted'}`}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full border border-current">{i < stageIndex ? <Check className="size-4" /> : i + 1}</span>{label}
          </div>)}
        </div>
        <div role="status" aria-live="polite" className={`rounded-2xl border p-5 ${statusClass}`}>
          <p className="text-xl font-extrabold leading-snug xl:text-3xl">{error || board.message.text}</p>
          <p className="mt-2 text-sm opacity-80">{board.pending ? 'Periksa part dan gambar, lalu tekan Confirm Packing untuk menambah 1 pcs.' : seconds > 0 ? `Jeda scan label: ${seconds} detik.` :
            board.stage === 'DOCUMENT' ? 'Mulai dengan scan loading list yang akan dikerjakan.' : board.stage === 'KANBAN' ? 'Scan kanban customer yang sesuai dengan daftar part.' : 'Scan label pada part yang akan dimasukkan ke kemasan.'}</p>
        </div>
        <div className="flex min-h-96 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-card lg:min-h-[60dvh]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div><h2 className="text-sm font-bold">Gambar instruksi</h2><p className="mt-1 break-all text-xs text-ink-muted">{board.pending?.customerPartNumber || board.activeKanban?.partNumber || 'Menunggu scan part'}</p></div>
            <span className="rounded-lg bg-surface px-3 py-1.5 text-xs font-bold">{board.mode} · {board.dock}</span>
          </div>
          <div className="relative flex flex-1 flex-col justify-center overflow-hidden">
            {board.pending ? <InstructionImage key={board.pending.id} url={board.pending.previewUrl} mode={board.mode} /> :
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-ink-muted">
                <span className="rounded-3xl border border-line bg-surface p-6"><ScanLine className="size-16 stroke-1" /></span>
                <p className="text-lg font-semibold text-ink-soft">{board.activeKanban ? 'Menunggu label part' : 'Siap untuk pemeriksaan'}</p>
                <p className="max-w-sm text-sm">Gambar akan muncul setelah label part sesuai dengan kanban yang sedang diperiksa.</p>
              </div>}
          </div>
          {board.pending && <div className="border-t border-line bg-ok/5 px-4 py-3"><p className="text-xs font-semibold text-ink-muted">Label menunggu konfirmasi · 1 pcs</p><p className="mt-1 break-all text-sm font-bold">{board.pending.label}</p></div>}
        </div>
      </section>

      <aside className="flex min-w-0 flex-col gap-3">
        <section className="rounded-2xl border border-line bg-card p-3"><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-muted">Tipe</h2>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">{(['OEM', 'DANDORY'] as const).map((mode) => <button type="button" key={mode}
            aria-pressed={board.mode === mode} disabled={locked} onClick={() => changeContext(mode, mode === 'DANDORY' && !PIS_DANDORY_DOCKS.includes(board.dock) ? 'TMMIN SPD' : board.dock)}
            className={`${button} ${board.mode === mode ? 'border-live/40 bg-live/10 text-live' : ''}`}>{mode}</button>)}</div>
        </section>
        <section className="min-h-0 flex-1 rounded-2xl border border-line bg-card p-3"><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-muted">Dock</h2>
          <div className="grid max-h-[35dvh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:max-h-[70dvh] lg:grid-cols-1">
            {docks.map((dock) => <button type="button" key={dock} aria-pressed={board.dock === dock} disabled={locked}
              onClick={() => changeContext(board.mode, dock)} className={`${button} text-xs ${board.dock === dock ? 'border-live/40 bg-live/10 text-live' : ''}`}>{dock}</button>)}
          </div>
        </section>
      </aside>
    </main>}

    {board?.interlock && <BlockingDialog title="Pemeriksaan dikunci">
      <span className="mb-4 inline-flex rounded-2xl bg-ng/10 p-3 text-ng"><LockKeyhole className="size-8" /></span>
      <h2 className="text-2xl font-extrabold">Stop · Call · Wait</h2>
      <p className="mt-3 text-sm text-ink-soft">{board.interlock.reason}</p>
      <dl className="my-5 space-y-3 rounded-xl border border-line bg-surface p-4 text-sm">
        <div><dt className="text-xs text-ink-muted">Seharusnya</dt><dd className="break-all font-bold">{board.interlock.expected || '—'}</dd></div>
        <div><dt className="text-xs text-ink-muted">Hasil scan</dt><dd className="break-all font-bold text-ng">{board.interlock.scanned || '—'}</dd></div>
      </dl>
      <p className="mb-4 text-sm">Hubungi JP / Leader untuk memeriksa part dan membuka kembali stasiun.</p>
      <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => unlockPisAction({ plantId: board.plantId, npk }))) setNpk(''); }}>
        <label htmlFor="pis-leader" className="mb-2 block text-sm font-bold">Scan NPK JP / Leader</label>
        <input id="pis-leader" autoFocus value={npk} onChange={(e) => setNpk(e.target.value)} className={field} autoComplete="off" />
        {error && <p role="alert" className="mt-3 text-sm text-ng">{error}</p>}
        <button className={`${button} mt-4 w-full bg-accent text-white hover:bg-accent-soft`} disabled={busy || !npk.trim()}>Verifikasi & buka kunci</button>
      </form>
    </BlockingDialog>}
    {board?.complete && !board.interlock && <BlockingDialog title="Packing selesai">
      <span className="mb-4 inline-flex rounded-2xl bg-ok/10 p-3 text-ok"><CheckCheck className="size-8" /></span>
      <h2 className="text-2xl font-extrabold">Packing selesai</h2>
      <p className="mt-3 text-ink-soft">Seluruh {total} pcs pada loading list berikut sudah dikonfirmasi.</p>
      <ul className="my-5 space-y-2 text-sm font-bold">{board.documents.map((doc) => <li key={doc.id} className="break-all">{doc.documentNumber}</li>)}</ul>
      {error && <p role="alert" className="mb-3 text-sm text-ng">{error}</p>}
      <button className={`${button} w-full bg-accent text-white hover:bg-accent-soft`} disabled={busy} onClick={() => void run(() => resetPisAction(board.plantId))}>OK · Scan loading list berikutnya</button>
    </BlockingDialog>}
  </div>;
}
