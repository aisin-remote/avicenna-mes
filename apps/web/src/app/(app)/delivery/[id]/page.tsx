import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Truck, ScanLine, MapPin, FileText, User, Calendar, PackageOpen } from 'lucide-react';
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

export default async function LoadingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
  const open = doc.status !== 'SHIPPED' && doc.status !== 'RECEIVED' && doc.status !== 'CANCELLED';
  // Tahap yang sedang berjalan menentukan tombol mana yang ditawarkan — dua
  // tombol scan sekaligus hanya membuat orang menebak mana yang benar.
  const tahapPulling = doc.status === 'DRAFT' || doc.status === 'PICKING';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Pengiriman', href: '/delivery' }, { label: doc.documentNumber }]}
        title={doc.documentNumber}
        description={`${doc.customerName ?? '—'} · rit ${doc.cycle}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip status={doc.status} />
            <TruckChip status={doc.truckStatus} />
            {open ? (
              <Link
                href={tahapPulling ? `/picking/${doc.id}` : `/loading/${doc.id}`}
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
