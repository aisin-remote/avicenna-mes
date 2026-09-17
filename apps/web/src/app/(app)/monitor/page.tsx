import Link from 'next/link';
import { Activity, ArrowUpRight } from 'lucide-react';
import { listLinesWithProduction, type LineProduksi } from '@/lib/queries';
import { grupProses, PROCESS_GROUPS, PROCESS_GROUP_LABELS } from '@avicenna/domain';
import { PROCESS_TYPES, PROCESS_LABELS } from '@avicenna/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Chip } from '@/components/ui/chip';
import { Stagger, StaggerItem } from '@/components/motion/reveal';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/*
 * Urutan dan label diambil dari @avicenna/contracts, tidak disalin lagi.
 *
 * Daftar salinan di sini pernah tertinggal saat jenis proses bertambah: nilai
 * seperti CASTING_WIP tidak cocok dengan 'CASTING' yang tertulis, sehingga
 * seluruh lini jatuh ke penampung "tidak dikenal" dan urutannya acak.
 *
 * PROCESS_TYPES sudah tersusun mengikuti aliran barang, bukan abjad — orang
 * lapangan membaca layar ini sebagai urutan kerja.
 */
const URUTAN_PROSES = PROCESS_TYPES;
const NAMA_PROSES: Record<string, string> = PROCESS_LABELS;

