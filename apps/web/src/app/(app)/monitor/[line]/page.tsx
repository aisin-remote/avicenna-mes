import { LiveMonitor } from '@/components/live-monitor';
import { PageHeader } from '@/components/ui/page-header';

interface PageProps {
  params: Promise<{ line: string }>;
}

export default async function MonitorLinePage({ params }: PageProps) {
  const { line } = await params;
  const code = decodeURIComponent(line);

  // URL API dibaca di server lalu diturunkan ke klien, supaya alamat internal
  // pabrik tidak perlu ditulis ulang di kode klien.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Monitor Line', href: '/monitor' }, { label: code }]}
        title={`Line ${code}`}
        description="Aliran scan langsung lewat SSE"
      />
      <LiveMonitor lineCode={code} apiUrl={apiUrl} />
    </>
  );
}
