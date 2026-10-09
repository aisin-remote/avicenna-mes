'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Radio, Inbox } from 'lucide-react';
import { Card, CardHeader } from './ui/card';
import { LiveDot } from './ui/chip';
import { springSoft, durations, easeSoft } from './motion/transitions';

interface ScanEvent {
  kind: string;
  partNumber: string | null;
  serialNumber: string | null;
  qty: number;
  scannedAt: string;
}

type Status = 'connecting' | 'live' | 'reconnecting';

const MAX_ROWS = 50;

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
  const [events, setEvents] = useState<Array<ScanEvent & { key: string }>>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const seq = useRef(0);

  useEffect(() => {
    const url = `${apiUrl}/realtime/line:${encodeURIComponent(lineCode)}`;
    /*
     * withCredentials: cookie sesi ikut terkirim — itulah satu-satunya cara
     * EventSource membuktikan diri, karena ia tidak bisa memasang header.
     * Tanpa ini API menjawab 401 dan monitor diam di "menyambung ulang".
     */
    const source = new EventSource(url, { withCredentials: true });

    source.onopen = () => setStatus('live');
    source.onerror = () => setStatus('reconnecting');
    source.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { type?: string; payload?: ScanEvent };
        if (parsed.type === 'ping' || !parsed.payload) return;
        seq.current += 1;
        const row = { ...parsed.payload, key: `${parsed.payload.scannedAt}-${seq.current}` };
        // Batasi jumlah baris supaya layar yang dibiarkan terbuka semalaman
        // tidak menumpuk ribuan node DOM.
        setEvents((prev) => [row, ...prev].slice(0, MAX_ROWS));
      } catch {
        // Pesan rusak diabaikan; koneksi tetap dipertahankan.
      }
    };

    return () => source.close();
  }, [lineCode, apiUrl]);

  const tone = status === 'live' ? 'ok' : status === 'connecting' ? 'warn' : 'ng';
  const text =
    status === 'live' ? 'Terhubung' : status === 'connecting' ? 'Menyambung' : 'Menyambung ulang';

  return (
    <Card>
      <CardHeader
        icon={Radio}
        title={`Aliran scan — ${lineCode}`}
        subtitle={`${events.length} kejadian sejak layar dibuka`}
        actions={
          <span className="flex items-center gap-2.5 rounded-full border border-line px-4 py-2 text-[13px] font-medium">
            <LiveDot tone={tone} />
            {text}
          </span>
        }
      />

      <div className="h-px bg-line" />

      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <motion.div
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Inbox className="size-8 text-ink-muted" strokeWidth={1.5} aria-hidden />
          </motion.div>
          <p className="text-[14px] text-ink-muted">
            Belum ada scan masuk. Layar ini terisi otomatis begitu ada kiriman.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {events.map((e, i) => (
              <motion.li
                key={e.key}
                layout
                initial={{ opacity: 0, height: 0, backgroundColor: 'rgba(79,70,229,0.07)' }}
                animate={{ opacity: 1, height: 'auto', backgroundColor: 'rgba(79,70,229,0)' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{
                  layout: springSoft,
                  height: { duration: durations.base, ease: easeSoft },
                  opacity: { duration: durations.base, ease: easeSoft },
                  // Sorotan biru memudar lebih lambat agar mata sempat menangkap
                  // baris mana yang baru masuk.
                  backgroundColor: { duration: 1.4, ease: easeSoft },
                }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-4 px-6 py-3.5 text-[14px]">
                  <span className="tabular w-20 shrink-0 text-[13px] font-medium text-ink-muted">
                    {new Date(e.scannedAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {e.partNumber ?? e.serialNumber ?? '—'}
                  </span>
                  <span className="tabular w-24 shrink-0 text-right font-semibold">
                    {e.qty} pcs
                  </span>
                  <span className="w-28 shrink-0 text-right text-[13px] text-ink-muted">
                    {e.kind}
                  </span>
                </div>
                {i === 0 ? null : null}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}
