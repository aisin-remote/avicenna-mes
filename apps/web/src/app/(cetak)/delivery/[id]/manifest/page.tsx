import { notFound, redirect } from 'next/navigation';
import { getLoading } from '@/lib/loading-api';

export const dynamic = 'force-dynamic';

export default async function ManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();
  const doc = await getLoading(Number(id));
  redirect(
    `/preparation-monitoring?from=${doc.deliveryDate}&to=${doc.deliveryDate}&document=${doc.id}`,
  );
}
