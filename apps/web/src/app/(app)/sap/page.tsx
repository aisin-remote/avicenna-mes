import Link from 'next/link';
import { Share2, PauseCircle, AlertTriangle, CheckCircle2, Clock, MinusCircle } from 'lucide-react';
import { getSapSummary, listSapOutbox } from '@/lib/sap-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { OutboxActions } from '@/components/sap/outbox-actions';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu kirim',
  SENT: 'Terkirim',
  FAILED: 'Gagal',
  HELD: 'Ditahan',
  SKIPPED: 'Tidak dikirim',
};

const STATUS_TONE: Record<string, string> = {
  PENDING: 'border-accent/40 bg-accent/10 text-accent',
  SENT: 'border-ok/40 bg-ok/10 text-ok',
  FAILED: 'border-ng/40 bg-ng/10 text-ng',
  HELD: 'border-warn/40 bg-warn/10 text-warn',
  SKIPPED: 'border-line text-ink-muted',
};

export default async function SapPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = sp.status ?? 'ALL';

  const [ringkas, { data, meta }] = await Promise.all([
    getSapSummary(),
    listSapOutbox(page, 25, status),
  ]);

  const idGagal = data.filter((d) => d.status === 'FAILED').map((d) => d.id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Integrasi SAP' }]}
        title="Integrasi SAP"
        description="Antrean perpindahan barang yang dikirim ke SAP lewat MS SQL"
      />

      {/* Keadaan saklar pengiriman ditaruh paling atas: tanpa ini, antrean yang
          menumpuk terlihat seperti kerusakan padahal memang belum dinyalakan. */}
      {!ringkas.pengirimanAktif ? (
        <p className="mb-5 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <PauseCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            Pengiriman ke MS SQL <strong>belum dinyalakan</strong> (<code>SAP_MSSQL_ENABLED</code>).
            Dokumen tetap dikumpulkan dan menunggu — tidak ada yang hilang. Begitu bentuk tabel
            tujuan dan movement type disepakati tim SAP, seluruh tunggakan terkirim apa adanya.
          </span>
        </p>
      ) : null}

      <Reveal>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kartu icon={Clock} label="Menunggu kirim" nilai={ringkas.pending} tone="accent" />
          <Kartu icon={PauseCircle} label="Ditahan" nilai={ringkas.held} tone="warn" />
          <Kartu icon={AlertTriangle} label="Gagal" nilai={ringkas.failed} tone="ng" />
          <Kartu icon={CheckCircle2} label="Terkirim" nilai={ringkas.sent} tone="ok" />
          <Kartu icon={MinusCircle} label="Tidak dikirim" nilai={ringkas.skipped} tone="muted" />
        </div>
      </Reveal>

      <div className="mb-5">
        <OutboxActions idGagal={idGagal} />
      </div>

      <Reveal>
        <Card>
          <CardHeader
            icon={Share2}
            title="Antrean dokumen"
            subtitle={`${meta.total} dokumen`}
            actions={
              <div className="flex flex-wrap gap-1.5">
                {['ALL', 'PENDING', 'HELD', 'FAILED', 'SENT', 'SKIPPED'].map((s) => (
                  <Link
                    key={s}
                    href={s === 'ALL' ? '/sap' : `/sap?status=${s}`}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                      status === s
                        ? 'border-ink bg-surface text-ink'
                        : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                    )}
                  >
                    {s === 'ALL' ? 'Semua' : STATUS_LABEL[s]}
                  </Link>
                ))}
              </div>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Dokumen asal</Th>
                <Th>Jenis</Th>
                <Th>Mvt</Th>
                <Th>Pabrik</Th>
                <Th>Waktu</Th>
                <Th>Status</Th>
                <Th>Keterangan</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={7}>
                  Belum ada dokumen pada saringan ini. Perpindahan barang dikumpulkan otomatis tiap
                  menit.
                </EmptyState>
              ) : (
                data.map((d) => (
                  <Tr key={d.id}>
                    <Td strong className="tabular whitespace-nowrap">
                      {d.sourceTable}
                      <span className="font-normal text-ink-muted"> #{d.sourceId}</span>
                    </Td>
                    <Td>{d.docType}</Td>
                    <Td className="tabular">{d.movementType ?? '—'}</Td>
                    <Td>{d.plantCode ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">
                      {new Date(d.occurredAt).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap',
                          STATUS_TONE[d.status] ?? 'border-line',
                        )}
                      >
                        {STATUS_LABEL[d.status] ?? d.status}
                      </span>
                      {d.attempts > 0 ? (
                        <span className="tabular ml-2 text-[12px] text-ink-muted">
                          {d.attempts}×
                        </span>
                      ) : null}
                    </Td>
                    <Td className="max-w-[340px] text-[13px] text-ink-muted">
                      {d.sapDocNumber ? (
                        <span className="tabular font-semibold text-ok">{d.sapDocNumber}</span>
                      ) : (
                        (d.lastError ?? '—')
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <p className="mt-5 text-[14px] text-ink-muted">
          Halaman {meta.page} dari {meta.totalPages}
        </p>
      ) : null}
    </>
  );
}

const TONE = {
  accent: 'text-accent',
  ok: 'text-ok',
  ng: 'text-ng',
  warn: 'text-warn',
  muted: 'text-ink-muted',
} as const;

function Kartu({
  icon: Icon,
  label,
  nilai,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  nilai: number;
  tone: keyof typeof TONE;
}) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
        <Icon className={cn('size-4 shrink-0', TONE[tone])} strokeWidth={2} aria-hidden />
        {label}
      </p>
      <p className={cn('tabular mt-1 text-[30px] font-extrabold leading-none', TONE[tone])}>
        {nilai.toLocaleString('id-ID')}
      </p>
    </div>
  );
}
