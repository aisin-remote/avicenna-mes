import Link from 'next/link';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { DriverAttendance } from '@/components/delivery/driver-attendance';
import { apiFetch } from '@/lib/api';
import { getSessionUser } from '@/lib/session';
import type { DriverAttendanceBoard } from '@avicenna/contracts';

export const dynamic = 'force-dynamic';
export default async function DeliveryReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ plantId?: string }>;
}) {
  const sp = await searchParams;
  const plantId = sp.plantId && /^[1-9]\d*$/.test(sp.plantId) ? Number(sp.plantId) : undefined;
  const [board, user] = await Promise.all([
    apiFetch<DriverAttendanceBoard>(`/driver-attendance${plantId ? `?plantId=${plantId}` : ''}`),
    getSessionUser(),
  ]);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
          <h1 className="text-[18px] font-extrabold leading-tight">Absensi Driver</h1>
          <p className="truncate text-[12px] text-ink-muted">
            Pickup truk, safety, dan keberangkatan pengiriman
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-3 sm:p-6">
        <DriverAttendance
          key={board.plantId}
          initial={board}
          today={today}
          canManage={user?.roleKind === 'ADMIN'}
          canOperate={user?.roleKind === 'ADMIN' || user?.roleKind === 'SCANNING'}
        />
      </main>
    </div>
  );
}
