'use client';
import { CustomerDocumentArchive } from '@/components/delivery/customer-document-archive';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PreparationDetail, PreparationGroup, PreparationSnapshot } from '@avicenna/contracts';
import { Expand, Minimize, RefreshCw, Settings2, Volume2, VolumeX } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { PreparationTimeline } from './timeline';
import { MasterCycle } from './master-cycle';
import { PreparationDialog } from './dialog';
import { dateTime, prepLabels, isLate, truckLabels, truckState } from './format';
import {
  preparationDetailAction,
  syncPreparationAction,
} from '@/app/(app)/preparation-monitoring/actions';

const field =
  'h-10 rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-ink';
export function PreparationMonitoring({
  data,
  canManage,
  initialDocumentId,
}: {
  data: PreparationSnapshot;
  canManage: boolean;
  initialDocumentId?: number;
}) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const acknowledged = useRef(new Set<string>());
  const [now, setNow] = useState(Date.parse(data.asOf));
  const [tab, setTab] = useState<'DASHBOARD' | 'MASTER'>('DASHBOARD');
  const [selected, setSelected] = useState<PreparationGroup | null>(
    () => data.pdsGroups.find((g) => g.documents.some((d) => d.id === initialDocumentId)) ?? null,
  );
  const [settings, setSettings] = useState(false);
  const [etaHours, setEtaHours] = useState(0);
  const [finishHours, setFinishHours] = useState(4);
  const [sound, setSound] = useState(false);
  const [alarm, setAlarm] = useState<PreparationGroup[]>([]);
  const [tv, setTv] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncDate, setSyncDate] = useState(data.filters.from);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncNotes, setSyncNotes] = useState<string[]>([]);
  const [pending, transition] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    try {
      const stored = JSON.parse(localStorage.getItem('avicenna:prep-window') ?? 'null') as {
        eta?: number;
        finish?: number;
      } | null;
      if (stored && Number.isInteger(stored.eta) && Math.abs(stored.eta!) <= 24)
        setEtaHours(stored.eta!);
      if (stored && Number.isInteger(stored.finish) && Math.abs(stored.finish!) <= 24)
        setFinishHours(stored.finish!);
      acknowledged.current = new Set(
        JSON.parse(sessionStorage.getItem('avicenna:prep-ack') ?? '[]') as string[],
      );
    } catch {
      /* Browser storage may be blocked; the monitor still works. */
    }
    return () => {
      clearInterval(timer);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && tab === 'DASHBOARD' && !selected && !settings && !syncing && !pending)
        transition(() => router.refresh());
    }, 30000);
    return () => clearInterval(timer);
  }, [router, tab, selected, settings, syncing, pending]);
  useEffect(() => {
    const onFullscreen = () => {
      if (!document.fullscreenElement) setTv(false);
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);
  const late = data.cycleGroups.filter(isLate);
  const truckLate = data.cycleGroups.filter((g) =>
    ['PICKED_LATE', 'DELIVERY_DELAY'].includes(truckState(g, now)),
  );
  const alertKey = (g: PreparationGroup) => `${g.key}|${g.deadlineAt}`;
  useEffect(() => {
    if (tab !== 'DASHBOARD' || selected || settings) return;
    const overdue = data.cycleGroups.filter(
      (g) => g.status === 'OVERDUE' && !acknowledged.current.has(alertKey(g)),
    );
    if (overdue.length) setAlarm(overdue);
  }, [data, selected, settings, tab]);
  useEffect(() => {
    if (!sound || !alarm.length) return;
    const beep = () => {
      const ctx = audio.current;
      if (!ctx || ctx.state !== 'running') return;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.25);
    };
    beep();
    const timer = window.setInterval(beep, 2500);
    return () => clearInterval(timer);
  }, [sound, alarm.length]);
  function dismissAlarm() {
    for (const g of alarm) acknowledged.current.add(alertKey(g));
    try {
      sessionStorage.setItem('avicenna:prep-ack', JSON.stringify([...acknowledged.current]));
    } catch {
      /* Session-only acknowledgement remains in memory. */
    }
    setAlarm([]);
  }
  async function fullscreen() {
    if (tv) {
      if (document.fullscreenElement) await document.exitFullscreen();
      setTv(false);
      return;
    }
    setTv(true);
    try {
      await root.current?.requestFullscreen();
    } catch {
      setSyncMessage(
        'Fullscreen tidak diizinkan browser; gunakan tombol Full Screen lagi setelah berinteraksi.',
      );
      setTv(false);
    }
  }
  async function sync() {
    setSyncing(true);
    setSyncMessage('Membaca SAP untuk 3 hari…');
    setSyncNotes([]);
    try {
      const result = await syncPreparationAction(syncDate);
      if ('error' in result) setSyncMessage(result.error ?? 'Sinkronisasi gagal.');
      else {
        const rows = result.data.results;
        setSyncMessage(
          `Sync selesai: ${rows.reduce((n, r) => n + r.baru, 0)} baru, ${rows.reduce((n, r) => n + r.diperbarui, 0)} diperbarui, ${rows.reduce((n, r) => n + r.dilewati, 0)} dilewati.`,
        );
        setSyncNotes(rows.flatMap((r) => r.catatan.map((c) => `${r.entitas}: ${c}`)));
        router.refresh();
      }
    } finally {
      setSyncing(false);
    }
  }
  const picked = data.cycleGroups.filter(
    (g) => g.documents.length && g.documents.every((d) => !!d.truckPickedAt),
  ).length;
  return (
    <div ref={root} className={tv ? 'h-dvh overflow-y-auto bg-surface p-6 text-ink' : 'space-y-5'}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav
          className="flex rounded-full border border-line bg-card p-1"
          aria-label="Tab preparation"
        >
          <button
            onClick={() => setTab('DASHBOARD')}
            className={`rounded-full px-5 py-2 text-sm font-semibold ${tab === 'DASHBOARD' ? 'bg-ink text-card' : 'text-ink-muted'}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setTab('MASTER')}
            className={`rounded-full px-5 py-2 text-sm font-semibold ${tab === 'MASTER' ? 'bg-ink text-card' : 'text-ink-muted'}`}
          >
            Master Cycle
          </button>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-sm tabular-nums text-ink-muted" suppressHydrationWarning>
            {new Intl.DateTimeFormat('id-ID', {
              timeZone: 'Asia/Jakarta',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }).format(new Date(now))}{' '}
            WIB
          </span>
          <Button
            variant="outline"
            size="sm"
            icon={sound ? Volume2 : VolumeX}
            onClick={async () => {
              if (!sound) {
                try {
                  audio.current ??= new AudioContext();
                  await audio.current.resume();
                  setSound(true);
                } catch {
                  setSyncMessage('Audio tidak tersedia pada browser ini.');
                }
              } else setSound(false);
            }}
          >
            {sound ? 'Alarm on' : 'Alarm off'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={tv ? Minimize : Expand}
            onClick={() => void fullscreen()}
          >
            {tv ? 'Keluar' : 'Full Screen'}
          </Button>
        </div>
      </div>
      {tab === 'MASTER' ? (
        <>
          <Card className="mb-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Pengaturan Rentang ETA</h2>
                <p className="mt-1 text-sm text-ink-muted">
                  ETA truck {etaHours >= 0 ? '+' : ''}
                  {etaHours} jam · Finish preparation {finishHours >= 0 ? '+' : ''}
                  {finishHours} jam dari sekarang.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                icon={Settings2}
                onClick={() => setSettings(true)}
              >
                Setting Rentang
              </Button>
            </div>
          </Card>
          <MasterCycle data={data} canManage={canManage} />
        </>
      ) : (
        <div className="space-y-5">
          <Card className="p-5">
            <form action="/preparation-monitoring" className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-xs text-ink-muted">
                Delivery date dari
                <input
                  name="from"
                  type="date"
                  required
                  defaultValue={data.filters.from}
                  className={field}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-ink-muted">
                Sampai
                <input
                  name="to"
                  type="date"
                  required
                  defaultValue={data.filters.to}
                  className={field}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-ink-muted">
                Customer
                <select
                  name="customerId"
                  defaultValue={data.filters.customerId ?? ''}
                  className={field}
                >
                  <option value="">Semua customer</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs text-ink-muted">
                Cycle
                <input
                  name="cycle"
                  type="number"
                  min={1}
                  max={9999}
                  defaultValue={data.filters.cycle ?? ''}
                  placeholder="Semua"
                  className={`${field} w-24`}
                />
              </label>
              <label className="grid gap-1.5 text-xs text-ink-muted">
                Status
                <select name="status" defaultValue={data.filters.status} className={field}>
                  <option value="ALL">Semua</option>
                  <option value="INCOMPLETE">Incomplete</option>
                  <option value="COMPLETE">Complete</option>
                  <option value="LATE">Telat</option>
                </select>
              </label>
              <Button size="sm" type="submit">
                Tampilkan
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={RefreshCw}
                disabled={pending}
                onClick={() => transition(() => router.refresh())}
              >
                {pending ? 'Memuat…' : 'Muat ulang'}
              </Button>
            </form>
            {canManage && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <label className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  Tanggal awal sync (3 hari)
                  <input
                    type="date"
                    required
                    value={syncDate}
                    onChange={(e) => setSyncDate(e.target.value)}
                    className={field}
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncing || !syncDate || !data.source.configured}
                  onClick={() => void sync()}
                >
                  {syncing ? 'Sinkronisasi…' : 'Sync data SAP'}
                </Button>
                <span className="text-xs text-ink-muted">
                  {data.syncs[0]
                    ? `Terakhir sync ${dateTime(data.syncs[0].syncedAt)}`
                    : 'Belum pernah sync pada periode ini'}
                </span>
              </div>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              {data.source.message} · Refresh layar otomatis 30 detik · Snapshot{' '}
              {dateTime(data.asOf, true)}
            </p>
            {syncMessage && (
              <p role="status" className="mt-3 text-sm">
                {syncMessage}
              </p>
            )}
            {syncNotes.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer">
                  Catatan sinkronisasi ({syncNotes.length})
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {syncNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Total delivery',
                value: data.cycleGroups.length,
                sub: 'customer · cycle · destination',
                color: 'text-blue-500',
              },
              {
                label: 'Sudah pick up',
                value: picked,
                sub: `dari ${data.cycleGroups.length} truck`,
                color: 'text-emerald-500',
              },
              {
                label: 'Prep telat',
                value: late.length,
                sub: `${new Set(late.map((g) => g.customerId)).size} customer`,
                color: 'text-red-500',
              },
              {
                label: 'Truck delay',
                value: truckLate.length,
                sub: 'delay pick up / belum tiba lewat ETA',
                color: 'text-orange-500',
              },
            ].map((k) => (
              <Card key={k.label} className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {k.label}
                </p>
                <p className={`mt-3 text-3xl font-bold ${k.color}`}>{k.value}</p>
                <p className="mt-2 text-xs text-ink-muted">{k.sub}</p>
              </Card>
            ))}
          </div>
          {late.length > 0 && (
            <details className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-red-500">
                {late.length} preparation telat — lihat rincian
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {late.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => setSelected(g)}
                    className="rounded-lg border border-red-500/30 px-3 py-2 text-xs"
                  >
                    {g.customerName} · C{g.cycle} · {g.missingKanban} kanban kurang · Deadline{' '}
                    {dateTime(g.deadlineAt)}
                  </button>
                ))}
              </div>
            </details>
          )}
          <PreparationTimeline
            data={data}
            now={now}
            etaHours={etaHours}
            finishHours={finishHours}
            select={setSelected}
          />
        </div>
      )}
      {selected && (
        <PreparationDocuments
          key={selected.key}
          group={selected}
          initialDocumentId={initialDocumentId}
          close={() => setSelected(null)}
        />
      )}
      {settings && (
        <PreparationDialog title="Setting Rentang" close={() => setSettings(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const eta = Number(fd.get('eta')),
                finish = Number(fd.get('finish'));
              setEtaHours(eta);
              setFinishHours(finish);
              try {
                localStorage.setItem('avicenna:prep-window', JSON.stringify({ eta, finish }));
              } catch {
                /* Settings remain usable without storage. */
              }
              setSettings(false);
            }}
          >
            <p className="text-sm text-ink-muted">
              Garis penanda relatif terhadap waktu sekarang. Tidak mengubah deadline Master Cycle.
            </p>
            <label className="grid gap-2 text-sm">
              ETA truck (jam dari sekarang)
              <input
                className={field}
                name="eta"
                type="number"
                min={-24}
                max={24}
                required
                defaultValue={etaHours}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Finish preparation (jam dari sekarang)
              <input
                className={field}
                name="finish"
                type="number"
                min={-24}
                max={24}
                required
                defaultValue={finishHours}
              />
            </label>
            <Button type="submit">Simpan pengaturan</Button>
          </form>
        </PreparationDialog>
      )}
      {alarm.length > 0 && !selected && !settings && (
        <PreparationDialog title="Preparation melewati deadline" close={dismissAlarm}>
          <p className="mb-4 text-sm text-ink-muted">
            Preparation berikut belum selesai. Konfirmasi hanya menutup alarm di sesi browser ini,
            tidak mengubah status delivery.
          </p>
          <div className="space-y-2">
            {alarm.map((g) => (
              <button
                key={g.key}
                onClick={() => {
                  dismissAlarm();
                  setSelected(g);
                }}
                className="block w-full rounded-xl border border-red-500/30 p-3 text-left text-sm"
              >
                {g.customerName} · C{g.cycle} · {g.progress}% · {g.missingKanban} kanban kurang
                <br />
                <span className="text-xs text-ink-muted">Deadline {dateTime(g.deadlineAt)}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={dismissAlarm}>Saya sudah lihat</Button>
          </div>
        </PreparationDialog>
      )}
    </div>
  );
}

function PreparationDocuments({
  group,
  close,
  initialDocumentId,
}: {
  group: PreparationGroup;
  close: () => void;
  initialDocumentId?: number;
}) {
  const [id, setId] = useState(
    () => group.documents.find((d) => d.id === initialDocumentId)?.id ?? group.documents[0]?.id ?? 0,
  );
  const [detail, setDetail] = useState<PreparationDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError('');
    void preparationDetailAction(id).then((r) => {
      if (!active) return;
      if ('error' in r) setError(r.error ?? 'Detail belum dapat dimuat.');
      else setDetail(r.data);
    });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <PreparationDialog
      title={`${group.customerName} · Cycle ${group.cycle} · ${group.pdsNumbers.join(', ') || 'Tanpa PDS'}`}
      close={close}
    >
      <div className="mb-5 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <span className="text-xs text-ink-muted">Preparation</span>
          <p className="mt-1 font-semibold">
            {dateTime(group.preparationStartAt)} – {dateTime(group.deadlineAt)}
          </p>
        </div>
        <div>
          <span className="text-xs text-ink-muted">Progress pulling</span>
          <p className="mt-1 font-semibold">
            {group.pickedKanban} / {group.plannedKanban} kanban · {group.progress}%
          </p>
          <p className={isLate(group) ? 'text-red-500' : 'text-ink-muted'}>
            {prepLabels[group.status]}
          </p>
        </div>
        <div>
          <span className="text-xs text-ink-muted">ETA truck</span>
          <p className="mt-1 font-semibold">{dateTime(group.truckEtaAt)}</p>
          <p className="text-xs text-ink-muted">{truckLabels[truckState(group, Date.now())]}</p>
        </div>
      </div>
      {group.scheduleIssue && (
        <p className="mb-4 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-500">
          {group.scheduleIssue}
        </p>
      )}
      <div className="mb-5 flex flex-wrap gap-2">
        {group.documents.map((d) => (
          <button
            key={d.id}
            onClick={() => setId(d.id)}
            className={`rounded-xl border px-4 py-2 text-sm ${id === d.id ? 'border-ink bg-surface font-bold' : 'border-line'}`}
          >
            {d.documentNumber} · {d.pickedKanban}/{d.plannedKanban}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      ) : !detail ? (
        <p role="status" className="py-8 text-center text-sm text-ink-muted">
          Memuat item loading list…
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold">{detail.document.documentNumber}</h3>
              <p className="mt-1 text-xs text-ink-muted">
                Manifest {detail.document.manifestNumber ?? '—'} · PDS{' '}
                {detail.document.pdsNumber ?? '—'} · {detail.document.status}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs font-semibold">
              {[
                { path: '', label: 'Detail delivery' },
                { path: '/picklist', label: 'Loading list' },
                { path: '/label', label: 'Kanban Internal' },
              ].map((l) => (
                <Link
                  key={l.path}
                  href={`/delivery/${id}${l.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-line px-3 py-2 hover:bg-surface"
                >
                  {l.label} ↗
                </Link>
              ))}
            </div>
          </div>
          <CustomerDocumentArchive key={id} deliveryId={id} />
          <Table>
            <thead>
              <tr>
                <Th>Back no / Part</Th>
                <Th>Part customer</Th>
                <Th>Plan</Th>
                <Th>Pulling</Th>
                <Th>Kurang</Th>
                <Th>Loading</Th>
                <Th>Qty / box</Th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <Tr key={l.id}>
                  <Td strong>
                    {l.backNumber ?? l.partNumber}
                    <span className="block text-xs font-normal text-ink-muted">
                      {l.partNumber} · {l.name}
                    </span>
                  </Td>
                  <Td>{l.customerBackNumber ?? l.customerPartNumber ?? '—'}</Td>
                  <Td>{l.plannedKanban}</Td>
                  <Td>{l.pickedKanban}</Td>
                  <Td>
                    <span
                      className={
                        l.pickedKanban < l.plannedKanban
                          ? 'font-bold text-red-500'
                          : 'text-emerald-500'
                      }
                    >
                      {Math.max(0, l.plannedKanban - l.pickedKanban)}
                    </span>
                  </Td>
                  <Td>{l.loadedKanban}</Td>
                  <Td>{l.qtyPerKanban}</Td>
                </Tr>
              ))}
              {!detail.lines.length && (
                <EmptyState colSpan={7}>Item belum tersedia dari SAP.</EmptyState>
              )}
            </tbody>
          </Table>
          <h3 className="mb-3 mt-6 font-bold">Perbandingan produksi &amp; pulling</h3>
          {detail.historyTruncated && (
            <p className="mb-3 text-xs text-amber-500">
              Riwayat dibatasi 1.000 event terakhir; gunakan Mutation Delivery untuk penelusuran
              lebih lanjut.
            </p>
          )}
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th>Seri customer</Th>
                <Th>Seri internal</Th>
                <Th>Produksi</Th>
                <Th>Pulling</Th>
                <Th>Selisih deadline</Th>
              </tr>
            </thead>
            <tbody>
              {detail.scans
                .filter((s) => s.phase === 'PULLING')
                .map((s) => {
                  const delta = group.deadlineAt
                    ? Math.round((Date.parse(s.at) - Date.parse(group.deadlineAt)) / 60000)
                    : null;
                  return (
                    <Tr key={s.id}>
                      <Td>
                        {detail.lines.find((l) => l.id === s.lineId)?.backNumber ??
                          detail.lines.find((l) => l.id === s.lineId)?.partNumber ??
                          s.partId}
                      </Td>
                      <Td>{s.customerSerial ?? '—'}</Td>
                      <Td>{s.internalSerial ?? s.serial ?? '—'}</Td>
                      <Td>
                        {s.producedAt ? dateTime(s.producedAt, true) : 'Belum ada jejak produksi'}
                      </Td>
                      <Td>{dateTime(s.at, true)}</Td>
                      <Td>
                        <span
                          className={
                            delta !== null && delta > 0
                              ? 'font-semibold text-red-500'
                              : 'text-emerald-500'
                          }
                        >
                          {delta === null
                            ? 'Jadwal belum diatur'
                            : `${delta > 0 ? '+' : ''}${delta} menit`}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              {!detail.scans.some((s) => s.phase === 'PULLING') && (
                <EmptyState colSpan={6}>
                  Belum ada scan pulling aktif untuk loading list ini.
                </EmptyState>
              )}
            </tbody>
          </Table>
        </>
      )}
    </PreparationDialog>
  );
}
