import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PackageOpen } from 'lucide-react';
import { getLoading } from '@/lib/loading-api';
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

  const terbuka = doc.status === 'DRAFT' || doc.status === 'PICKING';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
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
            <PackageOpen className="size-5 shrink-0 text-ink-muted" strokeWidth={1.9} aria-hidden />
            <span className="tabular truncate">{doc.documentNumber}</span>
          </p>
          <p className="text-[14px] text-ink-muted">
            Pulling · {doc.customerName ?? '—'} · rit {doc.cycle}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]">
          {/* Kode SLOC di depan, bukan hanya namanya: nama seperti "Finish Good"
              berulang di tiap pabrik, sedangkan kode inilah yang dicocokkan
              dengan SAP. */}
          <Meta label="Dari">{sloc(doc.locationCode, doc.locationName)}</Meta>
          <Meta label="Ke">{sloc(doc.stagingLocationCode, doc.stagingLocationName)}</Meta>
          <Meta label="Petugas">{user?.name ?? '—'}</Meta>
        </div>
      </header>

      <main className="scroll-slim min-h-0 flex-1 overflow-y-auto p-4">
        {!terbuka ? (
          <p className="rounded-card border border-ok/40 bg-ok/10 px-5 py-4 text-[15px] font-semibold text-ok">
            Pulling untuk dokumen ini sudah ditutup. Lanjutkan ke layar muat.
          </p>
        ) : !doc.locationId || !doc.stagingLocationId ? (
          // Dicegah di sini, bukan saat menutup pulling: percuma men-scan
          // puluhan kanban lalu baru diberi tahu bahwa stoknya tidak bisa
          // dipindahkan ke mana pun.
          <p className="rounded-card border border-warn/40 bg-warn/10 px-5 py-4 text-[15px] font-semibold text-warn">
            Dokumen ini belum menentukan SLOC asal dan staging. Lengkapi dulu di halaman
            pengiriman, karena tanpa keduanya stok tidak bisa dipindahkan.
          </p>
        ) : (
          <LoadingScan doc={doc} phase="PULLING" />
        )}
      </main>
    </div>
  );
}

/** "PP02 — Finish Good", atau penanda bila belum ditentukan. */
function sloc(code: string | null, name: string | null): string {
  if (!code) return 'belum ditentukan';
  return name ? `${code} — ${name}` : code;
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="tabular font-semibold">{children}</p>
    </div>
  );
}
