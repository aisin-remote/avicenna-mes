import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PackageOpen } from 'lucide-react';
import { getLoading, type LoadingDetail } from '@/lib/loading-api';
import { getSessionUser } from '@/lib/session';
import { LoadingScan } from '@/components/delivery/loading-scan';

export const dynamic = 'force-dynamic';

/**
 * Layar pulling — mengambil barang jadi dari gudang ke staging.
 *
 * Langkah 4 pada diagram alur: PP02 (-) menjadi PP04 (+). Memakai layar scan
 * yang sama dengan tahap muat, hanya kolom yang dihitung dan SLOC yang
 * dipindahkan yang berbeda. Menyalin layarnya jadi dua berarti dua tempat yang
 * harus diperbaiki setiap kali perilaku scan berubah.
 */
export default async function PickingStationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** ?ids=64,65 — pulling satu manifest berisi beberapa loading list. */
  searchParams: Promise<{ ids?: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();
  const extra = ((await searchParams).ids ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0 && n !== numericId)
    .slice(0, 49);

  const user = await getSessionUser();

  let loaded: LoadingDetail[];
  try {
    loaded = await Promise.all([numericId, ...extra].map((n) => getLoading(n)));
  } catch {
    notFound();
  }
  const [doc, ...group] = loaded;
  if (!doc) notFound();
  // Loading list lain di manifest yang sudah ditutup tidak ikut di-pull lagi.
  const manifestDocs = [
    doc,
    ...group.filter(
      (d) =>
        (d.status === 'DRAFT' || d.status === 'PICKING') &&
        !!doc.manifestNumber &&
        d.manifestNumber === doc.manifestNumber,
    ),
  ];

  const terbuka = doc.status === 'DRAFT' || doc.status === 'PICKING';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* Ringkas seperti stasiun pulling lama: dokumen, customer, dan SLOC ada di tile layar scan. */}
      <header className="flex items-center gap-3 border-b border-line bg-card px-4 py-2.5">
        <Link
          href={`/delivery/${doc.id}`}
          aria-label="Kembali ke detail pengiriman"
          className="grid size-9 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink"
        >
          <ArrowLeft className="size-4" strokeWidth={1.9} aria-hidden />
        </Link>
        <p className="flex min-w-0 items-center gap-2 text-[17px] font-extrabold">
          <PackageOpen className="size-5 shrink-0 text-ink-muted" strokeWidth={1.9} aria-hidden />
          Pulling · <span className="truncate font-semibold text-ink-soft">{user?.name ?? '—'}</span>
        </p>
      </header>

      <main className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4">
        {!terbuka ? (
          <p className="rounded-card border border-ok/40 bg-ok/10 px-5 py-4 text-[15px] font-semibold text-ok">
            Pulling untuk dokumen ini sudah ditutup. Lanjutkan ke layar muat.
          </p>
        ) : manifestDocs.some((d) => !d.locationId || !d.stagingLocationId) ? (
          // Dicegah di sini, bukan saat menutup pulling: percuma men-scan
          // puluhan kanban lalu baru diberi tahu bahwa stoknya tidak bisa
          // dipindahkan ke mana pun.
          <p className="rounded-card border border-warn/40 bg-warn/10 px-5 py-4 text-[15px] font-semibold text-warn">
            Dokumen ini belum menentukan SLOC asal dan staging. Lengkapi dulu di halaman
            pengiriman, karena tanpa keduanya stok tidak bisa dipindahkan.
          </p>
        ) : (
          <LoadingScan docs={manifestDocs} phase="PULLING" />
        )}
      </main>
    </div>
  );
}
