import { notFound } from 'next/navigation';
import { ArrowRight, Boxes } from 'lucide-react';
import { getTransfer } from '@/lib/transfer-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr } from '@/components/ui/table';
import { Chip } from '@/components/ui/chip';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

export default async function TransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  let transfer;
  try {
    transfer = await getTransfer(numericId);
  } catch {
    notFound();
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Transfer Antar Line', href: '/transfer' },
          { label: transfer.documentNumber },
        ]}
        title={transfer.documentNumber}
        description={new Date(transfer.movedAt).toLocaleString('id-ID')}
        actions={<Chip value={transfer.status} />}
      />

      <Reveal>
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-center gap-4 text-[16px] font-semibold">
            <span>{transfer.fromName ?? '—'}</span>
            <ArrowRight className="size-5 text-ink-muted" strokeWidth={2} aria-hidden />
            <span>{transfer.toName ?? '—'}</span>
          </div>
          {transfer.note ? (
            <p className="mt-2 text-[14px] text-ink-muted">{transfer.note}</p>
          ) : null}
        </Card>
      </Reveal>

      <Reveal>
        <Card>
          <CardHeader
            icon={Boxes}
            title="Barang yang dipindahkan"
            subtitle={`${transfer.lines.length} baris`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Part Number</Th>
                <Th>Nama</Th>
                <Th>Lot / Seri</Th>
                <Th align="right">Jumlah</Th>
                <Th>Satuan</Th>
              </tr>
            </thead>
            <tbody>
              {transfer.lines.map((l) => (
                <Tr key={l.id}>
                  <Td strong>{l.partNumber ?? '—'}</Td>
                  <Td>{l.partName ?? '—'}</Td>
                  <Td className="tabular">{l.lotNumber ?? l.serialNumber ?? '—'}</Td>
                  <Td align="right" strong className="tabular">
                    {Number(l.qty).toLocaleString('id-ID')}
                  </Td>
                  <Td>{l.uom ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Reveal>
    </>
  );
}
