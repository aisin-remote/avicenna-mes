import Link from 'next/link';
import { PackagePlus, Truck } from 'lucide-react';
import { listReceipts } from '@/lib/receiving-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Chip } from '@/components/ui/chip';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

export default async function ReceivingListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { data, meta } = await listReceipts(page, 25);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Penerimaan Barang' }]}
        title="Penerimaan Barang"
        description={`${meta.total} kedatangan tercatat`}
        actions={
          <Link
            href="/receiving/new"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            <PackagePlus className="size-[18px]" strokeWidth={2.2} aria-hidden />
            Terima Barang
          </Link>
        }
      />

      <Reveal>
        <Card>
          <CardHeader icon={Truck} title="Riwayat kedatangan" />
          <Table>
            <thead>
              <tr>
                <Th>No. Dokumen</Th>
                <Th>Surat Jalan</Th>
                <Th>Supplier</Th>
                <Th>Waktu</Th>
                <Th align="right">Baris</Th>
                <Th align="right">Total Qty</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={6}>
                  Belum ada penerimaan. Tekan{' '}
                  <span className="font-semibold text-ink">Terima Barang</span> untuk mencatat
                  kedatangan pertama.
                </EmptyState>
              ) : (
                data.map((r) => (
                  <Tr key={r.id}>
                    <Td strong>
                      <Link href={`/receiving/${r.id}`} className="underline underline-offset-4">
                        {r.documentNumber}
                      </Link>
                    </Td>
                    <Td>{r.supplierDocNumber ?? '—'}</Td>
                    <Td>{r.supplierName ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {new Date(r.receivedAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Td>
                    <Td align="right" className="tabular">
                      {r.lineCount}
                    </Td>
                    <Td align="right" strong className="tabular">
                      {Number(r.totalQty).toLocaleString('id-ID')}
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
