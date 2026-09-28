import Link from 'next/link';
import {
  ArrowLeftRight,
  Boxes,
  CircleAlert,
  Layers3,
  MapPinOff,
  PackageCheck,
  Search,
  Waypoints,
} from 'lucide-react';
import { PROCESS_LABELS, PROCESS_TYPES } from '@avicenna/contracts';
import {
  JENIS_AKTIVITAS,
  LABEL_AKTIVITAS,
  LOCATION_KINDS,
  stockMonitor,
} from '@/lib/stock-monitoring';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Stagger, StaggerItem } from '@/components/motion/reveal';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

type SearchParams = {
  q?: string;
  plant?: string;
  process?: string;
  sloc?: string;
  activity?: string;
  from?: string;
  to?: string;
  bp?: string;
  mp?: string;
};

const LOCATION_LABELS: Record<string, string> = {
  WAREHOUSE: 'Warehouse',
  WIP: 'WIP',
  FINISH_GOOD: 'Finish Good',
  STAGING: 'Staging',
  CHUTE: 'Chute',
  NG: 'NG',
  TRANSIT: 'Transit',
};

const SAP_LABELS: Record<string, string> = {
  PENDING: 'Menunggu didorong',
  SENT: 'Menunggu SAP',
  CONFIRMED: 'Diterima SAP',
  REJECTED: 'Ditolak SAP',
  FAILED: 'Gagal didorong',
  HELD: 'Ditahan',
  SKIPPED: 'Tidak dikirim',
};

const INPUT_CLASS =
  'w-full rounded-xl border border-line bg-card px-3 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-ink';

