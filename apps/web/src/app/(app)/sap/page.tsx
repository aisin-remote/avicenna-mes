import Link from 'next/link';
import {
  Share2,
  PauseCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MinusCircle,
  Database,
  XCircle,
  Hourglass,
} from 'lucide-react';
import { getSapSummary, getStagingStatus, listSapOutbox } from '@/lib/sap-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Reveal } from '@/components/motion/reveal';
import { OutboxActions } from '@/components/sap/outbox-actions';
import { SimulationActions } from '@/components/sap/simulation-actions';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/*
 * Label ditulis dari sudut pandang orang yang melihat layar, bukan dari nama
 * status di database. "Terkirim" dulu berarti selesai; sejak ada database
 * jembatan, barisnya sampai di staging BUKAN berarti SAP sudah menerimanya —
 * jadi namanya pun harus mengatakan itu.
 */
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu didorong',
  SENT: 'Di staging, menunggu SAP',
  CONFIRMED: 'Diterima SAP',
  REJECTED: 'Ditolak SAP',
  FAILED: 'Gagal didorong',
  HELD: 'Ditahan',
  SKIPPED: 'Tidak dikirim',
};

const TRIAL_LABEL: Record<string, string> = {
  PENDING: 'Antrean trial',
  CONFIRMED: 'Simulasi diterima',
  REJECTED: 'Simulasi ditolak',
};

const STATUS_TONE: Record<string, string> = {
  PENDING: 'border-accent/40 bg-accent/10 text-accent',
  SENT: 'border-warn/40 bg-warn/10 text-warn',
  CONFIRMED: 'border-ok/40 bg-ok/10 text-ok',
  REJECTED: 'border-ng/40 bg-ng/10 text-ng',
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

  const [ringkas, jembatan, { data, meta }] = await Promise.all([
    getSapSummary(),
    getStagingStatus(),
    listSapOutbox(page, 25, status),
  ]);
  const cfg = jembatan.sambungan.config;

  const idGagal = data.filter((d) => d.status === 'FAILED').map((d) => d.id);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Integrasi SAP' }]}
        title="Integrasi SAP"
        description="Perpindahan barang didorong ke database jembatan, lalu ditarik SAP dari sana"
      />

      <div className="mb-5 rounded-card border border-line bg-card px-4 py-3 text-[14px]">
        Izin kirim hasil produksi dan transfer SLOC diatur per langkah part pada{' '}
        <Link href="/master/part-processes" className="font-semibold text-accent underline">
          Master Rute Proses
        </Link>
        . Pengaturan ini menentukan dokumen yang masuk antrean di bawah.
      </div>

      {/* Keadaan saklar pengiriman ditaruh paling atas: tanpa ini, antrean yang
          menumpuk terlihat seperti kerusakan padahal memang belum dinyalakan. */}
      {!ringkas.pengirimanAktif ? (
        <p className="mb-5 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <PauseCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            Pendorongan ke database jembatan <strong>belum dinyalakan</strong>{' '}
            {!jembatan.sambungan.terkonfigurasi ? (
              <>
                — koneksinya belum diisi (
                <code>{jembatan.sambungan.kurang.join(', ') || 'STAGING_*'}</code>).
              </>
            ) : (
              <>
                (<code>STAGING_PUSH_ENABLED</code>).
              </>
            )}{' '}
            Dokumen tetap dikumpulkan dan menunggu — tidak ada yang hilang. Begitu saklarnya
            dinyalakan, seluruh tunggakan terdorong apa adanya.
          </span>
        </p>
      ) : null}

      {ringkas.simulasiAktif ? (
        <p className="mb-5 rounded-card border border-accent/35 bg-accent/8 px-4 py-3 text-[14px] text-accent">
          Mode trial SAP aktif. Tombol centang/silang pada Good Issue hanya mengubah antrean lokal;
          tidak ada data yang dikirim ke staging. Ringkasan juga mencakup dokumen bertanda TRIAL.
        </p>
      ) : null}

      {/* Keadaan jembatan ditaruh sebelum angka-angkanya: dokumen yang menumpuk
          di PENDING hampir selalu berarti sesuatu di sini, bukan di antreannya. */}
      <Reveal>
        <div className="mb-5 rounded-card border border-line bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
            <Database className="size-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
            Database jembatan
          </p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <Baris label="Server">
              {cfg.host
                ? `${cfg.host}${cfg.instance ? '\\' + cfg.instance : cfg.port ? ':' + cfg.port : ''}`
                : 'belum diisi'}
            </Baris>
            <Baris label="Database">{cfg.database ?? 'belum diisi'}</Baris>
            <Baris label="Tabel transaksi">{jembatan.target}</Baris>
            <Baris label="Arah aktif">
              {[cfg.dorongAktif ? 'dorong' : null, cfg.tarikAktif ? 'tarik master' : null]
                .filter(Boolean)
                .join(' + ') || 'belum ada'}
            </Baris>
          </dl>
          {jembatan.sambungan.galatTerakhir ? (
            <p className="mt-3 border-t border-line pt-3 text-[13px] text-ng">
              Galat terakhir: {jembatan.sambungan.galatTerakhir}
            </p>
          ) : null}
        </div>
      </Reveal>

      <Reveal>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Kartu icon={Clock} label="Menunggu didorong" nilai={ringkas.pending} tone="accent" />
          <Kartu icon={Hourglass} label="Menunggu SAP" nilai={ringkas.sent} tone="warn" />
          <Kartu icon={CheckCircle2} label="Diterima SAP" nilai={ringkas.confirmed} tone="ok" />
          <Kartu icon={XCircle} label="Ditolak SAP" nilai={ringkas.rejected} tone="ng" />
          <Kartu icon={PauseCircle} label="Ditahan" nilai={ringkas.held} tone="warn" />
          <Kartu icon={AlertTriangle} label="Gagal didorong" nilai={ringkas.failed} tone="ng" />
          <Kartu icon={MinusCircle} label="Tidak dikirim" nilai={ringkas.skipped} tone="muted" />
        </div>
      </Reveal>

      <div className="mb-5">
        <OutboxActions idGagal={idGagal} tarikAktif={cfg.tarikAktif} />
      </div>

      <Reveal>
        <Card>
          <CardHeader
            icon={Share2}
            title="Antrean dokumen"
            subtitle={`${meta.total} dokumen`}
            actions={
              <div className="flex flex-wrap gap-1.5">
                {[
                  'ALL',
                  'PENDING',
                  'SENT',
                  'CONFIRMED',
                  'REJECTED',
                  'HELD',
                  'FAILED',
                  'SKIPPED',
                ].map((s) => (
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
                        {(d.isSimulation ? TRIAL_LABEL[d.status] : STATUS_LABEL[d.status]) ??
                          STATUS_LABEL[d.status] ??
                          d.status}
                      </span>
                      {d.attempts > 0 ? (
                        <span className="tabular ml-2 text-[12px] text-ink-muted">
                          {d.attempts}×
                        </span>
                      ) : null}
                      {ringkas.simulasiAktif &&
                      d.docType === 'DELIVERY' &&
                      (d.status === 'PENDING' || d.isSimulation) ? (
                        <SimulationActions id={d.id} reset={d.status !== 'PENDING'} />
                      ) : null}
                      {d.isSimulation ? (
                        <span className="ml-2 text-[11px] font-bold text-warn">TRIAL</span>
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

function Baris({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-[14px] font-semibold text-ink">{children}</dd>
    </div>
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