export default async function MonitorIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ proses?: string }>;
}) {
  const sp = await searchParams;
  /*
   * Saringan grup proses.
   *
   * Leader dan JP dibawa ke sini dengan ?proses=casting tepat setelah login —
   * mereka mengurus satu proses, dan menampilkan seluruh pabrik membuat lini
   * yang jadi tanggung jawabnya tenggelam di antara yang bukan.
   *
   * Nilai yang tidak dikenal diabaikan, bukan menghasilkan halaman kosong:
   * tautan lama atau salah ketik tidak seharusnya membuat layar terlihat rusak.
   */
  const saringan = PROCESS_GROUPS.find(
    (g) => g.toLowerCase() === (sp.proses ?? '').trim().toLowerCase(),
  );

  const semuaLine = await listLinesWithProduction();
  const semua = saringan
    ? semuaLine.filter((l) => grupProses(l.processType as never) === saringan)
    : semuaLine;

  // Proses yang tidak punya line sama sekali tidak ditampilkan; proses di luar
  // daftar tetap muncul di belakang, supaya jenis baru tidak hilang diam-diam.
  const dikenal = new Set<string>(URUTAN_PROSES);
  const urutan = [
    ...URUTAN_PROSES.filter((p) => semua.some((l) => l.processType === p)),
    ...[...new Set(semua.map((l) => l.processType))].filter((p) => !dikenal.has(p)),
  ];

  const totalQty = semua.reduce((s, l) => s + l.qtyHariIni, 0);
  const lineAktif = semua.filter((l) => l.scanHariIni > 0).length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Monitor Produksi' }]}
        title="Monitor Produksi"
        description={
          saringan
            ? `Proses ${PROCESS_GROUP_LABELS[saringan]} — hari produksi berjalan, dihitung dari jam 07:00`
            : 'Hasil hari produksi berjalan per proses — dihitung dari jam 07:00, bukan tengah malam'
        }
      />

      {/* Saringan selalu terlihat, termasuk saat sedang aktif — supaya orang
          tahu ia sedang melihat sebagian, bukan seluruhnya. */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        <Saring aktif={!saringan} href="/monitor" label="Semua proses" />
        {PROCESS_GROUPS.filter((g) =>
          semuaLine.some((l) => grupProses(l.processType as never) === g),
        ).map((g) => (
          <Saring
            key={g}
            aktif={saringan === g}
            href={`/monitor?proses=${g.toLowerCase()}`}
            label={PROCESS_GROUP_LABELS[g]}
          />
        ))}
      </div>

      {semua.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          {saringan
            ? `Belum ada line ${PROCESS_GROUP_LABELS[saringan]} yang aktif.`
            : null}
          {saringan ? null : (
            <>
          Belum ada line. Jalankan{' '}
          <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[13px]">
            pnpm db:seed
          </code>{' '}
          lebih dulu.
            </>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-card border border-line bg-card px-5 py-4">
            <Angka label="Total unit hari ini" nilai={totalQty} besar />
            <Angka label="Line berproduksi" nilai={lineAktif} satuan={`/ ${semua.length}`} />
          </div>

          <div className="flex flex-col gap-8">
            {urutan.map((proses) => {
              const daftar = semua.filter((l) => l.processType === proses);
              const qty = daftar.reduce((s, l) => s + l.qtyHariIni, 0);
              return (
                <section key={proses}>
                  <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-line pb-2">
                    <h2 className="text-[15px] font-bold tracking-tight">
                      {NAMA_PROSES[proses] ?? proses}
                      <span className="ml-2 text-[13px] font-normal text-ink-muted">
                        {daftar.length} line
                      </span>
                    </h2>
                    <span className="tabular text-[15px] font-bold">
                      {qty.toLocaleString('id-ID')}
                      <span className="ml-1 text-[13px] font-normal text-ink-muted">unit</span>
                    </span>
                  </div>
                  <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {daftar.map((line) => (
                      <StaggerItem key={line.id}>
                        <KartuLine line={line} />
                      </StaggerItem>
                    ))}
                  </Stagger>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function Saring({ aktif, href, label }: { aktif: boolean; href: string; label: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
        aktif
          ? 'border-ink bg-surface text-ink'
          : 'border-line text-ink-muted hover:border-ink hover:text-ink',
      )}
    >
      {label}
    </Link>
  );
}

function KartuLine({ line }: { line: LineProduksi }) {
  const aktif = line.scanHariIni > 0;
  return (
    <Link href={`/monitor/${encodeURIComponent(line.code)}`} className="block h-full">
      <Card interactive className="group h-full p-5">
        <div className="flex items-start justify-between gap-3">
          <IconBadge icon={Activity} />
          <ArrowUpRight
            className="size-5 text-ink-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
            strokeWidth={1.8}
            aria-hidden
          />
        </div>

        <div className="mt-4 text-[18px] font-bold leading-tight tracking-tight">{line.name}</div>
        <div className="mt-1 text-[14px] text-ink-muted">{line.code}</div>

        <div className="mt-4 flex items-baseline gap-2">
          <span
            className={cn(
              'tabular text-[30px] font-extrabold leading-none',
              aktif ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {line.qtyHariIni.toLocaleString('id-ID')}
          </span>
          <span className="text-[13px] text-ink-muted">
            unit · {line.scanHariIni.toLocaleString('id-ID')} scan
          </span>
        </div>

        {/* Waktu scan terakhir lebih berguna daripada lencana "aktif": layar ini
            dibaca untuk tahu sebuah line berhenti, dan sejak kapan. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip value={line.plantCode ?? '—'} />
          {line.scanTerakhir ? (
            <span className="tabular text-[13px] text-ink-muted">
              terakhir{' '}
              {line.scanTerakhir.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ) : (
            <span className="text-[13px] text-ink-muted">belum ada scan</span>
          )}
        </div>
      </Card>
    </Link>
  );
}

function Angka({
  label,
  nilai,
  satuan,
  besar,
}: {
  label: string;
  nilai: number;
  satuan?: string;
  besar?: boolean;
}) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink-muted">{label}</p>
      <p
        className={cn(
          'tabular mt-0.5 font-extrabold leading-none',
          besar ? 'text-[34px]' : 'text-[24px]',
        )}
      >
        {nilai.toLocaleString('id-ID')}
        {satuan ? (
          <span className="ml-1.5 text-[14px] font-normal text-ink-muted">{satuan}</span>
        ) : null}
      </p>
    </div>
  );
}