export default async function StockPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const plant = Number(sp.plant);
  const hasil = await stockMonitor({
    search: sp.q,
    plantId: Number.isInteger(plant) && plant > 0 ? plant : undefined,
    processType: sp.process,
    locationKind: sp.sloc,
    activity: sp.activity,
    from: sp.from,
    to: sp.to,
    balancePage: halaman(sp.bp),
    movementPage: halaman(sp.mp),
  });

  const { filters, summary, balances, movements, balanceMeta, movementMeta } = hasil;
  const queryDasar = new URLSearchParams();
  if (filters.search) queryDasar.set('q', filters.search);
  if (filters.plantId) queryDasar.set('plant', String(filters.plantId));
  if (filters.processType) queryDasar.set('process', filters.processType);
  if (filters.locationKind) queryDasar.set('sloc', filters.locationKind);
  if (filters.activity) queryDasar.set('activity', filters.activity);
  queryDasar.set('from', filters.from);
  queryDasar.set('to', filters.to);

  const tautanHalaman = (key: 'bp' | 'mp', page: number) => {
    const query = new URLSearchParams(queryDasar);
    if (balanceMeta.page > 1) query.set('bp', String(balanceMeta.page));
    if (movementMeta.page > 1) query.set('mp', String(movementMeta.page));
    if (page > 1) query.set(key, String(page));
    else query.delete(key);
    return `/stock?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Logistik' }, { label: 'Monitoring Stok' }]}
        title="Monitoring Perpindahan Stok"
        description="Saldo terkini dan jejak perpindahan WIP–FG dari buku besar stok"
      />

      <Card className="mb-5 p-4">
        <form action="/stock" className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
          <label className="xl:col-span-2">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink-muted">Cari</span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                strokeWidth={1.8}
                aria-hidden
              />
              <input
                name="q"
                defaultValue={filters.search}
                placeholder="Part, back number, atau SLOC"
                className={cn(INPUT_CLASS, 'pl-9')}
              />
            </span>
          </label>
          <FilterSelect name="plant" label="Pabrik" value={filters.plantId ?? ''}>
            <option value="">Semua pabrik</option>
            {hasil.options.plants.map((plantRow) => (
              <option key={plantRow.id} value={plantRow.id}>
                {plantRow.code} · {plantRow.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect name="process" label="Proses" value={filters.processType}>
            <option value="">Semua proses</option>
            {PROCESS_TYPES.map((process) => (
              <option key={process} value={process}>
                {PROCESS_LABELS[process]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect name="sloc" label="Jenis SLOC" value={filters.locationKind}>
            <option value="">Semua SLOC</option>
            {LOCATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LOCATION_LABELS[kind] ?? kind}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect name="activity" label="Aktivitas" value={filters.activity}>
            <option value="">Semua aktivitas</option>
            {JENIS_AKTIVITAS.map((activity) => (
              <option key={activity} value={activity}>
                {LABEL_AKTIVITAS[activity]}
              </option>
            ))}
          </FilterSelect>
          <FilterDate name="from" label="Dari hari produksi" value={filters.from} />
          <FilterDate name="to" label="Sampai" value={filters.to} />
          <div className="flex items-end gap-2 xl:col-span-8 xl:justify-end">
            <Link
              href="/stock"
              className="rounded-full border border-line px-4 py-2.5 text-[14px] font-semibold transition-colors hover:border-ink"
            >
              Reset
            </Link>
            <button
              type="submit"
              className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-card transition-opacity hover:opacity-85"
            >
              Terapkan
            </button>
          </div>
        </form>
      </Card>

      <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StaggerItem>
          <StatCard
            label="Posisi stok"
            value={summary.positions}
            hint="kombinasi part dan SLOC"
            icon={Boxes}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Posisi WIP"
            value={summary.wip}
            hint="SLOC berjenis WIP"
            icon={Layers3}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Posisi FG"
            value={summary.finishGood}
            hint="SLOC finish good"
            icon={PackageCheck}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Saldo minus"
            value={summary.negative}
            hint="perlu rekonsiliasi"
            icon={CircleAlert}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Tanpa SLOC"
            value={summary.noSloc}
            hint="lokasi belum tercatat"
            icon={MapPinOff}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Pergerakan"
            value={summary.movements}
            hint={`${filters.from} s.d. ${filters.to}`}
            icon={ArrowLeftRight}
          />
        </StaggerItem>
      </Stagger>

      <AlurProduksi />

      <Card className="mt-6">
        <CardHeader
          icon={Boxes}
          title="Posisi stok terkini"
          subtitle={`${balanceMeta.total.toLocaleString('id-ID')} posisi berdasarkan seluruh mutasi sampai saat ini`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Part</Th>
              <Th>Rute produksi</Th>
              <Th>Pabrik / SLOC</Th>
              <Th>Jenis</Th>
              <Th align="right">Saldo</Th>
            </tr>
          </thead>
          <tbody>
            {balances.length === 0 ? (
              <EmptyState colSpan={5}>
                Tidak ada saldo yang cocok dengan saringan ini. Ubah proses atau SLOC untuk melihat
                posisi lain.
              </EmptyState>
            ) : (
              balances.map((row) => (
                <Tr key={`${row.partId}-${row.locationId ?? 'none'}`}>
                  <Td strong>
                    <div className="whitespace-nowrap">{row.partNumber}</div>
                    <div className="mt-0.5 text-[12px] font-normal text-ink-muted">
                      {[row.backNumber, row.partName, row.project].filter(Boolean).join(' · ') ||
                        '—'}
                    </div>
                  </Td>
                  <Td className="min-w-[260px]">
                    {row.route.length ? (
                      <div className="flex flex-wrap items-center gap-1 text-[12px]">
                        {row.route.map((route, index) => (
                          <span key={`${route}-${index}`} className="contents">
                            {index ? <span className="text-ink-muted">→</span> : null}
                            <span className="rounded-full border border-line bg-surface px-2 py-1 font-semibold text-ink-soft">
                              {route}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-ink-muted">Rute belum diatur</span>
                    )}
                  </Td>
                  <Td>
                    <div className="whitespace-nowrap font-semibold text-ink">
                      {row.locationCode ?? 'Tanpa SLOC'}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-muted">
                      {[row.plantCode, row.locationName].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </Td>
                  <Td>
                    <Pill
                      tone={
                        row.locationKind === 'FINISH_GOOD'
                          ? 'ok'
                          : row.locationKind === 'WIP'
                            ? 'warn'
                            : 'muted'
                      }
                    >
                      {row.locationKind
                        ? (LOCATION_LABELS[row.locationKind] ?? row.locationKind)
                        : 'Belum ditentukan'}
                    </Pill>
                  </Td>
                  <Td
                    align="right"
                    strong
                    className={cn('tabular whitespace-nowrap', row.balance < 0 && 'text-ng')}
                  >
                    {formatQty(row.balance)}{' '}
                    <span className="font-normal text-ink-muted">{row.uom}</span>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
      <Pagination meta={balanceMeta} href={(page) => tautanHalaman('bp', page)} label="posisi" />

      <Card className="mt-6">
        <CardHeader
          icon={Waypoints}
          title="Aktivitas perpindahan"
          subtitle={`${movementMeta.total.toLocaleString('id-ID')} aktivitas pada ${filters.from} s.d. ${filters.to}; transfer keluar dan masuk ditampilkan sebagai satu baris`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Waktu / proses</Th>
              <Th>Part</Th>
              <Th>Aktivitas</Th>
              <Th>Perpindahan</Th>
              <Th align="right">Qty / lot</Th>
              <Th>Status SAP</Th>
              <Th>Sumber</Th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 ? (
              <EmptyState colSpan={7}>
                Belum ada perpindahan pada hari produksi dan saringan ini.
              </EmptyState>
            ) : (
              movements.map((row) => (
                <Tr key={row.id}>
                  <Td className="whitespace-nowrap">
                    <div className="tabular font-semibold text-ink">
                      {formatWaktu(row.occurredAt)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Pill
                        tone={
                          row.processStage === 'FG' || row.processStage === 'ASSY FG'
                            ? 'ok'
                            : row.processStage === 'WIP'
                              ? 'warn'
                              : 'muted'
                        }
                      >
                        {row.processStage}
                      </Pill>
                      <span className="text-[12px] text-ink-muted">
                        {row.processLabel ?? row.lineCode ?? 'Tanpa proses'}
                      </span>
                    </div>
                  </Td>
                  <Td strong>
                    <div className="whitespace-nowrap">{row.partNumber}</div>
                    <div className="mt-0.5 text-[12px] font-normal text-ink-muted">
                      {[row.backNumber, row.partName].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </Td>
                  <Td>
                    <Pill tone={row.activity === 'TRANSFER' ? 'accent' : 'muted'}>
                      {row.activityLabel}
                    </Pill>
                  </Td>
                  <Td className="min-w-[250px]">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold text-ink">{row.fromName}</span>
                      <span className="text-accent">→</span>
                      <span className="font-semibold text-ink">{row.toName}</span>
                    </div>
                    {row.destinationLineCode || row.note ? (
                      <div className="mt-1 text-[12px] text-ink-muted">
                        {[
                          row.destinationLineCode ? `line ${row.destinationLineCode}` : null,
                          row.note,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </Td>
                  <Td align="right" className="tabular whitespace-nowrap">
                    <div className="font-semibold text-ink">
                      {formatQty(row.qty)} {row.uom}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-muted">
                      lot {row.lotNumber ?? '—'}
                    </div>
                  </Td>
                  <Td>
                    <Pill tone={toneSap(row.sapStatus)}>
                      {row.sapStatus
                        ? (SAP_LABELS[row.sapStatus] ?? row.sapStatus)
                        : 'Belum masuk antrean'}
                    </Pill>
                    {row.sapDocNumber || row.sapError ? (
                      <div
                        className={cn(
                          'mt-1 max-w-[220px] text-[12px]',
                          row.sapError ? 'text-ng' : 'text-ink-muted',
                        )}
                      >
                        {row.sapDocNumber ?? row.sapError}
                      </div>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-[12px] text-ink-muted">
                    <div>
                      {row.sourceTable ?? 'Tanpa sumber'}
                      {row.sourceId ? ` #${row.sourceId}` : ''}
                    </div>
                    <div className="mt-0.5">
                      NPK {row.npk ?? '—'} · {row.plantCode ?? '—'}
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
      <Pagination
        meta={movementMeta}
        href={(page) => tautanHalaman('mp', page)}
        label="aktivitas"
      />
    </>
  );
}

