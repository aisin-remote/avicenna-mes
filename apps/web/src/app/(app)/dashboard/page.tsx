import { Factory, GitBranch, Package, Users, ScanLine, History } from 'lucide-react';
import { getDashboardSummary, recentScans } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Chip } from '@/components/ui/chip';
import { Stagger, StaggerItem } from '@/components/motion/reveal';

// Data produksi berubah terus; jangan disajikan dari cache.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Server Component: query jalan di server, browser terima HTML jadi.
  const [summary, scans] = await Promise.all([getDashboardSummary(), recentScans(15)]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard' }]}
        title="Dashboard"
        description="Ringkasan dua pabrik dalam satu sistem"
      />

      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Pabrik" value={summary.plants} icon={Factory} />
        <StatCard label="Line" value={summary.lines} icon={GitBranch} />
        <StatCard label="Part" value={summary.parts} icon={Package} />
        <StatCard label="Customer" value={summary.customers} icon={Users} />
        <StatCard
          label="Scan hari ini"
          value={summary.scansToday}
          hint="sejak 00:00"
          icon={ScanLine}
        />
      </Stagger>

      <Stagger className="mt-6">
        <StaggerItem>
          <Card>
            <CardHeader
              icon={History}
              title="Scan terakhir"
              subtitle={`${scans.length} kejadian terbaru dari seluruh line`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Waktu</Th>
                  <Th>Line</Th>
                  <Th>Part</Th>
                  <Th>Jenis</Th>
                  <Th align="right">Qty</Th>
                </tr>
              </thead>
              <tbody>
                {scans.length === 0 ? (
                  <EmptyState colSpan={5}>
                    Belum ada data scan. Kirim satu lewat{' '}
                    <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[13px]">
                      POST /scan
                    </code>{' '}
                    untuk mengujinya.
                  </EmptyState>
                ) : (
                  scans.map((s) => (
                    <Tr key={s.id}>
                      <Td className="tabular whitespace-nowrap">
                        {new Date(s.scannedAt).toLocaleString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Td>
                      <Td strong>{s.lineCode ?? '—'}</Td>
                      <Td>{s.partName ?? s.rawCode}</Td>
                      <Td>
                        <Chip value={s.kind} />
                      </Td>
                      <Td align="right" strong className="tabular">
                        {s.qty}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
