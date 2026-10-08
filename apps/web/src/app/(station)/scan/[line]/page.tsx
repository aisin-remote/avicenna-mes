import { notFound } from 'next/navigation';
import { getStationSummary } from '@/lib/scan-api';
import { getSessionUser } from '@/lib/session';
import { StationBar } from '@/components/scan/station-bar';
import { ScanStation } from '@/components/scan/scan-station';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ line: string }>;
}

/**
 * Layar stasiun scan — memenuhi layar, tanpa menu.
 *
 * Berada di route group (station) yang punya layout sendiri, sehingga sidebar
 * dan bilah pencarian tidak ikut dirender. Alamatnya tetap /scan/<line>:
 * route group tidak memengaruhi URL.
 */
export default async function ScanStationPage({ params }: PageProps) {
  const { line } = await params;
  const code = decodeURIComponent(line);

  const user = await getSessionUser();

  let summary;
  try {
    summary = await getStationSummary(code, 12);
  } catch {
    // Line yang tidak dikenal berarti alamatnya salah, bukan kegagalan server.
    notFound();
  }

  return (
    /*
     * Tinggi DIKUNCI ke layar, bukan min-height.
     *
     * Operator berdiri dengan barang di tangan dan tidak akan menggulir; apa
     * pun yang jatuh di bawah lipatan sama saja dengan tidak ada. Dengan
     * tinggi terkunci, bagian dalamlah yang membagi ruang — dan hanya panel
     * yang memang boleh menggulir yang menggulir.
     */
    <div className="flex h-dvh flex-col overflow-hidden">
      <StationBar
        lineName={summary.line.name}
        lineCode={summary.line.code}
        processType={summary.line.processType}
        plantName={summary.line.plantName}
        userName={user?.name ?? '—'}
        npk={user?.npk ?? '—'}
      />
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        <ScanStation summary={summary} />
      </main>
    </div>
  );
}
