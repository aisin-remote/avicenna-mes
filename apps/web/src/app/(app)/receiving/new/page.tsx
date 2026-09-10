import { getMasterOptions } from '@/lib/master-api';
import { PageHeader } from '@/components/ui/page-header';
import { ReceivingForm } from '@/components/receiving/receiving-form';

export const dynamic = 'force-dynamic';

export default async function NewReceiptPage() {
  const [plants, suppliers, locations] = await Promise.all([
    getMasterOptions('plants'),
    getMasterOptions('suppliers'),
    getMasterOptions('locations'),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Penerimaan Barang', href: '/receiving' }, { label: 'Terima Barang' }]}
        title="Terima Barang"
        description="Catat surat jalan, lalu scan barangnya satu per satu"
      />
      <ReceivingForm
        plants={plants.map((p) => ({ value: p.value, label: p.label }))}
        suppliers={suppliers.map((s) => ({ value: s.value, label: s.label }))}
        locations={locations.map((l) => ({ value: l.value, label: l.label }))}
      />
    </>
  );
}
