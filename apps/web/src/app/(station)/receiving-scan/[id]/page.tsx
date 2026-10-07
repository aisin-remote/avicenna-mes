import { notFound, redirect } from 'next/navigation';
import { getReceivingSession } from '@/lib/receiving-api';
import { getSessionUser } from '@/lib/session';
import { ReceivingStation } from '@/components/receiving/receiving-station';

export const dynamic = 'force-dynamic';

export default async function ReceivingScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound();
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!['ADMIN', 'SCANNING'].includes(user.roleKind ?? '')) redirect(`/receiving/${numericId}`);
  const session = await getReceivingSession(numericId);
  if (session.status !== 'DRAFT') redirect(`/receiving/${numericId}`);
  return <ReceivingStation initial={session} userId={user.id} userName={user.name} />;
}
