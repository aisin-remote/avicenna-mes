import Link from 'next/link';
import { AlertTriangle, ClipboardList, Truck } from 'lucide-react';
import { listLoadings } from '@/lib/loading-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { StatusChip, TruckChip } from '@/components/delivery/status-chip';

export const dynamic = 'force-dynamic';

export default async function DeliveryListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; date?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date : undefined;
  const attentionOnly = sp.view === 'attention';
  const { data, meta } = await listLoadings(page, 25, date, attentionOnly ? 'only' : 'all');
  const allTotal = meta.allTotal ?? meta.total;
  const attentionTotal = meta.attention ?? 0;
  const start = new Date(`${meta.operationalDate}T06:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const period = `${start.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} 06:00 – ${end.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })} 06:00`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pengiriman' }]}
        title="Pengiriman"
        description={`${allTotal} loading list dari SAP · ${period}`}
        actions={
          <form className="flex items-center gap-2" action="/delivery">
            {attentionOnly ? <input type="hidden" name="view" value="attention" /> : null}
            <input
              type="date"
              name="date"
              defaultValue={meta.operationalDate}
              aria-label="Hari pengiriman"
              className="h-11 rounded-full border border-line bg-card px-4 text-[14px] outline-none focus:border-line-strong"
            />
            <button
              type="submit"
              className="h-11 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:border-ink"
            >
              Tampilkan
            </button>
          </form>
        }
      />

      <Reveal>
        <nav className="mb-5 grid gap-3 sm:grid-cols-2" aria-label="Filter pengiriman">
          <Link
            href={filterHref(meta.operationalDate, false)}
            aria-current={!attentionOnly ? 'page' : undefined}
            className={`rounded-card border p-4 transition-colors ${
              !attentionOnly
                ? 'border-accent bg-accent/10'
                : 'border-line bg-card hover:border-line-strong'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-muted">Semua pengiriman</span>
              <ClipboardList className="size-5 text-ink-muted" strokeWidth={1.8} aria-hidden />
            </div>
            <p className="tabular mt-2 text-[28px] font-extrabold">{allTotal}</p>
          </Link>
          <Link
            href={filterHref(meta.operationalDate, true)}
            aria-current={attentionOnly ? 'page' : undefined}
            className={`rounded-card border p-4 transition-colors ${
              attentionOnly
                ? 'border-ng bg-ng/10'
                : attentionTotal > 0
                  ? 'border-ng/35 bg-ng/5 hover:border-ng'
                  : 'border-line bg-card hover:border-line-strong'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-muted">Perlu tindakan</span>
              <AlertTriangle
                className={attentionTotal > 0 ? 'size-5 text-ng' : 'size-5 text-ink-muted'}
                strokeWidth={1.8}
                aria-hidden
              />
            </div>
            <p
              className={`tabular mt-2 text-[28px] font-extrabold ${attentionTotal ? 'text-ng' : ''}`}
            >
              {attentionTotal}
            </p>
          </Link>
        </nav>
      </Reveal>

      <Reveal>
        <Card>
          <CardHeader
            icon={attentionOnly ? AlertTriangle : Truck}
            title={attentionOnly ? 'Loading list perlu tindakan' : 'Loading list'}
            subtitle={
              attentionOnly
                ? 'Selisih operasional dan Good Issue SAP yang harus ditangani'
                : 'Klik loading list untuk melihat detail dan tindakan'
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Loading List</Th>
                <Th>Manifest</Th>
                <Th>PDS</Th>
                <Th>Customer</Th>
                <Th>Tanggal</Th>
                <Th align="right">Rit</Th>
                <Th align="right">Diambil</Th>
                <Th align="right">Dimuat</Th>
                <Th>Status</Th>
                <Th>Truk</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={10}>
                  {attentionOnly
                    ? 'Tidak ada masalah pengiriman yang perlu ditangani.'
                    : 'Belum ada data pengiriman dari SAP/staging untuk periode ini.'}
                </EmptyState>
              ) : (
                data.map((d) => (
                  <Tr key={d.id}>
                    <Td strong>
                      <Link href={`/delivery/${d.id}`} className="underline underline-offset-4">
                        {d.documentNumber}
                      </Link>
                      {d.attentionReason ? (
                        <span className="mt-1 flex max-w-56 items-center gap-1.5 text-[11px] font-semibold text-ng">
                          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                          {d.attentionReason}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="tabular">{d.manifestNumber ?? '—'}</Td>
                    <Td className="tabular">{d.pdsNumber ?? '—'}</Td>
                    <Td>{d.customerName ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {new Date(`${d.deliveryDate}T00:00:00`).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Td>
                    <Td align="right" className="tabular">
                      {d.cycle}
                    </Td>
                    {/* Tiap tahap berdampingan dengan sasarannya — selisihnya yang
                        pertama ditanya ketika kiriman tidak sesuai. */}
                    <Td align="right" className="tabular whitespace-nowrap">
                      <span className={d.pickedKanban > d.plannedKanban ? 'text-ng' : undefined}>
                        {d.pickedKanban}
                      </span>
                      <span className="text-ink-muted"> / {d.plannedKanban}</span>
                    </Td>
                    <Td align="right" strong className="tabular whitespace-nowrap">
                      <span className={d.actualKanban > d.pickedKanban ? 'text-ng' : undefined}>
                        {d.actualKanban}
                      </span>
                      <span className="font-normal text-ink-muted"> / {d.pickedKanban}</span>
                    </Td>
                    <Td>
                      <StatusChip status={d.status} />
                    </Td>
                    <Td>
                      <TruckChip status={d.truckStatus} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <p className="mt-5 text-[14px] text-ink-muted">
          Halaman {meta.page} dari {meta.totalPages}
        </p>
      ) : null}
    </>
  );
}

function filterHref(date: string, attention: boolean): string {
  const params = new URLSearchParams({ date });
  if (attention) params.set('view', 'attention');
  return `/delivery?${params.toString()}`;
}
