import Link from 'next/link';
import { MoveRight, ArrowRight } from 'lucide-react';
import { listTransfers } from '@/lib/transfer-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

export default async function TransferListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { data, meta } = await listTransfers(page, 25);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Transfer Antar Line' }]}
        title="Transfer Antar Line"
        description={`${meta.total} pemindahan tercatat`}
        actions={
          <Link
            href="/transfer/new"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
          >
            <MoveRight className="size-[18px]" strokeWidth={2.2} aria-hidden />
            Pindahkan Barang
          </Link>
        }
      />

      <Reveal>
        <Card>
          <CardHeader icon={MoveRight} title="Riwayat pemindahan" />
          <Table>
            <thead>
              <tr>
                <Th>No. Dokumen</Th>
                <Th>Dari</Th>
                <Th>Ke</Th>
                <Th>Waktu</Th>
                <Th align="right">Baris</Th>
                <Th align="right">Total Qty</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={6}>
                  Belum ada pemindahan. Tekan{' '}
                  <span className="font-semibold text-ink">Pindahkan Barang</span> untuk mencatat
                  yang pertama.
                </EmptyState>
              ) : (
                data.map((t) => (
                  <Tr key={t.id}>
                    <Td strong>
                      <Link href={`/transfer/${t.id}`} className="underline underline-offset-4">
                        {t.documentNumber}
                      </Link>
                    </Td>
                    <Td>{t.fromName ?? '—'}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <ArrowRight className="size-3.5 text-ink-muted" strokeWidth={2} aria-hidden />
                        {t.toName ?? '—'}
                      </span>
                    </Td>
                    <Td className="tabular whitespace-nowrap">
                      {new Date(t.movedAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Td>
                    <Td align="right" className="tabular">
                      {t.lineCount}
                    </Td>
                    <Td align="right" strong className="tabular">
                      {Number(t.totalQty).toLocaleString('id-ID')}
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
