'use client';

import { useEffect, useRef, useState } from 'react';

interface ScanEvent {
  kind: string;
  partNumber: string | null;
  serialNumber: string | null;
  qty: number;
  scannedAt: string;
}

type Status = 'connecting' | 'live' | 'reconnecting';

/**
 * Layar monitor realtime satu line.
 *
 * Menyambung ke SSE milik API. EventSource menangani sambung-ulang sendiri
 * saat jaringan pabrik terputus sesaat — itu yang membuatnya lebih cocok
 * daripada WebSocket untuk aliran satu arah seperti ini.
 *
 * Event `ping` dari server hanya penjaga koneksi, bukan data; kalau tidak
 * disaring ia akan muncul sebagai baris kosong di daftar.
 */
export function LiveMonitor({ lineCode, apiUrl }: { lineCode: string; apiUrl: string }) {
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `${apiUrl}/realtime/line:${encodeURIComponent(lineCode)}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => setStatus('live');
    source.onerror = () => setStatus('reconnecting');
    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { type?: string; payload?: ScanEvent };
        if (parsed.type === 'ping' || !parsed.payload) return;
        // Batasi 50 baris supaya layar yang dibiarkan terbuka semalaman
        // tidak menumpuk ribuan node DOM.
        setEvents((prev) => [parsed.payload as ScanEvent, ...prev].slice(0, 50));
      } catch {
        // Pesan rusak diabaikan; koneksi tetap dipertahankan.
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [lineCode, apiUrl]);

  return (
    <div className="surface rounded-xl">
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 className="font-semibold">Line {lineCode}</h2>
        <span className="flex items-center gap-2 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background:
                status === 'live'
                  ? 'var(--color-ok)'
                  : status === 'connecting'
                    ? 'var(--color-warn)'
                    : 'var(--color-ng)',
            }}
          />
          {status === 'live' ? 'Terhubung' : status === 'connecting' ? 'Menyambung' : 'Menyambung ulang'}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
          Belum ada scan masuk. Layar ini akan terisi otomatis.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {events.map((e, i) => (
            <li key={`${e.scannedAt}-${i}`} className="flex items-center gap-4 px-5 py-3 text-sm">
              <span className="w-24 shrink-0 text-xs font-medium" style={{ color: 'var(--muted)' }}>
                {new Date(e.scannedAt).toLocaleTimeString('id-ID')}
              </span>
              <span className="flex-1 font-medium">{e.partNumber ?? e.serialNumber ?? '-'}</span>
              <span className="tabular w-16 text-right">{e.qty} pcs</span>
              <span className="w-24 text-right text-xs" style={{ color: 'var(--muted)' }}>
                {e.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
