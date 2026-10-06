import Link from 'next/link';
import {
  Factory,
  GitBranch,
  Package,
  Users,
  ScanLine,
  ChartNoAxesColumnIncreasing,
} from 'lucide-react';
import { PROCESS_LABELS, type ProcessType } from '@avicenna/contracts';
import { summarizeProductionByProcess } from '@avicenna/domain';
import { getDashboardSummary, listLinesWithProduction } from '@/lib/queries';
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
  const now = new Date();
  const [summary, lines] = await Promise.all([
    getDashboardSummary(now),
    listLinesWithProduction(now),
  ]);
  const production = summarizeProductionByProcess(lines);
  const totalLines = production.reduce((total, group) => total + group.totalLines, 0);
  const producingLines = production.reduce((total, group) => total + group.producingLines, 0);
  const formatDate = (date: Date) =>
    date.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      timeZone: 'Asia/Jakarta',
    });
  const period = `${formatDate(summary.productionStart)} 07:00 – ${formatDate(summary.productionEnd)} 07:00 WIB`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Dashboard' }]}
        title="Dashboard"
        description="Ringkasan produksi dua pabrik dalam satu sistem"
      />

      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Pabrik" value={summary.plants} icon={Factory} />
        <StatCard label="Line" value={summary.lines} icon={GitBranch} />
        <StatCard label="Part" value={summary.parts} icon={Package} />
        <StatCard label="Customer" value={summary.customers} icon={Users} />
        <StatCard
          label="Scan produksi"
          value={summary.scansToday}
          hint="hari produksi · sejak 07:00 WIB"
          icon={ScanLine}
        />
      </Stagger>

      <Stagger className="mt-6">
        <StaggerItem>
          <Card>
            <CardHeader
              icon={ChartNoAxesColumnIncreasing}
              title="Hasil produksi per proses"
              subtitle={period}
              actions={
                <Link
                  href="/monitor"
                  className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-ink"
                >
                  Monitor line
                </Link>
              }
            />
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-6 pb-4 text-sm">
              <p>
                <span className="font-bold text-ok">{producingLines}</span> / {totalLines} line
                berproduksi
              </p>
              <p className="text-ink-muted">
                <span className={totalLines > producingLines ? 'font-bold text-warn' : 'font-bold'}>
                  {totalLines - producingLines}
                </span>{' '}
                line belum ada output
              </p>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Pabrik</Th>
                  <Th>Proses</Th>
                  <Th align="right">Output (unit)</Th>
                  <Th align="right">Line berproduksi</Th>
                  <Th align="right">Belum ada output</Th>
                </tr>
              </thead>
              <tbody>
                {production.length === 0 ? (
                  <EmptyState colSpan={5}>
                    Belum ada line produksi aktif. Periksa pengaturan line di Master Data.
                  </EmptyState>
                ) : (
                  production.map((group) => (
                    <Tr key={JSON.stringify([group.plantCode, group.processType])}>
                      <Td>
                        <Chip value={group.plantCode ?? '—'} />
                      </Td>
                      <Td strong>
                        {PROCESS_LABELS[group.processType as ProcessType] ?? group.processType}
                      </Td>
                      <Td align="right" strong className="tabular">
                        {group.qtyHariIni.toLocaleString('id-ID')}
                      </Td>
                      <Td align="right" className="tabular">
                        <span
                          className={group.producingLines ? 'font-semibold text-ok' : undefined}
                        >
                          {group.producingLines}
                        </span>
                        <span className="text-ink-muted"> / {group.totalLines}</span>
                      </Td>
                      <Td align="right" className="tabular">
                        <span
                          className={
                            group.totalLines > group.producingLines
                              ? 'font-semibold text-warn'
                              : undefined
                          }
                        >
                          {group.totalLines - group.producingLines}
                        </span>
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
            <p className="border-t border-line px-6 py-4 text-xs text-ink-muted">
              Output dihitung per proses, bukan total barang jadi. Belum ada output tidak berarti
              line berhenti.
            </p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
