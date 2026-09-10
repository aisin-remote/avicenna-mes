import Link from 'next/link';
import { Truck, Plus } from 'lucide-react';
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
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { data, meta } = await listLoadings(page, 25);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pengiriman' }]}
        title="Pengiriman"
        description={`${meta.total} loading list tercatat`}
        actions={
          <Link
            href="/delivery/new"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            <Plus className="size-[18px]" strokeWidth={2.4} aria-hidden />
            Buat Loading List
          </Link>
        }
      />

      <Reveal>
        <Card>
          <CardHeader icon={Truck} title="Loading list" />
          <Table>
            <thead>
              <tr>
                <Th>No. Dokumen</Th>
                <Th>PDS</Th>
                <Th>Customer</Th>
                <Th>Tanggal</Th>
                <Th align="right">Rit</Th>
                <Th align="right">Kanban</Th>
                <Th>Status</Th>
                <Th>Truk</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={8}>
                  Belum ada loading list. Tekan{' '}
                  <span className="font-semibold text-ink">Buat Loading List</span> untuk membuat
                  yang pertama.
                </EmptyState>
              ) : (
                data.map((d) => (
                  <Tr key={d.id}>
                    <Td strong>
                      <Link href={`/delivery/${d.id}`} className="underline underline-offset-4">
                        {d.documentNumber}
                      </Link>
                    </Td>
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
                    {/* Aktual dan rencana berdampingan — selisihnya yang pertama ditanya
                        ketika kiriman tidak sesuai. */}
                    <Td align="right" strong className="tabular whitespace-nowrap">
                      <span className={d.actualKanban > d.plannedKanban ? 'text-ng' : undefined}>
                        {d.actualKanban}
                      </span>
                      <span className="font-normal text-ink-muted"> / {d.plannedKanban}</span>
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
