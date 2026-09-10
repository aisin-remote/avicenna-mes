import Link from 'next/link';
import { LiveMonitor } from '@/components/live-monitor';

interface PageProps {
  params: Promise<{ line: string }>;
}

export default async function MonitorLinePage({ params }: PageProps) {
  const { line } = await params;

  // URL API dibaca di server lalu diturunkan ke klien, supaya alamat internal
  // pabrik tidak perlu ditulis ulang di kode klien.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitor {decodeURIComponent(line)}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Aliran langsung lewat SSE
          </p>
        </div>
        <Link href="/monitor" className="text-sm underline underline-offset-2" style={{ color: 'var(--muted)' }}>
          Kembali
        </Link>
      </header>

      <LiveMonitor lineCode={decodeURIComponent(line)} apiUrl={apiUrl} />
    </div>
  );
}
