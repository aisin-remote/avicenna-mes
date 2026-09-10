import { getMasterOptions } from '@/lib/master-api';
import { PageHeader } from '@/components/ui/page-header';
import { TransferForm } from '@/components/transfer/transfer-form';

export const dynamic = 'force-dynamic';

export default async function NewTransferPage() {
  const [plants, lines, locations, parts] = await Promise.all([
    getMasterOptions('plants'),
    getMasterOptions('lines'),
    getMasterOptions('locations'),
    getMasterOptions('parts'),
  ]);

  const strip = (o: { value: number; label: string }) => ({ value: o.value, label: o.label });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Transfer Antar Line', href: '/transfer' }, { label: 'Pindahkan Barang' }]}
        title="Pindahkan Barang"
        description="Tentukan asal dan tujuan, lalu pilih barang beserta lotnya"
      />
      <TransferForm
        plants={plants.map(strip)}
        lines={lines.map(strip)}
        locations={locations.map(strip)}
        parts={parts.map(strip)}
      />
    </>
  );
}
