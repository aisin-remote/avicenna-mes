import Link from 'next/link';
import { Gauge, LineChart, TriangleAlert } from 'lucide-react';
import type { DashboardEfisiensi, EfisiensiLini } from '@avicenna/contracts';
import { dashboardEfisiensi } from '@/lib/laporan-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { cn } from '@/components/ui/cn';
import { GrafikEfisiensiJam } from '@/components/laporan/grafik-efisiensi-jam';
import { MuatUlangBerkala } from '@/components/laporan/muat-ulang-berkala';

export const dynamic = 'force-dynamic';

interface Cari {
  plant?: string;
  tanggal?: string;
  shift?: string;
  proses?: string;
  lini?: string;
}

/**
 * Dashboard efisiensi — padanan HOURLY / PER SHIFT EFFICIENCY sistem lama.
 *
 * Efisiensi = OK × cycle time ÷ (jam shift − istirahat). Tanpa cycle time di
 * rute, persennya tampil "—", bukan nol. Shift yang sedang berjalan
 * disegarkan tiap menit.
 */
export default async function DashboardEfisiensiPage({
  searchParams,
}: {
  searchParams: Promise<Cari>;
}) {
  const q = await searchParams;
  const d = await dashboardEfisiensi(q);
  const fokus = q.lini ? d.lini.find((l) => l.lineCode === q.lini) : undefined;
  const seri = fokus ? fokus.perJam : d.total.perJam;
  const prosesAda = [...new Set(d.lini.map((l) => l.processType).filter(Boolean))] as string[];
  if (q.proses && !prosesAda.includes(q.proses)) prosesAda.push(q.proses);

  const tautan = (ubah: Partial<Cari>) => {
    const p = new URLSearchParams();
    const gabung = {
      plant: d.plant?.code,
      tanggal: d.tanggal,
      shift: d.shift?.code,
      proses: q.proses,
      lini: q.lini,
      ...ubah,
    };
    for (const [k, v] of Object.entries(gabung)) if (v) p.set(k, v);
    return `/produksi/efisiensi?${p.toString()}`;
  };

  return (
    <>
      <MuatUlangBerkala aktif={d.jamSekarang !== null} />
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Dashboard Efisiensi' }]}
        title="Dashboard Efisiensi"
        description={
          d.shift
            ? `${d.plant?.code ?? ''} · ${d.shift.name} ${d.shift.mulai}–${d.shift.selesai} · ${tanggalPanjang(d.tanggal)}${d.jamSekarang !== null ? ' · berjalan' : ''}`
            : 'Efisiensi per jam dan per shift'
        }
      />

      {/* Satu baris penyaring di atas seluruh isi; semua angka di bawahnya ikut. */}
      <Card className="mb-5 p-4">
        <form action="/produksi/efisiensi" className="flex flex-wrap items-end gap-3">
          <Pilih label="Pabrik" name="plant" nilai={d.plant?.code}>
            {d.plants.map((p) => (
              <option key={p.id} value={p.code}>
                {p.code}
              </option>
            ))}
          </Pilih>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold">Tanggal produksi</span>
            <input
              type="date"
              name="tanggal"
              defaultValue={d.tanggal}
              className="h-11 rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
            />
          </label>
          <Pilih label="Shift" name="shift" nilai={d.shift?.code}>
            {d.shifts.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.mulai}–{s.selesai})
              </option>
            ))}
          </Pilih>
          <Pilih label="Proses" name="proses" nilai={q.proses ?? ''}>
            <option value="">Semua proses</option>
            {prosesAda.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Pilih>
          <button
            type="submit"
            className="h-11 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            Tampilkan
          </button>
          <Link
            href="/produksi/efisiensi"
            className="grid h-11 place-items-center rounded-xl border border-line px-4 text-[14px] font-semibold text-ink-soft hover:border-ink hover:text-ink"
          >
            Shift berjalan
          </Link>
        </form>
      </Card>

      {d.pesan ? (
        <Card className="flex items-start gap-2 px-6 py-5 text-[14px] text-ink-soft">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
          {d.pesan}
        </Card>
      ) : d.lini.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada scan produksi pada shift ini.
        </Card>
      ) : (
        <div className="space-y-5">
          <Ringkas d={d} />

          <Card>
            <CardHeader
              icon={Gauge}
              title={d.jamSekarang !== null ? 'Efisiensi jam ini' : 'Efisiensi per line'}
              subtitle="Klik line untuk melihat grafik per jamnya"
            />
            <div className="grid gap-3 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {d.lini.map((l) => (
                <Ubin
                  key={l.lineId}
                  l={l}
                  dipilih={l.lineCode === q.lini}
                  href={tautan({ lini: l.lineCode === q.lini ? undefined : l.lineCode })}
                />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={LineChart}
              title={`Efisiensi per jam — ${fokus ? fokus.lineCode : 'semua line'}`}
              subtitle={
                fokus ? (
                  <Link href={tautan({ lini: undefined })} className="underline underline-offset-4">
                    Kembali ke semua line
                  </Link>
                ) : (
                  'Gabungan line yang punya cycle time'
                )
              }
            />
            <div className="px-4 pb-2 sm:px-6">
              <GrafikEfisiensiJam data={seri} jamSekarang={d.jamSekarang} />
            </div>
            {/* Tampilan tabel: setiap nilai di grafik terbaca tanpa hover. */}
            <div className="overflow-x-auto px-6 pb-6">
              <table className="w-full min-w-[560px] text-[12.5px]">
                <tbody>
                  <tr className="text-ink-muted">
                    <th className="py-1.5 pr-3 text-left font-semibold">Jam</th>
                    {seri.map((j) => (
                      <td key={j.ke} className="tabular py-1.5 text-right">
                        {j.label}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th className="py-1.5 pr-3 text-left font-semibold text-ink-muted">OK</th>
                    {seri.map((j) => (
                      <td key={j.ke} className="tabular py-1.5 text-right">
                        {j.ok}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th className="py-1.5 pr-3 text-left font-semibold text-ink-muted">
                      Efisiensi
                    </th>
                    {seri.map((j) => (
                      <td key={j.ke} className="tabular py-1.5 text-right font-semibold">
                        {persen(j.efisiensi)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={Gauge}
              title="RIL / ROL per line"
              subtitle="RIL = NG input di line, ROL = NG outline; dibagi OK + seluruh NG"
            />
            <Table>
              <thead>
                <tr>
                  <Th>Line</Th>
                  <Th align="right">OK</Th>
                  <Th align="right">RIL</Th>
                  <Th align="right">ROL</Th>
                  <Th align="right">Efisiensi shift</Th>
                  <Th align="right">Menit kerja</Th>
                  <Th align="right">Berhenti</Th>
                </tr>
              </thead>
              <tbody>
                {d.lini.length === 0 ? (
                  <EmptyState colSpan={7}>Belum ada data.</EmptyState>
                ) : (
                  d.lini.map((l) => (
                    <Tr key={l.lineId}>
                      <Td strong>
                        {l.lineCode}
                        {l.model ? (
                          <span className="block text-[12px] font-normal text-ink-muted">
                            {l.model}
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right" className="tabular">
                        {l.ok}
                      </Td>
                      <Td align="right" className="tabular">
                        {persen(l.rilPct, 2)}
                        <span className="block text-[12px] text-ink-muted">{l.ril} pcs</span>
                      </Td>
                      <Td align="right" className="tabular">
                        {persen(l.rolPct, 2)}
                        <span className="block text-[12px] text-ink-muted">{l.rol} pcs</span>
                      </Td>
                      <Td align="right" className="tabular font-semibold">
                        {persen(l.efisiensiShift)}
                      </Td>
                      <Td align="right" className="tabular">
                        {l.menitBersih}
                      </Td>
                      <Td align="right" className="tabular">
                        {l.menitBerhenti} mnt
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

function Ringkas({ d }: { d: DashboardEfisiensi }) {
  const angka = [
    { label: 'Efisiensi shift', nilai: persen(d.total.efisiensi) },
    { label: 'OK', nilai: d.total.ok.toLocaleString('id-ID') },
    { label: 'RIL', nilai: persen(d.total.rilPct, 2) },
    { label: 'ROL', nilai: persen(d.total.rolPct, 2) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {angka.map((a) => (
        <Card key={a.label} className="p-5">
          <div className="text-[12.5px] font-semibold text-ink-muted">{a.label}</div>
          <div className="mt-1 text-[30px] font-extrabold leading-none">{a.nilai}</div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Satu line: angka besar + meter. Meter, bukan gauge setengah lingkaran:
 * panjang batang terbaca lebih tepat daripada sudut busur, dan deretan meter
 * yang sejajar bisa dibandingkan sekilas.
 */
function Ubin({ l, dipilih, href }: { l: EfisiensiLini; dipilih: boolean; href: string }) {
  const nilai = l.efisiensiJam;
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-2xl border bg-surface p-4 transition-colors hover:border-line-strong',
        dipilih ? 'border-ink' : 'border-line',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[17px] font-bold">{l.lineCode}</span>
        <span className="truncate text-[12px] text-ink-muted">{l.model ?? l.lineName}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[34px] font-extrabold leading-none">{persen(nilai)}</span>
        {l.labelJam ? <span className="text-[12px] text-ink-muted">jam {l.labelJam}</span> : null}
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-data-1/15"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={nilai ?? undefined}
        aria-label={`Efisiensi ${l.lineCode}`}
      >
        {nilai !== null ? (
          <div
            className="h-full rounded-full bg-data-1"
            style={{ width: `${Math.min(100, Math.max(0, nilai))}%` }}
          />
        ) : null}
      </div>
      <div className="mt-2.5 text-[12.5px] text-ink-soft">
        Shift {persen(l.efisiensiShift)} · OK {l.ok}
        {l.menitBerhenti > 0 ? ` · berhenti ${l.menitBerhenti} mnt` : ''}
      </div>
      {nilai === null && l.efisiensiShift === null ? (
        <div className="mt-1 text-[12px] text-warn">Cycle time belum diisi di rute line ini</div>
      ) : l.okTanpaCt > 0 ? (
        <div className="mt-1 text-[12px] text-warn">
          {l.okTanpaCt} pcs tanpa cycle time tidak ikut dihitung
        </div>
      ) : null}
    </Link>
  );
}

function Pilih({
  label,
  name,
  nilai,
  children,
}: {
  label: string;
  name: string;
  nilai: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold">{label}</span>
      <select
        name={name}
        defaultValue={nilai}
        className="h-11 rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
      >
        {children}
      </select>
    </label>
  );
}

function persen(v: number | null, d = 1): string {
  return v === null ? '—' : `${v.toFixed(d)}%`;
}

function tanggalPanjang(t: string): string {
  return new Date(`${t}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
