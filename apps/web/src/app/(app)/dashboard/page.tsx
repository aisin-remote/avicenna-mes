import { getDashboardSummary, recentScans } from '@/lib/queries';
import { StatCard } from '@/components/stat-card';

// Data produksi berubah terus; jangan disajikan dari cache.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Server Component: query jalan di server, browser terima HTML jadi.
  const [summary, scans] = await Promise.all([getDashboardSummary(), recentScans(15)]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Ringkasan dua pabrik dalam satu sistem
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Pabrik" value={summary.plants} />
        <StatCard label="Line" value={summary.lines} />
        <StatCard label="Part" value={summary.parts} />
        <StatCard label="Customer" value={summary.customers} />
        <StatCard label="Scan hari ini" value={summary.scansToday} hint="sejak 00:00" />
      </div>

      <section className="surface rounded-xl">
        <div className="border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-semibold">Scan terakhir</h2>
        </div>

        {scans.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
            Belum ada data scan. Kirim satu lewat{' '}
            <code className="rounded px-1" style={{ background: 'var(--bg)' }}>
              POST /scan
            </code>{' '}
            untuk mengujinya.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: 'var(--border)' }}>
                  <Th>Waktu</Th>
                  <Th>Line</Th>
                  <Th>Part</Th>
                  <Th>Jenis</Th>
                  <Th className="text-right">Qty</Th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <Td>{new Date(s.scannedAt).toLocaleString('id-ID')}</Td>
                    <Td>{s.lineCode ?? '-'}</Td>
                    <Td>{s.partName ?? s.rawCode}</Td>
                    <Td>{s.kind}</Td>
                    <Td className="tabular text-right">{s.qty}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-5 py-2.5 text-xs font-medium uppercase tracking-wide ${className}`} style={{ color: 'var(--muted)' }}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-2.5 ${className}`}>{children}</td>;
}
