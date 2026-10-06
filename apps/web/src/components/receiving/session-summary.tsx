import Link from 'next/link';
import { Package, History } from 'lucide-react';
import type { ReceivingSession } from '@avicenna/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr } from '@/components/ui/table';
import { CancelReceiving } from './cancel-receiving';

export function ReceivingSummary({
  session,
  canScan,
  admin,
}: {
  session: ReceivingSession;
  canScan: boolean;
  admin: boolean;
}) {
  const cancelled = session.status === 'CANCELLED';
  const draft = session.status === 'DRAFT';
  const status = cancelled
    ? 'Dibatalkan'
    : draft
      ? 'Sedang scan'
      : session.totals.missing
        ? 'Selesai parsial'
        : 'Selesai lengkap';
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Receiving', href: '/receiving' }, { label: session.documentNumber }]}
        title={session.orderNumber}
        description={`${session.supplierName} · ${session.documentNumber}`}
        actions={
          draft && canScan ? (
            <Link
              href={`/receiving-scan/${session.id}`}
              className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 font-bold text-white"
            >
              Lanjut scan
            </Link>
          ) : undefined
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-ink-muted">Status</p>
          <p
            className={`mt-2 text-lg font-bold ${cancelled ? 'text-ng' : draft || session.totals.missing ? 'text-warn' : 'text-ok'}`}
          >
            {status}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-ink-muted">Box discan / dipesan</p>
          <p className="mt-2 text-xl font-bold">
            {session.totals.boxScanned} / {session.totals.boxOrdered}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-ink-muted">
            {draft
              ? 'PCS hasil scan (belum masuk stok)'
              : cancelled
                ? 'PCS hasil scan (penerimaan dibatalkan)'
                : 'PCS masuk stok'}
          </p>
          <p className="mt-2 text-xl font-bold">
            {session.totals.pcsReceived.toLocaleString('id-ID')}
          </p>
        </div>
      </div>
      <p className="mb-5 text-sm text-ink-muted">
        {session.plantCode} · {session.locationName} · Cycle {session.cycle} · Jadwal{' '}
        {session.deliveryDate} {session.arrivalTime}
        {session.closedAt
          ? ` · Ditutup ${new Date(session.closedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`
          : ''}
      </p>
      {session.note && (
        <p className="mb-5 rounded-xl border border-line bg-card p-4 text-sm">
          Catatan: {session.note}
        </p>
      )}
      <Card>
        <CardHeader
          icon={Package}
          title="Item penerimaan"
          subtitle="Jumlah aktual berdasarkan kanban yang discan"
        />
        <Table>
          <thead>
            <tr>
              <Th>Back / Part number</Th>
              <Th>Nama</Th>
              <Th align="right">Pesanan</Th>
              <Th align="right">Diterima</Th>
              <Th align="right">Kurang</Th>
              <Th align="right">PCS</Th>
            </tr>
          </thead>
          <tbody>
            {session.lines.map((line) => (
              <Tr key={line.id}>
                <Td strong>
                  {line.backNumber || '—'}
                  <p className="mt-1 text-xs font-normal text-ink-muted">{line.partNumber}</p>
                </Td>
                <Td>{line.partName}</Td>
                <Td align="right">{line.boxOrdered} box</Td>
                <Td align="right" strong>
                  {line.boxScanned} box
                </Td>
                <Td align="right">{Math.max(0, line.boxOrdered - line.boxScanned)} box</Td>
                <Td align="right" strong>
                  {line.pcsReceived.toLocaleString('id-ID')}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="mt-5">
        <Card>
          <CardHeader
            icon={History}
            title="Riwayat scan"
            subtitle="100 aktivitas terakhir · operator, hasil, dan waktu tetap tercatat"
          />
          <ul className="max-h-96 overflow-y-auto divide-y divide-line px-5">
            {session.history.map((event) => (
              <li key={event.id} className="py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold">{event.message}</p>
                  <span className="text-xs text-ink-muted">
                    {event.userName ?? '—'} ·{' '}
                    {new Date(event.at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
                  </span>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                  {event.result} · {event.code}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-5 text-xs text-ink-muted">
        Stok dicatat berdasarkan hasil scan. GR ke SAP ditahan sampai kontrak integrasi disepakati.
      </p>
      {admin && !cancelled && <CancelReceiving id={session.id} received={!draft} />}
    </>
  );
}
