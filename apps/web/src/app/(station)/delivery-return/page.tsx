import Link from 'next/link';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { DeliveryReturnScan } from '@/components/delivery/delivery-return-scan';

export default function DeliveryReturnPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-card/95 px-3 py-3 backdrop-blur sm:px-6">
        <Link
          href="/delivery"
          aria-label="Kembali ke pengiriman"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink-muted"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white">
          <ClipboardCheck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-[18px] font-extrabold leading-tight">Scan Surat Jalan</h1>
          <p className="truncate text-[12px] text-ink-muted">Konfirmasi diterima customer</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-3 sm:p-6">
        <DeliveryReturnScan />
      </main>
    </div>
  );
}
