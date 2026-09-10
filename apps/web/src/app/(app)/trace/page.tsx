import Link from 'next/link';
import {
  Search,
  GitBranch,
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { traceBackward, traceForward } from '@/lib/trace-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Chip } from '@/components/ui/chip';
import { Reveal } from '@/components/motion/reveal';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ mode?: string; q?: string }>;
}

/**
 * Telusur silsilah.
 *
 * Dua arah dijadikan satu halaman dengan pemilih mode, bukan dua halaman
 * terpisah: yang dicari orang saat ada masalah adalah "telusuri ini", dan arah
 * penelusurannya mengikuti apa yang dipegangnya — nomor seri unit atau nomor
 * lot dari supplier.
 *
 * Pencarian memakai form GET biasa, jadi hasilnya bisa di-bookmark dan
 * dilampirkan ke laporan investigasi lewat URL-nya saja.
 */
export default async function TracePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const mode = sp.mode === 'forward' ? 'forward' : 'backward';
  const q = sp.q?.trim() ?? '';

  const backward = mode === 'backward' && q ? await traceBackward(q).catch(() => null) : null;
  const forward = mode === 'forward' && q ? await traceForward(q).catch(() => null) : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Telusur Silsilah' }]}
        title="Telusur Silsilah"
        description="Lacak isi sebuah unit, atau sebaran sebuah lot"
      />

      <Reveal>
        <Card className="p-5">
          <form className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              <label htmlFor="q" className="mb-2 block text-[14px] font-semibold">
                {mode === 'backward' ? 'Nomor seri unit' : 'Nomor lot'}
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <input
                  id="q"
                  name="q"
                  defaultValue={q}
                  autoFocus
                  placeholder={
                    mode === 'backward'
                      ? 'mis. SN-BF-001 — nomor seri yang tercetak di unit'
                      : 'mis. RM-D-001-20260910-002 atau nomor lot dari supplier'
                  }
                  className="tabular h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-4 text-[15px] outline-none transition-colors focus:border-ink focus:bg-card"
                />
              </div>
            </div>
            <input type="hidden" name="mode" value={mode} />
            <button
              type="submit"
              className="h-12 rounded-full bg-accent px-6 text-[15px] font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              Telusuri
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            <ModeLink
              active={mode === 'backward'}
              href={`/trace?mode=backward${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              icon={<ArrowDownToLine className="size-4" strokeWidth={2} aria-hidden />}
            >
              Unit ini isinya apa
            </ModeLink>
            <ModeLink
              active={mode === 'forward'}
              href={`/trace?mode=forward${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              icon={<ArrowUpFromLine className="size-4" strokeWidth={2} aria-hidden />}
            >
              Lot ini masuk ke mana
            </ModeLink>
          </div>
        </Card>
      </Reveal>

      {/* ── Hasil telusur mundur ─────────────────────────────────────────── */}
      {backward ? (
        !backward.found ? (
          <NotFound what={`Nomor seri "${q}"`} />
        ) : (
          <div className="mt-5 space-y-5">
            {backward.produced.length > 0 ? (
              <Reveal>
                <Card>
                  <CardHeader
                    icon={GitBranch}
                    title="Riwayat produksi unit ini"
                    subtitle={`${backward.produced.length} kejadian scan`}
                  />
                  <Table>
                    <thead>
                      <tr>
                        <Th>Waktu</Th>
                        <Th>Part</Th>
                        <Th>Proses</Th>
                        <Th>Line</Th>
                        <Th align="right">Qty</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {backward.produced.map((p, i) => (
                        <Tr key={`${p.scannedAt}-${i}`}>
                          <Td className="tabular whitespace-nowrap">
                            {new Date(p.scannedAt).toLocaleString('id-ID')}
                          </Td>
                          <Td strong>{p.partNumber ?? '—'}</Td>
                          <Td>
                            <Chip value={p.processType ?? '—'} />
                          </Td>
                          <Td>{p.lineName ?? p.lineCode ?? '—'}</Td>
                          <Td align="right" className="tabular">
                            {p.qty}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </Reveal>
            ) : null}

            <Reveal>
              <Card>
                <CardHeader
                  icon={Boxes}
                  title="Komponen yang terpakai"
                  subtitle={`${backward.components.length} komponen tercatat`}
                />
                <ComponentTable rows={backward.components} />
              </Card>
            </Reveal>

            {backward.replaced.length > 0 ? (
              <Reveal>
                <Card>
                  <CardHeader
                    icon={Boxes}
                    title="Komponen yang pernah diganti"
                    subtitle="Sudah tidak terpasang, tapi tetap dicatat — sering justru ini yang dicari saat investigasi"
                  />
                  <ComponentTable rows={backward.replaced} />
                </Card>
              </Reveal>
            ) : null}
          </div>
        )
      ) : null}

      {/* ── Hasil telusur maju ───────────────────────────────────────────── */}
      {forward ? (
        !forward.found || !forward.lot ? (
          <NotFound what={`Lot "${q}"`} />
        ) : (
          <div className="mt-5 space-y-5">
            <Reveal>
              <Card>
                <CardHeader
                  icon={Boxes}
                  title={forward.lot.lotNumber}
                  subtitle={`${forward.lot.partNumber ?? '—'} · ${forward.lot.partName ?? ''}`}
                  actions={<Chip value={forward.lot.status} />}
                />
                <div className="grid gap-px bg-line sm:grid-cols-4">
                  <Fact label="Lot supplier" value={forward.lot.supplierLotNumber ?? '—'} />
                  <Fact label="Supplier" value={forward.lot.supplierName ?? '—'} />
                  <Fact
                    label="Diterima"
                    value={
                      forward.lot.receivedAt
                        ? new Date(forward.lot.receivedAt).toLocaleDateString('id-ID')
                        : '—'
                    }
                  />
                  <Fact
                    label="Jumlah tertulis"
                    value={Number(forward.lot.initialQty).toLocaleString('id-ID')}
                  />
                </div>
              </Card>
            </Reveal>

            <Reveal>
              <Card>
                <CardHeader
                  icon={GitBranch}
                  title="Unit yang memakai lot ini"
                  subtitle={
                    forward.totalUnits > forward.units.length
                      ? `${forward.totalUnits} unit — menampilkan ${forward.units.length} terbaru`
                      : `${forward.totalUnits} unit`
                  }
                />
                <Table>
                  <thead>
                    <tr>
                      <Th>Nomor Seri</Th>
                      <Th>Part</Th>
                      <Th align="right">Qty terpakai</Th>
                      <Th>Waktu</Th>
                      <Th>Bukti</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {forward.units.length === 0 ? (
                      <EmptyState colSpan={5}>
                        Lot ini belum terpakai di produksi mana pun.
                      </EmptyState>
                    ) : (
                      forward.units.map((u, i) => (
                        <Tr key={`${u.parentSerial}-${i}`}>
                          <Td strong className="tabular">
                            <Link
                              href={`/trace?mode=backward&q=${encodeURIComponent(u.parentSerial)}`}
                              className="underline underline-offset-4"
                            >
                              {u.parentSerial}
                            </Link>
                          </Td>
                          <Td>{u.parentPartNumber ?? '—'}</Td>
                          <Td align="right" className="tabular">
                            {Number(u.qty).toLocaleString('id-ID')}
                          </Td>
                          <Td className="tabular whitespace-nowrap">
                            {new Date(u.occurredAt).toLocaleString('id-ID')}
                          </Td>
                          <Td>
                            <EvidenceBadge evidence={u.evidence} />
                          </Td>
                        </Tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </Card>
            </Reveal>
          </div>
        )
      ) : null}

      {!q ? (
        <p className="mt-6 text-center text-[14px] text-ink-muted">
          Masukkan nomor seri unit atau nomor lot untuk mulai menelusuri.
        </p>
      ) : null}
    </>
  );
}

function ComponentTable({ rows }: { rows: import('@/lib/trace-api').TraceComponent[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Komponen</Th>
          <Th>Lot / Seri</Th>
          <Th>Supplier</Th>
          <Th align="right">Qty</Th>
          <Th>Bukti</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyState colSpan={5}>
            Belum ada komponen tercatat untuk unit ini. Silsilah terbentuk otomatis saat produksi
            memakai part yang punya BOM.
          </EmptyState>
        ) : (
          rows.map((c) => (
            <Tr key={c.id}>
              <Td strong>
                {c.componentPartNumber ?? '—'}
                <div className="text-[13px] font-normal text-ink-muted">
                  {c.componentPartName}
                </div>
              </Td>
              <Td className="tabular">
                {c.lotNumber ? (
                  <Link
                    href={`/trace?mode=forward&q=${encodeURIComponent(c.lotNumber)}`}
                    className="underline underline-offset-4"
                  >
                    {c.lotNumber}
                  </Link>
                ) : (
                  (c.componentSerial ?? '—')
                )}
                {c.supplierLotNumber ? (
                  <div className="text-[13px] text-ink-muted">supplier: {c.supplierLotNumber}</div>
                ) : null}
              </Td>
              <Td>{c.supplierName ?? '—'}</Td>
              <Td align="right" className="tabular">
                {Number(c.qty).toLocaleString('id-ID')}
              </Td>
              <Td>
                <EvidenceBadge evidence={c.evidence} />
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

/**
 * Menampilkan seberapa kuat buktinya.
 *
 * SCANNED berarti komponennya benar-benar discan. INFERRED berarti disimpulkan
 * dari lot yang aktif di line saat itu. Perbedaannya sengaja ditampilkan
 * mencolok: saat customer menuntut bukti, keduanya tidak setara, dan orang yang
 * membaca laporan ini harus tahu mana yang dipegangnya.
 */
function EvidenceBadge({ evidence }: { evidence: string }) {
  const scanned = evidence === 'SCANNED';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
        scanned ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn',
      )}
    >
      {scanned ? (
        <ShieldCheck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      ) : (
        <ShieldAlert className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      )}
      {scanned ? 'Discan' : 'Disimpulkan'}
    </span>
  );
}

function ModeLink({
  active,
  href,
  icon,
  children,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors',
        active
          ? 'bg-accent text-white'
          : 'border border-line text-ink-soft hover:bg-surface hover:text-ink',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold">{value}</div>
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return (
    <Card className="mt-5 px-6 py-14 text-center text-[14px] text-ink-muted">
      {what} tidak ditemukan. Periksa ejaannya, atau telusuri dengan nomor lot dari supplier.
    </Card>
  );
}
