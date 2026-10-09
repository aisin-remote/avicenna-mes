import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { NgOutline } from '@/components/scan/ng-outline';

export const dynamic = 'force-dynamic';

/**
 * Layar NG outline — kerusakan yang ketemu di luar lini.
 *
 * Tidak terikat lini, jadi tidak ada langkah "scan barcode lini" seperti layar
 * produksi: barang yang diperiksa di rak bisa datang dari lini mana pun, dan
 * memaksa memilih satu akan membuat NG-nya tercatat di lini yang belum tentu
 * membuatnya.
 */
export default async function NgOutlinePage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>;
}) {
  const sp = await searchParams;

  return (
    <div className="scroll-slim h-dvh overflow-y-auto px-4 py-5">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-7 text-ng" strokeWidth={1.8} aria-hidden />
          <div>
            <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">
              Input NG outline
            </h1>
            <p className="text-[14px] text-ink-muted">
              Kerusakan yang ketemu di luar lini — di rak, saat audit, atau sebelum kirim.
            </p>
          </div>
        </div>
        {/* Layout stasiun sengaja tanpa sidebar, jadi jalan kembali harus ada
            di halamannya sendiri — kalau tidak, orangnya terkurung di sini. */}
        <Link
          href="/dashboard"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          <ArrowLeft className="size-4" strokeWidth={1.8} aria-hidden /> Keluar
        </Link>
      </header>
      <NgOutline lineCode={sp.line?.trim() || undefined} />
    </div>
  );
}
