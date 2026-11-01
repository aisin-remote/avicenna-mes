'use client';
import type { PreparationGroup, PreparationSnapshot } from '@avicenna/contracts';
import { preparationDateAt } from '@avicenna/domain';
import { Card } from '@/components/ui/card';
import { dateTime, isLate, prepLabels, truckLabels, truckState } from './format';

export function PreparationTimeline({
  data,
  now,
  etaHours,
  finishHours,
  select,
}: {
  data: PreparationSnapshot;
  now: number;
  etaHours: number;
  finishHours: number;
  select: (g: PreparationGroup) => void;
}) {
  const start = Date.parse(preparationDateAt(data.filters.from, '00:00'));
  const end = Date.parse(preparationDateAt(data.filters.to, '00:00', 1));
  const days = Math.round((end - start) / 86400000);
  const weekly = days > 1;
  const groups = new Map<string, PreparationGroup[]>();
  for (const g of data.cycleGroups) {
    const key = `${g.plantId}|${g.customerId}`;
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const position = (v: number) => ((v - start) / (end - start)) * 100;
  const markers = [
    { at: now, label: 'Sekarang', color: '#3b82f6' },
    { at: now + etaHours * 3600000, label: `ETA +${etaHours}j`, color: '#a855f7' },
    { at: now + finishHours * 3600000, label: `Finish +${finishHours}j`, color: '#f97316' },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-lg font-bold">
          {weekly ? 'Ringkasan mingguan delivery' : 'Timeline delivery'}
        </h2>
        <span className="text-sm text-ink-muted">{data.cycleGroups.length} delivery · WIB</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line p-4 text-xs">
        <span className="text-emerald-500">● Close pulling / pick up on time</span>
        <span className="text-amber-500">● On progress pulling</span>
        <span className="text-red-500">● Delay pulling / delivery</span>
        <span className="text-orange-500">● Delay pick up</span>
        <span className="text-ink-muted">● Belum mulai / belum ada jadwal</span>
      </div>
      {!groups.size ? (
        <p className="p-12 text-center text-sm text-ink-muted">
          Belum ada delivery di periode ini. Sync data SAP atau pilih tanggal yang memiliki loading
          list.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-b-card">
          <div style={{ minWidth: weekly ? Math.max(1100, days * 230) : 1100 }}>
            <div className="flex border-b border-line bg-surface/60 text-[10px] font-semibold">
              <div className="sticky left-0 z-20 w-48 shrink-0 bg-card px-4 py-4">
                Customer / Pabrik
              </div>
              <div className="relative flex min-w-0 flex-1">
                {Array.from({ length: weekly ? days : 24 }, (_, i) => (
                  <span key={i} className="flex-1 border-l border-line py-4 text-center">
                    {weekly
                      ? new Intl.DateTimeFormat('id-ID', {
                          timeZone: 'Asia/Jakarta',
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                        }).format(new Date(start + i * 86400000))
                      : `${String(i).padStart(2, '0')}:00`}
                  </span>
                ))}
              </div>
            </div>
            {[...groups.entries()].map(([key, rows]) => {
              const scheduled = rows
                .filter((g) => g.preparationStartAt && g.deadlineAt)
                .sort((a, b) => a.preparationStartAt!.localeCompare(b.preparationStartAt!));
              const laneEnds: number[] = [];
              const placed = scheduled.map((g) => {
                const at = Date.parse(g.preparationStartAt!);
                let lane = laneEnds.findIndex((e) => e <= at);
                if (lane < 0) lane = laneEnds.length;
                laneEnds[lane] = Date.parse(g.deadlineAt!);
                return { g, lane };
              });
              const truckLanes: number[] = [];
              const trucks = rows
                .filter((g) => g.truckEtaAt)
                .sort((a, b) => a.truckEtaAt!.localeCompare(b.truckEtaAt!))
                .map((g) => {
                  const p = position(Date.parse(g.truckEtaAt!));
                  let lane = truckLanes.findIndex((e) => e + (weekly ? 5 : 8) < p);
                  if (lane < 0) lane = truckLanes.length;
                  truckLanes[lane] = p;
                  return { g, lane, p };
                });
              const prepHeight = Math.max(1, laneEnds.length) * 42 + 20;
              const truckHeight = Math.max(1, truckLanes.length) * 34 + 20;
              const unconfigured = rows.filter((g) => !g.deadlineAt);
              return (
                <div key={key} className="flex border-b border-line last:border-b-0">
                  <div className="sticky left-0 z-20 w-48 shrink-0 border-r border-line bg-card p-4">
                    <p className="text-sm font-bold">{rows[0]!.customerName}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {rows[0]!.plantCode} · {rows.length} cycle
                    </p>
                    <p className="mt-3 text-xs text-emerald-500">
                      {rows.reduce((n, g) => n + g.pickedKanban, 0)} /{' '}
                      {rows.reduce((n, g) => n + g.plannedKanban, 0)} kanban
                    </p>
                    {unconfigured.length > 0 && (
                      <p className="mt-2 text-xs text-amber-500">
                        {unconfigured.length} jadwal belum diatur
                      </p>
                    )}
                  </div>
                  <div
                    className="relative min-w-0 flex-1 overflow-hidden"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, var(--color-line, #8882) 1px, transparent 1px)',
                      backgroundSize: `${100 / (weekly ? days : 24)}% 100%`,
                    }}
                  >
                    <div className="relative" style={{ height: prepHeight }}>
                      <span className="absolute left-2 top-1 text-[10px] text-ink-muted">
                        PREPARATION
                      </span>
                      {placed.map(({ g, lane }) => {
                        const left = Math.max(0, position(Date.parse(g.preparationStartAt!))),
                          right = Math.min(100, position(Date.parse(g.deadlineAt!)));
                        if (right <= left) return null;
                        const segments = data.pdsGroups.filter((p) =>
                          p.documents.some((d) => g.documents.some((gd) => gd.id === d.id)),
                        );
                        return (
                          <div
                            key={g.key}
                            className="absolute flex gap-px rounded-lg bg-surface ring-1 ring-line"
                            style={{
                              left: `${left}%`,
                              width: `${right - left}%`,
                              top: lane * 42 + 20,
                              height: 28,
                            }}
                          >
                            {segments.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                onClick={() => select(p)}
                                title={`${p.customerName} · Cycle ${p.cycle} · ${p.pdsNumbers.join(', ') || 'Tanpa PDS'}\n${dateTime(p.preparationStartAt)} – ${dateTime(p.deadlineAt)}\n${p.pickedKanban}/${p.plannedKanban} kanban · ${prepLabels[p.status]}`}
                                className="relative min-w-0 overflow-hidden rounded-lg border border-line px-2 text-left text-[11px] font-bold transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-blue-500"
                                style={{ flex: Math.max(1, p.plannedKanban) }}
                              >
                                <span
                                  className="absolute inset-y-0 left-0 opacity-75"
                                  style={{
                                    width: `${p.progress}%`,
                                    backgroundColor: isLate(p)
                                      ? '#ef4444'
                                      : p.completed
                                        ? '#10b981'
                                        : '#f59e0b',
                                  }}
                                />
                                <span className="relative block truncate">
                                  C{g.cycle} · {p.progress}% {p.pdsNumbers.join(', ')}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <div
                      className="relative border-t border-dashed border-line"
                      style={{ height: truckHeight }}
                    >
                      <span className="absolute left-2 top-1 text-[10px] text-ink-muted">
                        TRUCK
                      </span>
                      {trucks.map(({ g, lane, p }) =>
                        p >= 0 && p < 100 ? (
                          <button
                            key={g.key}
                            type="button"
                            onClick={() => select(g)}
                            title={`Cycle ${g.cycle} · ETA ${dateTime(g.truckEtaAt)}\n${truckLabels[truckState(g, now)]}\n${g.documents.map((d) => `${d.documentNumber}: ${dateTime(d.truckPickedAt)}`).join('\n')}`}
                            className="absolute max-w-32 truncate rounded-full px-2 py-1 text-[10px] font-bold text-white"
                            style={{
                              left: `${Math.min(92, p)}%`,
                              top: lane * 34 + 18,
                              backgroundColor:
                                truckState(g, now) === 'DELIVERY_DELAY'
                                  ? '#991b1b'
                                  : truckState(g, now) === 'PICKED_LATE'
                                    ? '#f97316'
                                    : g.documents.every((d) => d.truckPickedAt)
                                      ? '#166534'
                                      : '#64748b',
                            }}
                          >
                            ◆ C{g.cycle} ·{' '}
                            {new Intl.DateTimeFormat('id-ID', {
                              timeZone: 'Asia/Jakarta',
                              hour: '2-digit',
                              minute: '2-digit',
                            }).format(new Date(g.truckEtaAt!))}
                          </button>
                        ) : null,
                      )}
                    </div>
                    {unconfigured.length > 0 && (
                      <div className="flex flex-wrap gap-2 border-t border-dashed border-line p-3">
                        {unconfigured.map((g) => (
                          <button
                            key={g.key}
                            onClick={() => select(g)}
                            title={g.scheduleIssue ?? ''}
                            className="rounded-lg border border-line px-3 py-2 text-xs"
                          >
                            Cycle {g.cycle} · {g.progress}% · Jadwal belum diatur
                          </button>
                        ))}
                      </div>
                    )}
                    {markers.map((m) => {
                      const p = position(m.at);
                      return p >= 0 && p < 100 ? (
                        <div
                          key={m.label}
                          className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed"
                          style={{ left: `${p}%`, borderColor: m.color }}
                        >
                          <span
                            className="absolute top-0 whitespace-nowrap rounded px-1 text-[9px] text-white"
                            style={{ backgroundColor: m.color }}
                          >
                            {m.label}
                          </span>
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="border-t border-line px-5 py-3 text-xs text-ink-muted">
        Klik bar preparation atau truck untuk rincian PDS, loading list, item dan dokumen cetak.
        Hover untuk rincian jam.
      </div>
    </Card>
  );
}