function halaman(value?: string) {
  return Math.max(1, Number(value ?? 1) || 1);
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string | number;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[12px] font-semibold text-ink-muted">{label}</span>
      <select name={name} defaultValue={value} className={INPUT_CLASS}>
        {children}
      </select>
    </label>
  );
}

function FilterDate({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label>
      <span className="mb-1.5 block text-[12px] font-semibold text-ink-muted">{label}</span>
      <input type="date" name={name} defaultValue={value} className={INPUT_CLASS} />
    </label>
  );
}

function AlurProduksi() {
  const items = [
    ['Casting WIP', 'lanjut ke Machining atau proses berikut'],
    ['Casting FG', 'hasil akhir Casting menuju Delivery'],
    ['Machining WIP', 'lanjut ke Assembling'],
    ['Machining FG / Assy', 'finish good menuju Delivery'],
  ];
  return (
    <Card className="mt-6 px-5 py-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="shrink-0 xl:w-44">
          <p className="text-[13px] font-bold text-ink">Arti WIP dan FG</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Perpindahan dicatat otomatis saat scan.
          </p>
        </div>
        <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {items.map(([title, description]) => (
            <div key={title} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <div className="text-[12px] font-bold text-ink">{title}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{description}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Pill({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'ok' | 'warn' | 'ng' | 'accent' | 'muted';
}) {
  const tones = {
    ok: 'border-ok/35 bg-ok/8 text-ok',
    warn: 'border-warn/35 bg-warn/8 text-warn',
    ng: 'border-ng/35 bg-ng/8 text-ng',
    accent: 'border-accent/35 bg-accent/8 text-accent',
    muted: 'border-line bg-surface text-ink-muted',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function toneSap(status: string | null): 'ok' | 'warn' | 'ng' | 'accent' | 'muted' {
  if (status === 'CONFIRMED') return 'ok';
  if (status === 'REJECTED' || status === 'FAILED') return 'ng';
  if (status === 'SENT' || status === 'HELD') return 'warn';
  if (status === 'PENDING') return 'accent';
  return 'muted';
}

function formatQty(value: number) {
  return value.toLocaleString('id-ID', { maximumFractionDigits: 4 });
}

function formatWaktu(value: Date | string) {
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Pagination({
  meta,
  href,
  label,
}: {
  meta: { page: number; total: number; totalPages: number };
  href: (page: number) => string;
  label: string;
}) {
  if (meta.totalPages <= 1) return null;
  return (
    <nav
      className="mt-4 flex items-center justify-between gap-3 text-[14px]"
      aria-label={`Halaman ${label}`}
    >
      <span className="text-ink-muted">
        Halaman {meta.page} dari {meta.totalPages} · {meta.total.toLocaleString('id-ID')} {label}
      </span>
      <span className="flex gap-2">
        {meta.page > 1 ? (
          <Link
            href={href(meta.page - 1)}
            className="rounded-full border border-line px-4 py-2 font-semibold hover:border-ink"
          >
            Sebelumnya
          </Link>
        ) : null}
        {meta.page < meta.totalPages ? (
          <Link
            href={href(meta.page + 1)}
            className="rounded-full border border-line px-4 py-2 font-semibold hover:border-ink"
          >
            Berikutnya
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
