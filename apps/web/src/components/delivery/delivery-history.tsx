import type { LoadingHistory } from '@/lib/loading-api';
import { Card, CardHeader } from '../ui/card';
import { History } from 'lucide-react';

export function DeliveryHistory({ history }: { history: LoadingHistory }) {
  const events = [
    ...history.scans.map((event) => ({
      key: `scan-${event.id}`,
      at: event.at,
      user: event.user,
      title:
        event.meta?.action === 'RECEIVE_RETURN'
          ? 'Surat jalan kembali · customer menerima barang'
          : event.meta?.action === 'UNDO'
            ? `Koreksi scan ${event.meta.phase}`
            : event.meta?.action === 'REJECTED'
              ? `Scan ditolak · ${event.meta.phase}`
              : `Scan ${event.meta?.phase ?? ''}`,
      detail: [event.serialNumber ?? event.rawCode, event.meta?.reason, `${event.qty} pcs`]
        .filter(Boolean)
        .join(' · '),
    })),
    ...history.movements.map((event) => ({
      key: `movement-${event.id}`,
      at: event.at,
      user: event.user,
      title: `${event.type} · ${event.partNumber ?? '—'}`,
      detail: `${event.qty} pcs · ${event.location ?? '—'} · ${event.note ?? ''}`,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <Card>
      <CardHeader
        icon={History}
        title="Riwayat delivery"
        subtitle="Scan, koreksi, perpindahan stok, dan surat jalan kembali"
      />
      <div className="max-h-96 space-y-4 overflow-y-auto px-5 pb-5">
        {!events.length ? <p className="text-[13px] text-ink-muted">Belum ada aktivitas.</p> : null}
        {events.map((event) => (
          <article key={event.key} className="border-l-2 border-line pl-4">
            <p className="text-[13px] font-semibold">{event.title}</p>
            <p className="mt-1 break-all text-[12px] text-ink-soft">{event.detail}</p>
            <p className="mt-1 text-[11px] text-ink-muted">
              {new Date(event.at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} ·{' '}
              {event.user ?? 'Sistem'}
            </p>
          </article>
        ))}
        {history.scans.length === 500 || history.movements.length === 500 ? (
          <p className="text-[11px] text-ink-muted">
            Menampilkan maksimal 500 aktivitas terbaru per jenis.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
