import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Truck, PackageOpen } from 'lucide-react';
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
export default async function LoadingStationPage({ params }: { params: Promise<{ id: string }> }) {
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
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-card/95 px-3 py-3 backdrop-blur sm:flex-wrap sm:gap-x-6 sm:gap-y-3 sm:px-6 sm:py-4">
        <Link
          href="/delivery-scan"
          aria-label="Kembali ke scan delivery"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink sm:size-11"
        >
          <ArrowLeft className="size-5" strokeWidth={1.9} aria-hidden />
        </Link>

        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[19px] font-extrabold leading-tight">
            <Truck className="size-5 shrink-0 text-ink-muted" strokeWidth={1.9} aria-hidden />
            <span className="tabular truncate">{doc.documentNumber}</span>
          </p>
          <p className="truncate text-[12px] text-ink-muted sm:text-[14px]">
            {doc.customerName ?? '—'} · rit {doc.cycle}
            {doc.dock ? ` · dock ${doc.dock}` : ''}
          </p>
        </div>

        <div className="ml-auto hidden flex-wrap items-center gap-x-6 gap-y-2 text-[14px] md:flex">
          <Meta label="Tanggal kirim">
            {new Date(`${doc.deliveryDate}T00:00:00`).toLocaleDateString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </Meta>
          <Meta label="Manifest">{doc.manifestNumber ?? '—'}</Meta>
          <Meta label="Truk">{doc.truckNumber ?? '—'}</Meta>
          <Meta label="Petugas">{user?.name ?? '—'}</Meta>
        </div>
      </header>

      <main className="scroll-slim min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {doc.status === 'SHIPPED' || doc.status === 'RECEIVED' ? (
          <p className="rounded-card border border-ok/40 bg-ok/10 px-5 py-4 text-[15px] font-semibold text-ok">
            Loading list ini sudah berangkat. Tidak ada lagi yang perlu discan.
          </p>
        ) : doc.status === 'CANCELLED' ? (
          <p className="rounded-card border border-ng/40 bg-ng/10 px-5 py-4 text-[15px] font-semibold text-ng">
            Loading list ini sudah dibatalkan.
          </p>
        ) : doc.status === 'DRAFT' || doc.status === 'PICKING' ? (
          // Memuat barang yang belum diambil dari gudang membuat saldo staging
          // minus. Dihentikan di sini supaya operator tidak terlanjur men-scan.
          <div className="rounded-card border border-warn/40 bg-warn/10 px-5 py-4">
            <p className="text-[15px] font-semibold text-warn">
              Barangnya belum selesai diambil dari gudang.
            </p>
            <Link
              href={`/picking/${doc.id}`}
              className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
            >
              <PackageOpen className="size-[18px]" strokeWidth={2.2} aria-hidden />
              Buka layar pulling
            </Link>
          </div>
        ) : (
          <LoadingScan doc={doc} phase="LOADING" />
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
