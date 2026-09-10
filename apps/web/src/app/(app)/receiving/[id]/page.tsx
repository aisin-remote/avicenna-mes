import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Package, Pencil } from 'lucide-react';
import { getReceipt } from '@/lib/receiving-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr } from '@/components/ui/table';
import { Chip } from '@/components/ui/chip';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  let receipt;
  try {
    receipt = await getReceipt(numericId);
  } catch {
    notFound();
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Penerimaan Barang', href: '/receiving' },
          { label: receipt.documentNumber },
        ]}
        title={receipt.documentNumber}
        description={`${receipt.supplierName ?? '—'} · surat jalan ${receipt.supplierDocNumber ?? '—'}`}
        actions={
          <div className="flex items-center gap-3">
            <Chip value={receipt.status} />
            <Link
              href={`/receiving/${receipt.id}/edit`}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-line-strong hover:bg-surface"
            >
              <Pencil className="size-4" strokeWidth={1.9} aria-hidden />
              Ubah
            </Link>
          </div>
        }
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={Package}
            title="Barang diterima"
            subtitle={`${receipt.lines.length} baris · ${new Date(receipt.receivedAt).toLocaleString('id-ID')}`}
          />
          <Table>
            <thead>
              <tr>
                <Th>Part Number</Th>
                <Th>Nama</Th>
                <Th align="right">Jumlah</Th>
                <Th>Satuan</Th>
                <Th>Lot</Th>
                <Th>Lot Supplier</Th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((l) => (
                <Tr key={l.id}>
                  <Td strong>{l.partNumber ?? '—'}</Td>
                  <Td>{l.partName ?? '—'}</Td>
                  <Td align="right" strong className="tabular">
                    {Number(l.qty).toLocaleString('id-ID')}
                  </Td>
                  <Td>{l.uom}</Td>
                  <Td className="tabular">{l.lotNumber ?? '—'}</Td>
                  <Td>{l.supplierLotNumber ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Reveal>
    </>
  );
}
