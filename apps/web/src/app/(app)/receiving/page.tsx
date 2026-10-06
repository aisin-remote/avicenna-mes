import Link from 'next/link';
import { Truck } from 'lucide-react';
import { getDb, locations, plants, and, eq } from '@avicenna/db';
import { listReceipts } from '@/lib/receiving-api';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { OpenReceivingForm } from '@/components/receiving/open-session-form';

export const dynamic = 'force-dynamic';

export default async function ReceivingListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = ['DRAFT', 'RECEIVED', 'CANCELLED'].includes(sp.status ?? '') ? sp.status! : 'ALL';
  const user = await getSessionUser();
  const canScan = user?.roleKind === 'ADMIN' || user?.roleKind === 'SCANNING';
  const [{ data, meta }, warehouses] = await Promise.all([
    listReceipts(page, 25, status),
    canScan
      ? getDb()
          .select({
            value: locations.id,
            name: locations.name,
            code: locations.code,
            plant: plants.code,
          })
          .from(locations)
          .innerJoin(plants, eq(plants.id, locations.plantId))
          .where(
            and(
              eq(locations.kind, 'WAREHOUSE'),
              eq(plants.isActive, true),
              user?.roleKind === 'ADMIN' ? undefined : eq(locations.plantId, user?.plantId ?? -1),
            ),
          )
          .orderBy(plants.id, locations.code)
      : Promise.resolve([]),
  ]);
  const labels: Record<string, string> = {
    ALL: 'Semua',
    DRAFT: 'Sedang scan',
    RECEIVED: 'Selesai',
    CANCELLED: 'Dibatalkan',
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Receiving' }]}
        title="Receiving"
        description="Penerimaan supplier berdasarkan Order Sheet"
      />
      {canScan && (
        <OpenReceivingForm
          locations={warehouses.map((location) => ({
            value: location.value,
            label: `${location.plant} · ${location.code} — ${location.name}`,
          }))}
        />
      )}
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter status">
        {Object.entries(labels).map(([value, label]) => (
          <Link
            key={value}
            href={`/receiving?status=${value}`}
            aria-current={status === value ? 'page' : undefined}
            className={`min-h-11 rounded-full border px-4 py-2.5 text-sm ${status === value ? 'border-accent bg-accent text-white' : 'border-line bg-card text-ink-muted'}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader
          icon={Truck}
          title="Sesi & riwayat penerimaan"
          subtitle={`${meta.total} dokumen`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Dokumen / Order Sheet</Th>
              <Th>Supplier</Th>
              <Th>Dibuka</Th>
              <Th align="right">Box / Qty</Th>
              <Th>Status</Th>
              <Th>Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <EmptyState colSpan={6}>Belum ada penerimaan pada status ini.</EmptyState>
            ) : (
              data.map((receipt) => (
                <Tr key={receipt.id}>
                  <Td strong>
                    <Link
                      href={`/receiving/${receipt.id}`}
                      className="underline underline-offset-4"
                    >
                      {receipt.documentNumber}
                    </Link>
                    <p className="mt-1 text-xs font-normal text-ink-muted">
                      {receipt.aresOrderNumber ??
                        `Manual · ${receipt.supplierDocNumber ?? 'Tanpa surat jalan'}`}
                    </p>
                  </Td>
                  <Td>{receipt.supplierName ?? '—'}</Td>
                  <Td className="whitespace-nowrap">
                    {new Date(receipt.receivedAt).toLocaleString('id-ID', {
                      timeZone: 'Asia/Jakarta',
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Td>
                  <Td align="right" strong>
                    {receipt.boxOrdered !== null
                      ? `${receipt.boxScanned} / ${receipt.boxOrdered} box`
                      : `${Number(receipt.totalQty).toLocaleString('id-ID')} pcs`}
                  </Td>
                  <Td>
                    <span
                      className={
                        receipt.status === 'CANCELLED'
                          ? 'text-ng'
                          : receipt.status === 'DRAFT'
                            ? 'text-warn'
                            : 'text-ok'
                      }
                    >
                      {labels[receipt.status] ?? receipt.status}
                      {receipt.status === 'RECEIVED' &&
                      receipt.boxOrdered !== null &&
                      receipt.boxScanned < receipt.boxOrdered
                        ? ' · Parsial'
                        : ''}
                    </span>
                  </Td>
                  <Td>
                    {receipt.status === 'DRAFT' && receipt.aresOrderNumber && canScan ? (
                      <Link
                        href={`/receiving-scan/${receipt.id}`}
                        className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-semibold"
                      >
                        Lanjut scan
                      </Link>
                    ) : (
                      <Link href={`/receiving/${receipt.id}`}>Detail</Link>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
      <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
        <span>
          Halaman {meta.page} dari {Math.max(1, meta.totalPages)}
        </span>
        <div className="flex gap-4">
          {page > 1 && (
            <Link href={`/receiving?status=${status}&page=${page - 1}`}>Sebelumnya</Link>
          )}
          {page < meta.totalPages && (
            <Link href={`/receiving?status=${status}&page=${page + 1}`}>Berikutnya</Link>
          )}
        </div>
      </div>
      {canScan && (
        <details className="mt-6 text-sm text-ink-muted">
          <summary className="cursor-pointer py-2">Penerimaan manual</summary>
          <Link href="/receiving/new" className="mt-2 inline-flex min-h-11 items-center underline">
            Buka form penerimaan manual
          </Link>
        </details>
      )}
    </>
  );
}
