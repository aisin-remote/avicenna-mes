'use client';
import { useEffect, useState } from 'react';
import type { DriverAttendanceHistory as History, DeliveryFlow } from '@avicenna/contracts';
import { driverHistoryAction } from '@/app/(station)/delivery-return/actions';
import { refreshDriverFlowAction } from '@/app/(app)/delivery/actions';
import { DeliveryFlowPanel } from './delivery-flow';
import { pickupDuration, pickupTime } from './driver-attendance-format';

export function DriverAttendanceHistory({
  plantId,
  today,
  version,
}: {
  plantId: number;
  today: string;
  version: number;
}) {
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [page, setPage] = useState(1),
    [data, setData] = useState<History | null>(null);
  const [error, setError] = useState(''),
    [detail, setDetail] = useState<number | null>(null),
    [flow, setFlow] = useState<DeliveryFlow | null>(null),
    [flowError, setFlowError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setData(null);
    void driverHistoryAction(plantId, from, to, page).then((r) => {
      if (!active) return;
      if ('error' in r) setError(r.error ?? 'Riwayat belum dapat dimuat.');
      else setData(r.data);
    });
    return () => {
      active = false;
    };
  }, [plantId, from, to, page, version]);
  async function status(id: number) {
    setFlowError('');
    setFlow(null);
    const result = await refreshDriverFlowAction(id);
    if ('error' in result) setFlowError(result.error);
    else setFlow(result.data);
  }
  const query = new URLSearchParams({ plantId: String(plantId), from, to });
  return (
    <section className="rounded-3xl border border-line bg-card p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Riwayat Absensi Driver</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Waktu pickup, bukti safety, foto driver, dan DO yang dibawa.
          </p>
        </div>
        <a
          href={`/api/driver-attendance/export?${query}`}
          className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-semibold"
        >
          Export Excel
        </a>
      </div>
      <div className="mb-5 flex flex-wrap gap-3 text-sm">
        <label>
          Dari
          <input
            aria-label="Tanggal awal riwayat"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="ml-2 min-h-11 rounded-xl border border-line bg-surface px-3"
          />
        </label>
        <label>
          Sampai
          <input
            aria-label="Tanggal akhir riwayat"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="ml-2 min-h-11 rounded-xl border border-line bg-surface px-3"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="py-4 text-sm text-ng">
          {error}
        </p>
      ) : !data ? (
        <p role="status" className="py-8 text-center text-ink-muted">
          Memuat riwayat…
        </p>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase text-ink-muted">
                  {[
                    'Customer / Dock',
                    'Truck',
                    'Cycle',
                    'LP',
                    'Mulai · WIB',
                    'Selesai · WIB',
                    'Durasi',
                    'DO',
                    '',
                  ].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id} className="border-b border-line">
                    <td className="px-3 py-4">
                      <strong>{r.destinationName}</strong>
                      <p className="mt-1 text-xs text-ink-muted">{r.dock}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">
                      0{r.slot} · {r.slot === 1 ? 'Depan' : 'Belakang'}
                    </td>
                    <td className="px-3 py-4">C{r.cycle}</td>
                    <td className="px-3 py-4">{r.logistic}</td>
                    <td className="whitespace-nowrap px-3 py-4">{pickupTime(r.startedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-4">
                      {r.endedAt ? (
                        pickupTime(r.endedAt)
                      ) : (
                        <span className="text-amber-500">Sedang Pickup</span>
                      )}
                    </td>
                    <td className="px-3 py-4 font-mono">
                      {r.endedAt ? pickupDuration(r.startedAt, r.endedAt) : '—'}
                    </td>
                    <td className="px-3 py-4">{r.orders.length}</td>
                    <td className="px-3 py-4">
                      <button
                        onClick={() => {
                          setDetail(detail === r.id ? null : r.id);
                          setFlow(null);
                          setFlowError('');
                        }}
                        className="min-h-11 rounded-full border border-line px-4 font-semibold"
                      >
                        Rincian
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.data.length && (
              <p className="py-12 text-center text-sm text-ink-muted">
                Belum ada absensi pada rentang tanggal ini.
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <p>
              {data.total} pickup · Halaman {page}
            </p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="min-h-11 rounded-full border border-line px-4 disabled:opacity-40"
              >
                Sebelumnya
              </button>
              <button
                disabled={page * data.perPage >= data.total}
                onClick={() => setPage(page + 1)}
                className="min-h-11 rounded-full border border-line px-4 disabled:opacity-40"
              >
                Berikutnya
              </button>
            </div>
          </div>
          {data.data
            .filter((r) => r.id === detail)
            .map((r) => (
              <div key={r.id} className="mt-5 rounded-2xl border border-line bg-surface p-4">
                <h3 className="font-bold">
                  {r.destinationName} · C{r.cycle}
                </h3>
                <div className="my-4 grid gap-4 sm:grid-cols-[200px_1fr]">
                  <a href={`/api/driver-attendance/${r.id}/photo`} target="_blank" rel="noreferrer">
                    <img
                      src={`/api/driver-attendance/${r.id}/photo`}
                      alt={`Foto driver pickup ${r.id}`}
                      className="aspect-video w-full rounded-xl object-contain"
                    />
                  </a>
                  <div className="space-y-2 text-sm">
                    <p>
                      Helm Safety: <strong>{r.helmet ? 'Ya' : 'Tidak'}</strong>
                    </p>
                    <p>
                      Rompi Safety: <strong>{r.vest ? 'Ya' : 'Tidak'}</strong>
                    </p>
                    <p>
                      Sepatu Safety: <strong>{r.shoes ? 'Ya' : 'Tidak'}</strong>
                    </p>
                    <p className="text-xs text-ink-muted">Klik foto untuk memperbesar.</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {r.orders.map((o) => (
                    <div
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-3 text-sm"
                    >
                      <div>
                        <strong>{o.number}</strong>
                        <p className="mt-1 text-xs text-ink-muted">
                          {o.pdsNumber} ·{' '}
                          {o.shippedAt
                            ? 'Berangkat · GI AII berhasil'
                            : o.driverScannedAt
                              ? 'Menunggu konfirmasi GI AII'
                              : 'Pickup belum selesai'}
                        </p>
                      </div>
                      <button
                        onClick={() => void status(o.id)}
                        className="min-h-11 rounded-full border border-line px-4 text-xs font-semibold"
                      >
                        Status SAP
                      </button>
                    </div>
                  ))}
                </div>
                {flowError && (
                  <p role="alert" className="mt-3 text-sm text-ng">
                    {flowError}
                  </p>
                )}
                {flow && (
                  <div className="mt-4">
                    <DeliveryFlowPanel flow={flow} allowRefresh={false} />
                  </div>
                )}
              </div>
            ))}
        </>
      )}
    </section>
  );
}
