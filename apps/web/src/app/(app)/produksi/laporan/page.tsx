import { Fragment } from 'react';
import { ClipboardList, Download, TriangleAlert } from 'lucide-react';
import type { LaporanProduksi } from '@avicenna/contracts';
import { laporanProduksi } from '@/lib/laporan-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/**
 * Laporan produksi per tanggal × shift × line, dengan rincian per part.
 *
 * Angkanya dari hitungan yang sama dengan Dashboard Efisiensi, jadi keduanya
 * tidak pernah berbeda. Paling panjang 31 hari sekali tampil.
 */
export default async function LaporanProduksiPage({
  searchParams,
}: {
  searchParams: Promise<{ plant?: string; dari?: string; sampai?: string }>;
}) {
  const q = await searchParams;
  let lap: LaporanProduksi | null = null;
  let galat: string | null = null;
  try {
    lap = await laporanProduksi(q);
  } catch (e) {
    galat = e instanceof Error ? e.message : 'Laporan tidak bisa dihitung';
  }

  const unduh = new URLSearchParams();
  if (lap?.plant) unduh.set('plant', lap.plant.code);
  if (lap) {
    unduh.set('dari', lap.dari);
    unduh.set('sampai', lap.sampai);
  }

  const total = lap?.ringkas.reduce(
    (a, r) => ({
      ok: a.ok + r.ok,
      ril: a.ril + r.ril,
      rol: a.rol + r.rol,
      menitBersih: a.menitBersih + (r.efisiensi !== null ? r.menitBersih : 0),
      menitDihasilkan: a.menitDihasilkan + (r.menitDihasilkan ?? 0),
    }),
    { ok: 0, ril: 0, rol: 0, menitBersih: 0, menitDihasilkan: 0 },
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Laporan Produksi' }]}
        title="Laporan Produksi"
        description="OK, RIL, ROL, dan efisiensi per shift per line"
      />

      <Card className="mb-5 p-4">
        <form action="/produksi/laporan" className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Pabrik</span>
            <select
              name="plant"
              defaultValue={lap?.plant?.code ?? q.plant}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
            >
              {(lap?.plants ?? []).map((p) => (
                <option key={p.id} value={p.code}>
                  {p.code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Dari</span>
            <input
              type="date"
              name="dari"
              defaultValue={lap?.dari ?? q.dari}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Sampai</span>
            <input
              type="date"
              name="sampai"
              defaultValue={lap?.sampai ?? q.sampai}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
            />
          </label>
          <button
            type="submit"
            className="h-11 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            Tampilkan
          </button>
          {lap && lap.ringkas.length > 0 ? (
            <a
              href={`/produksi/laporan/unduh?${unduh.toString()}`}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-[14px] font-semibold text-ink-soft hover:border-ink hover:text-ink"
            >
              <Download className="size-4" strokeWidth={2} aria-hidden />
              Unduh CSV
            </a>
          ) : null}
        </form>
      </Card>

      {galat || lap?.pesan ? (
        <Card className="flex items-start gap-2 px-6 py-5 text-[14px] text-ink-soft">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
          {galat ?? lap?.pesan}
        </Card>
      ) : lap && lap.ringkas.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada produksi pada rentang ini.
        </Card>
      ) : lap && total ? (
        <Card>
          <CardHeader
            icon={ClipboardList}
            title={`${lap.plant?.code ?? ''} · ${lap.dari === lap.sampai ? lap.dari : `${lap.dari} s/d ${lap.sampai}`}`}
            subtitle={`OK ${total.ok.toLocaleString('id-ID')} · RIL ${total.ril} · ROL ${total.rol} · efisiensi ${
              total.menitBersih > 0
                ? `${((total.menitDihasilkan / total.menitBersih) * 100).toFixed(1)}%`
                : '—'
            }`}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-[13.5px]">
              <thead>
                <tr className="border-y border-line bg-surface text-left text-[12px] uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-3 font-semibold">Tanggal / Shift</th>
                  <th className="px-3 py-3 font-semibold">Line / Part</th>
                  <th className="px-3 py-3 text-right font-semibold">OK</th>
                  <th className="px-3 py-3 text-right font-semibold">RIL</th>
                  <th className="px-3 py-3 text-right font-semibold">ROL</th>
                  <th className="px-3 py-3 text-right font-semibold">CT (dtk)</th>
                  <th className="px-3 py-3 text-right font-semibold">Menit hasil</th>
                  <th className="px-3 py-3 text-right font-semibold">Menit kerja</th>
                  <th className="px-3 py-3 text-right font-semibold">Berhenti</th>
                  <th className="px-5 py-3 text-right font-semibold">Efisiensi</th>
                </tr>
              </thead>
              <tbody>
                {lap.ringkas.map((r) => (
                  <Fragment key={`${r.tanggal}-${r.shift}-${r.lineCode}`}>
                    <tr className="border-t border-line bg-card font-semibold">
                      <td className="tabular px-5 py-3">
                        {r.tanggal} · S{r.shift}
                      </td>
                      <td className="px-3 py-3">
                        {r.lineCode}
                        <span className="ml-2 font-normal text-ink-muted">{r.lineName}</span>
                      </td>
                      <td className="tabular px-3 py-3 text-right">{r.ok}</td>
                      <td className="tabular px-3 py-3 text-right">
                        {r.ril}
                        <span className="block text-[12px] font-normal text-ink-muted">
                          {persen(r.rilPct, 2)}
                        </span>
                      </td>
                      <td className="tabular px-3 py-3 text-right">
                        {r.rol}
                        <span className="block text-[12px] font-normal text-ink-muted">
                          {persen(r.rolPct, 2)}
                        </span>
                      </td>
                      <td className="px-3 py-3" />
                      <td className="tabular px-3 py-3 text-right">{r.menitDihasilkan ?? '—'}</td>
                      <td className="tabular px-3 py-3 text-right">{r.menitBersih}</td>
                      <td className="tabular px-3 py-3 text-right">{r.menitBerhenti}</td>
                      <td className="tabular px-5 py-3 text-right">{persen(r.efisiensi)}</td>
                    </tr>
                    {r.baris.map((b) => (
                      <tr key={b.partNumber} className="text-ink-soft">
                        <td className="px-5 py-2" />
                        <td className="px-3 py-2 pl-7">
                          <span className="font-semibold text-ink">
                            {b.backNumber ?? b.partNumber}
                          </span>
                          {b.backNumber ? <span className="tabular"> · {b.partNumber}</span> : null}
                        </td>
                        <td className="tabular px-3 py-2 text-right">{b.ok}</td>
                        <td className="tabular px-3 py-2 text-right">{b.ril}</td>
                        <td className="tabular px-3 py-2 text-right">{b.rol}</td>
                        <td className="tabular px-3 py-2 text-right">
                          {b.cycleTime ?? <span className="text-warn">kosong</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right">{b.menitDihasilkan ?? '—'}</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2" />
                        <td className="px-5 py-2" />
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function persen(v: number | null, d = 1): string {
  return v === null ? '—' : `${v.toFixed(d)}%`;
}
