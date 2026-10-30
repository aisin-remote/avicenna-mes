import Link from 'next/link';
import { preparationFilterSchema, type PreparationSnapshot } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { PreparationMonitoring } from '@/components/preparation/monitoring';

export const dynamic = 'force-dynamic';
export default async function PreparationMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const initialDocumentId =
    typeof sp.document === 'string' && /^[1-9]\d*$/.test(sp.document)
      ? Number(sp.document)
      : undefined;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const parsed = preparationFilterSchema.safeParse({
    from: sp.from || today,
    to: sp.to || sp.from || today,
    customerId: sp.customerId || undefined,
    cycle: sp.cycle || undefined,
    status: sp.status || 'ALL',
    q: sp.q || '',
  });
  if (!parsed.success)
    return (
      <>
        <PageHeader title="Preparation Monitoring" crumbs={[{ label: 'Preparation Monitoring' }]} />
        <div role="alert" className="rounded-card border border-line bg-card p-6">
          {parsed.error.issues.map((e) => e.message).join('. ')}{' '}
          <Link className="underline" href="/preparation-monitoring">
            Reset filter
          </Link>
        </div>
      </>
    );
  const query = new URLSearchParams(
    Object.entries(parsed.data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  const [data, user] = await Promise.all([
    apiFetch<PreparationSnapshot>(`/preparation?${query}`),
    getSessionUser(),
  ]);
  return (
    <>
      <PageHeader
        title="Preparation Monitoring"
        crumbs={[{ label: 'Logistik' }, { label: 'Preparation Monitoring' }]}
        description="Pantau preparation, progress pulling, dan kedatangan truk per customer-cycle."
      />
      <PreparationMonitoring
        key={initialDocumentId ?? 'monitor'}
        data={data}
        canManage={user?.roleKind === 'ADMIN'}
        initialDocumentId={initialDocumentId}
      />
    </>
  );
}
