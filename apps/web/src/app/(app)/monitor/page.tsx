import Link from 'next/link';
import { listLines } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function MonitorIndexPage() {
  const lines = await listLines();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Monitor Line</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Pilih line untuk melihat scan yang masuk secara langsung
        </p>
      </header>

      {lines.length === 0 ? (
        <p className="surface rounded-xl px-5 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
          Belum ada line. Jalankan <code>pnpm db:seed</code> lebih dulu.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map((line) => (
            <Link
              key={line.id}
              href={`/monitor/${encodeURIComponent(line.code)}`}
              className="surface rounded-xl p-5 transition hover:border-brand-500"
            >
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                {line.plantCode} · {line.processType}
              </div>
              <div className="mt-2 text-lg font-semibold">{line.name}</div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                {line.code}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
