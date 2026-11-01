import { notFound, redirect } from 'next/navigation';
import { getLoading } from '@/lib/loading-api';
export const dynamic = 'force-dynamic';
/** URL lama tetap mengantar ke tahap yang benar. Scan kanban kini hanya saat pulling. */
export default async function LoadingStationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId < 1) notFound();
  const doc = await getLoading(numericId);
  redirect(
    ['DRAFT', 'PICKING'].includes(doc.status) ? `/picking/${doc.id}` : `/delivery/${doc.id}`,
  );
}
