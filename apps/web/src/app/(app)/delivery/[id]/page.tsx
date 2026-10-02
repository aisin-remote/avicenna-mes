import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Truck,
  ScanLine,
  MapPin,
  FileText,
  User,
  Calendar,
  PackageOpen,
  Tags,
  Printer,
  ListChecks,
  AlertTriangle,
} from 'lucide-react';
import { deliveryAttentionReason } from '@avicenna/domain';
import { getLoading } from '@/lib/loading-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr } from '@/components/ui/table';
import { InfoRow, InfoRowPair } from '@/components/ui/info-row';
import { Reveal } from '@/components/motion/reveal';
import { StatusChip, TruckChip } from '@/components/delivery/status-chip';
import { LoadingActions } from '@/components/delivery/loading-actions';

export const dynamic = 'force-dynamic';

/** "PP02 — Finish Good", atau penanda bila belum ditentukan. */
function sloc(code: string | null, name: string | null, peran: string): string {
  if (!code) return `${peran} belum ditentukan`;
  return name ? `${code} — ${name}` : code;
}

export default async function LoadingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  let doc;
  try {
    doc = await getLoading(numericId);
  } catch {
    notFound();
  }

  const totalPlanned = doc.lines.reduce((s, l) => s + l.plannedKanban, 0);
  const totalPicked = doc.lines.reduce((s, l) => s + l.pickedKanban, 0);
  const totalActual = doc.lines.reduce((s, l) => s + l.actualKanban, 0);
  const attentionReason = deliveryAttentionReason({
    status: doc.status,
    plannedKanban: totalPlanned,
    pickedKanban: totalPicked,
    actualKanban: totalActual,
    sapStatus: doc.sapStatus,
  });
  const open = doc.status !== 'SHIPPED' && doc.status !== 'RECEIVED' && doc.status !== 'CANCELLED';
  // Tahap yang sedang berjalan menentukan tombol mana yang ditawarkan — dua
  // tombol scan sekaligus hanya membuat orang menebak mana yang benar.
  const tahapPulling = doc.status === 'DRAFT' || doc.status === 'PICKING';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pengiriman', href: '/delivery' }, { label: doc.documentNumber }]}
        title={doc.documentNumber}
        description={`${doc.customerName ?? '—'} · rit ${doc.cycle} · sumber SAP/staging`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip status={doc.status} />
            <TruckChip status={doc.truckStatus} />
            {open ? (
              <Link
                href={tahapPulling ? `/picking/${doc.id}` : '/delivery-scan'}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
              >
                {tahapPulling ? (
                  <PackageOpen className="size-[18px]" strokeWidth={2.2} aria-hidden />
                ) : (
                  <ScanLine className="size-[18px]" strokeWidth={2.2} aria-hidden />
                )}
                {tahapPulling ? 'Mulai Pulling' : 'Mulai Muat'}
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="space-y-5">
        {attentionReason ? (
          <Reveal>
            <section className="rounded-card border border-ng/35 bg-ng/8 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-6 shrink-0 text-ng" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] font-bold text-ng">{attentionReason}</h2>
                  <p className="mt-1 text-[13px] text-ink-soft">
                    {doc.sapError ??
                      `Rencana ${totalPlanned}, diambil ${totalPicked}, dan dimuat ${totalActual} kanban.`}
                  </p>
                  {doc.sapStatus ? (
                    <p className="tabular mt-2 text-[12px] text-ink-muted">
                      Status SAP: <strong>{doc.sapStatus}</strong>
                      {doc.sapDocNumber ? ` · dokumen ${doc.sapDocNumber}` : ''}
                    </p>
                  ) : null}
                </div>
                {['FAILED', 'REJECTED', 'HELD'].includes(doc.sapStatus ?? '') ? (
                  <Link
                    href={`/sap?status=${doc.sapStatus}`}
                    className="shrink-0 rounded-full border border-ng/30 px-4 py-2 text-[13px] font-semibold text-ng hover:border-ng"
                  >
                    Buka antrean SAP
                  </Link>
                ) : null}
              </div>
            </section>
          </Reveal>
        ) : null}

        <Reveal>
          <Card>
            <CardHeader
              icon={Printer}
              title="Dokumen PPIC"
              subtitle="Buka dokumen secara terpisah agar setiap print job bisa memakai printer berbeda."
            />
            <div className="grid gap-3 border-t border-line px-6 py-5 md:grid-cols-3">
              {[
                {
                  href: `/delivery/${doc.id}/manifest`,
                  icon: FileText,
                  title: 'Manifest',
                  description: doc.manifestNumber ?? 'Nomor mengikuti data staging',
                },
                {
                  href: `/delivery/${doc.id}/picklist`,
                  icon: ListChecks,
                  title: 'Picklist / Loading List',
                  description: `${doc.lines.length} part · ${totalPlanned} kanban`,
                },
                {
                  href: `/delivery/${doc.id}/label`,
                  icon: Tags,
                  title: 'Kanban',
                  description: `${totalPlanned} label per box`,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.title}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex min-w-0 items-center gap-4 rounded-2xl border border-line bg-surface/60 p-4 transition-all hover:-translate-y-0.5 hover:border-line-strong hover:bg-card hover:shadow-lift"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-card text-ink shadow-sm ring-1 ring-line transition-colors group-hover:bg-ink group-hover:text-white">
                      <Icon className="size-5" strokeWidth={2} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-bold text-ink">{item.title}</span>
                      <span className="mt-1 block truncate text-[13px] text-ink-muted">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </Card>
        </Reveal>

        <Reveal>
          <Card>
            <CardHeader icon={FileText} title="Keterangan dokumen" />
            <InfoRowPair>
              <InfoRow icon={Calendar} label="Tanggal kirim">
                {new Date(`${doc.deliveryDate}T00:00:00`).toLocaleDateString('id-ID', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </InfoRow>
              <InfoRow icon={FileText} label="Nomor PDS">
                {doc.pdsNumber ?? '—'}
              </InfoRow>
              <InfoRow icon={FileText} label="Nomor manifest">
                {doc.manifestNumber ?? '—'}
              </InfoRow>
              <InfoRow icon={MapPin} label="Dock">
                {doc.dock ?? '—'}
              </InfoRow>
              {/* Kode SLOC di depan namanya: nama seperti "Finish Good" berulang
                  di tiap pabrik, sedangkan kode inilah yang dicocokkan dengan SAP. */}
              <InfoRow icon={PackageOpen} label="Alur SLOC">
                {sloc(doc.locationCode, doc.locationName, 'asal')} →{' '}
                {sloc(doc.stagingLocationCode, doc.stagingLocationName, 'staging')}
              </InfoRow>
              <InfoRow icon={Truck} label="Truk">
                {doc.truckNumber ?? '—'}
              </InfoRow>
              <InfoRow icon={User} label="Sopir">
                {doc.driverName ?? '—'}
              </InfoRow>
              <InfoRow icon={Truck} label="Berangkat">
                {doc.departedAt ? new Date(doc.departedAt).toLocaleString('id-ID') : 'belum'}
              </InfoRow>
            </InfoRowPair>
          </Card>
        </Reveal>

        <Reveal>
          <Card>
            <CardHeader
              icon={Truck}
              title="Muatan"
              subtitle={`${doc.lines.length} part · rencana ${totalPlanned} · diambil ${totalPicked} · dimuat ${totalActual} kanban`}
            />
            <Table>
              <thead>
                <tr>
                  <Th>Part</Th>
                  <Th>No. Customer</Th>
                  <Th align="right">Isi / kanban</Th>
                  <Th align="right">Rencana</Th>
                  <Th align="right">Diambil</Th>
                  <Th align="right">Dimuat</Th>
                  <Th align="right">Selisih</Th>
                  <Th align="right">Pcs dimuat</Th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => {
                  const diff = l.actualKanban - l.plannedKanban;
                  return (
                    <Tr key={l.id}>
                      <Td strong>
                        {l.partNumber}
                        <div className="text-[13px] font-normal text-ink-muted">{l.partName}</div>
                      </Td>
                      <Td className="tabular">{l.customerPartNumber ?? '—'}</Td>
                      <Td align="right" className="tabular">
                        {l.qtyPerKanban.toLocaleString('id-ID')}
                      </Td>
                      <Td align="right" className="tabular">
                        {l.plannedKanban.toLocaleString('id-ID')}
                      </Td>
                      <Td align="right" className="tabular">
                        {l.pickedKanban.toLocaleString('id-ID')}
                      </Td>
                      <Td align="right" strong className="tabular">
                        {l.actualKanban.toLocaleString('id-ID')}
                      </Td>
                      {/* Selisih ditampilkan sebagai kolom sendiri, bukan dihitung
                          di kepala orang — inilah yang ditanya customer. */}
                      <Td
                        align="right"
                        className={`tabular ${diff === 0 ? 'text-ink-muted' : diff > 0 ? 'text-warn' : 'text-ng'}`}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </Td>
                      <Td align="right" className="tabular">
                        {l.actualQty.toLocaleString('id-ID')}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </Reveal>

        <Reveal>
          <LoadingActions
            id={doc.id}
            status={doc.status}
            truckStatus={doc.truckStatus}
            totalPlanned={totalPlanned}
            totalPicked={totalPicked}
            totalActual={totalActual}
          />
        </Reveal>
      </div>
    </>
  );
}
