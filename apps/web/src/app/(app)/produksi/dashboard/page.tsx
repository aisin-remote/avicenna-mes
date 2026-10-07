import { getDashboardProduksi } from '@/lib/dashboard-api';
import { PageHeader } from '@/components/ui/page-header';
import { PapanLini } from '@/components/produksi/papan-lini';

export const dynamic = 'force-dynamic';

/**
 * Papan monitor produksi — satu kartu per lini.
 *
 * Mengikuti papan yang sudah dipakai di lantai: kode lini besar, status
 * RUNNING/STOP dari warnanya, model yang sedang dikerjakan, sejak kapan, dan
 * jumlah OK hari ini. Dibaca dari jarak beberapa meter, jadi yang dikecilkan
 * adalah keterangannya, bukan angkanya.
 */
export default async function DashboardProduksiPage({
  searchParams,
}: {
  searchParams: Promise<{ plant?: string }>;
}) {
  const { plant } = await searchParams;
  const data = await getDashboardProduksi(plant);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Papan Lini' }]}
        title="Papan Lini"
        description={`Hari produksi ${data.hariProduksi}${plant ? ` · pabrik ${plant}` : ''}`}
      />
      <PapanLini awal={data} plant={plant} />
    </>
  );
}
