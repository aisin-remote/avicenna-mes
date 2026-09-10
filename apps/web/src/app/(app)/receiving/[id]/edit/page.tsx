import { notFound } from 'next/navigation';
import { getReceipt } from '@/lib/receiving-api';
import { getMasterOptions } from '@/lib/master-api';
import { PageHeader } from '@/components/ui/page-header';
import { ReceivingForm } from '@/components/receiving/receiving-form';

export const dynamic = 'force-dynamic';

export default async function EditReceiptPage({
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

  const [plants, suppliers, locations] = await Promise.all([
    getMasterOptions('plants'),
    getMasterOptions('suppliers'),
    getMasterOptions('locations'),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Penerimaan Barang', href: '/receiving' },
          { label: receipt.documentNumber, href: `/receiving/${receipt.id}` },
          { label: 'Ubah' },
        ]}
        title={`Ubah ${receipt.documentNumber}`}
        description="Perubahan dicatat sebagai koreksi — riwayat stok yang lama tetap utuh"
      />
      <ReceivingForm
        plants={plants.map((p) => ({ value: p.value, label: p.label }))}
        suppliers={suppliers.map((s) => ({ value: s.value, label: s.label }))}
        locations={locations.map((l) => ({ value: l.value, label: l.label }))}
        existing={{
          id: receipt.id,
          documentNumber: receipt.documentNumber,
          supplierDocNumber: receipt.supplierDocNumber,
          supplierName: receipt.supplierName,
          lines: receipt.lines.map((l) => ({
            id: l.id,
            partId: l.partId,
            partNumber: l.partNumber ?? '—',
            partName: l.partName ?? '',
            qty: l.qty,
            uom: l.uom,
            trackingMode: l.trackingMode ?? 'LOT',
            supplierLotNumber: l.supplierLotNumber,
          })),
        }}
      />
    </>
  );
}
