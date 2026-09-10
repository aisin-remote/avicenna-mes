import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Truck } from 'lucide-react';
import { getLoading } from '@/lib/loading-api';
import { getSessionUser } from '@/lib/session';
import { LoadingScan } from '@/components/delivery/loading-scan';

export const dynamic = 'force-dynamic';

/**
 * Layar muat barang — memenuhi layar, tanpa menu.
 *
 * Berada di route group (station) yang punya layout sendiri, sehingga sidebar
 * tidak ikut dirender. Alamatnya tetap /loading/<id>: route group tidak
 * memengaruhi URL.
 */
export default async function LoadingStationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const user = await getSessionUser();

  let doc;
  try {
    doc = await getLoading(numericId);
  } catch {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-card px-6 py-4">
        <Link
          href={`/delivery/${doc.id}`}
          aria-label="Kembali ke detail pengiriman"
          className="grid size-11 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink"
        >
          <ArrowLeft className="size-5" strokeWidth={1.9} aria-hidden />
        </Link>

        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[19px] font-extrabold leading-tight">
            <Truck className="size-5 shrink-0 text-ink-muted" strokeWidth={1.9} aria-hidden />
            <span className="tabular truncate">{doc.documentNumber}</span>
          </p>
          <p className="text-[14px] text-ink-muted">
            {doc.customerName ?? '—'} · rit {doc.cycle}
            {doc.dock ? ` · dock ${doc.dock}` : ''}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]">
          <Meta label="Tanggal kirim">
            {new Date(`${doc.deliveryDate}T00:00:00`).toLocaleDateString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </Meta>
          <Meta label="Truk">{doc.truckNumber ?? '—'}</Meta>
          <Meta label="Petugas">{user?.name ?? '—'}</Meta>
        </div>
      </header>

      <main className="flex-1 p-6">
        {doc.status === 'SHIPPED' || doc.status === 'RECEIVED' ? (
          <p className="rounded-card border border-ok/40 bg-ok/10 px-5 py-4 text-[15px] font-semibold text-ok">
            Loading list ini sudah berangkat. Tidak ada lagi yang perlu discan.
          </p>
        ) : doc.status === 'CANCELLED' ? (
          <p className="rounded-card border border-ng/40 bg-ng/10 px-5 py-4 text-[15px] font-semibold text-ng">
            Loading list ini sudah dibatalkan.
          </p>
        ) : (
          <LoadingScan doc={doc} />
        )}
      </main>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="tabular font-semibold">{children}</p>
    </div>
  );
}
