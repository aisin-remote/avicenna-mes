import { PisStation } from '@/components/pis/pis-station';
import { getSessionUser } from '@/lib/session';
import { readPisAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PisPage({ searchParams }: {
  searchParams: Promise<{ plantId?: string }>;
}) {
  const sp = await searchParams;
  const plantId = sp.plantId && /^[1-9]\d*$/.test(sp.plantId) ? Number(sp.plantId) : undefined;
  const [result, user] = await Promise.all([readPisAction(plantId), getSessionUser()]);
  return <PisStation initial={result} initialPlantId={plantId} operator={user?.name ?? ''} />;
}
