import { notFound } from 'next/navigation';
import { Truck, Package } from 'lucide-react';
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
        actions={<Chip value={receipt.status} />}
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
