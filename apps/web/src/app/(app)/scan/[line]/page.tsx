import { notFound } from 'next/navigation';
import { getStationSummary } from '@/lib/scan-api';
import { PageHeader } from '@/components/ui/page-header';
import { ScanStation } from '@/components/scan/scan-station';
import { Chip } from '@/components/ui/chip';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ line: string }>;
}

export default async function ScanStationPage({ params }: PageProps) {
  const { line } = await params;
  const code = decodeURIComponent(line);

  let summary;
  try {
    summary = await getStationSummary(code, 12);
  } catch {
    // Line yang tidak dikenal berarti alamatnya salah, bukan kegagalan server.
    notFound();
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Scan', href: '/scan' }, { label: code }]}
        title={`${summary.line.name}`}
        description={`Line ${summary.line.code} — pastikan barcode discan pada line yang benar`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip value={summary.line.plantCode ?? '—'} />
            <Chip value={summary.line.processType} />
          </div>
        }
      />
      <ScanStation summary={summary} />
    </>
  );
}
