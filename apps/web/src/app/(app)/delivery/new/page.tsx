import { getMasterOptions } from '@/lib/master-api';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingForm } from '@/components/delivery/loading-form';

export const dynamic = 'force-dynamic';

export default async function NewLoadingPage() {
  const [plants, customers, locations] = await Promise.all([
    getMasterOptions('plants'),
    getMasterOptions('customers'),
    getMasterOptions('locations'),
  ]);

  const strip = (o: { value: number; label: string }) => ({ value: o.value, label: o.label });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pengiriman', href: '/delivery' }, { label: 'Buat Loading List' }]}
        title="Buat Loading List"
        description="Susun rencana muat satu truk, lalu isi aktualnya dengan scan kanban"
      />
      <LoadingForm
        plants={plants.map(strip)}
        customers={customers.map(strip)}
        locations={locations.map(strip)}
      />
    </>
  );
}
