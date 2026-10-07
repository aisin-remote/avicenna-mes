import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import { listLoadingMutations } from '@/lib/loading-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { StatusChip, TruckChip } from '@/components/delivery/status-chip';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string; date?: string }>;
}

export default async function DeliveryMutationPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const query = sp.q?.trim().slice(0, 128) ?? '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date : undefined;
  const { data, meta } = await listLoadingMutations(page, 25, { date, query });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Logistik' }, { label: 'Mutation Delivery' }]}
        title="Mutation Delivery"
        description={`${meta.total} loading list tercatat${date ? ` pada ${formatDate(date)}` : ' dari seluruh periode'}`}
      />

      <Reveal>
        <Card className="mb-5 p-4">
          <form className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_190px_auto]" action="/trace">
            <input
              name="q"
              defaultValue={query}
              placeholder="Cari loading list, manifest, PDS, atau customer…"
              aria-label="Cari loading list"
              className="h-11 min-w-0 rounded-xl border border-line bg-surface px-4 text-[14px] outline-none transition-colors focus:border-ink focus:bg-card"
            />
            <input
              type="date"
              name="date"
              defaultValue={date}
              aria-label="Tanggal delivery"
              className="h-11 rounded-xl border border-line bg-surface px-4 text-[14px] outline-none transition-colors focus:border-ink focus:bg-card"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="h-11 flex-1 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft md:flex-none"
              >
                Tampilkan
              </button>
              {query || date ? (
                <Link
                  href="/trace"
                  className="grid h-11 place-items-center rounded-xl border border-line px-4 text-[14px] font-semibold text-ink-soft hover:border-ink hover:text-ink"
                >
                  Reset
                </Link>
              ) : null}
            </div>
          </form>
        </Card>
      </Reveal>

      <Reveal>
        <Card>
          <CardHeader
            icon={GitBranch}
            title="Loading list"
            subtitle="Rencana SAP dan progres aktual pulling sampai delivery"
          />
          <Table>
            <thead>
              <tr>
                <Th>Loading List</Th>
                <Th>Manifest / PDS</Th>
                <Th>PO / Type</Th>
                <Th>Customer</Th>
                <Th>Tanggal</Th>
                <Th align="right">Rit</Th>
                <Th align="right">Pulling</Th>
                <Th align="right">Loading</Th>
                <Th>Status</Th>
                <Th>Truk</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={10}>
                  Tidak ada loading list yang cocok dengan filter ini.
                </EmptyState>
              ) : (
                data.map((row) => (
                  <Tr key={row.id}>
                    <Td strong>
                      <Link
                        href={`/delivery/${row.id}`}
                        className="tabular underline underline-offset-4"
                      >
                        {row.documentNumber}
                      </Link>
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      <span className="block">{row.manifestNumber ?? '—'}</span>
                      <span className="block text-[12px] text-ink-muted">
                        PDS {row.pdsNumber ?? '—'}
                      </span>
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      <span className="block">{row.purchaseOrderNumber ?? '—'}</span>
                      <span className="block text-[12px] text-ink-muted">
                        {row.deliveryType ?? 'type —'}
                        {row.sapGiStatus ? ` · GI ${row.sapGiStatus}` : ''}
                      </span>
                    </Td>
                    <Td>{row.customerName ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">{formatDate(row.deliveryDate)}</Td>
                    <Td align="right" className="tabular">
                      {row.cycle}
                    </Td>
                    <Td align="right" className="tabular whitespace-nowrap">
                      <strong>{row.pickedKanban}</strong>
                      <span className="text-ink-muted"> / {row.plannedKanban}</span>
                    </Td>
                    <Td align="right" className="tabular whitespace-nowrap">
                      <strong>{row.actualKanban}</strong>
                      <span className="text-ink-muted"> / {row.pickedKanban}</span>
                    </Td>
                    <Td>
                      <StatusChip status={row.status} />
                    </Td>
                    <Td>
                      <TruckChip status={row.truckStatus} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <nav
          className="mt-5 flex items-center justify-between gap-3 text-[14px]"
          aria-label="Pagination"
        >
          {meta.page > 1 ? (
            <Link
              href={pageHref(meta.page - 1, query, date)}
              className="rounded-full border border-line px-4 py-2 font-semibold hover:border-ink"
            >
              Sebelumnya
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-muted">
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          {meta.page < meta.totalPages ? (
            <Link
              href={pageHref(meta.page + 1, query, date)}
              className="rounded-full border border-line px-4 py-2 font-semibold hover:border-ink"
            >
              Berikutnya
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function pageHref(page: number, query: string, date?: string): string {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set('q', query);
  if (date) params.set('date', date);
  return `/trace?${params.toString()}`;
}
