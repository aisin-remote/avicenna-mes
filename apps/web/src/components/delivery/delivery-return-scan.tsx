'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import {
  receiveReturnedDeliveryAction,
  type DeliveryReturnResult,
} from '@/app/(app)/delivery/actions';

export function DeliveryReturnScan() {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<DeliveryReturnResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => input.current?.focus(), []);

  async function receive() {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const next = await receiveReturnedDeliveryAction(value);
    setBusy(false);
    if ('error' in next) {
      setError(next.error);
      input.current?.select();
      return;
    }
    setResult(next);
    setCode('');
    input.current?.focus();
  }

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <header className="px-4 py-5 sm:px-6">
        <h2 className="text-[18px] font-extrabold">Scan surat jalan yang kembali</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Scan barcode nomor surat jalan atau DO sebagai penanda barang sudah diterima customer.
        </p>
      </header>

      <div className="border-t border-line p-4 sm:p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void receive();
          }}
          className="relative"
        >
          <ScanLine
            className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-ink-muted"
            strokeWidth={1.8}
            aria-hidden
          />
          <input
            ref={input}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Barcode surat jalan atau DO"
            placeholder="scan surat jalan / DO…"
            className="tabular h-16 w-full rounded-2xl border-2 border-line bg-surface pl-14 pr-4 text-[18px] font-semibold outline-none transition-colors focus:border-accent focus:bg-card sm:h-20 sm:rounded-3xl sm:pr-5 sm:text-[26px]"
          />
        </form>

        {busy ? <p className="mt-4 text-[14px] text-ink-muted">Memeriksa surat jalan…</p> : null}
        {error ? (
          <p className="mt-4 flex items-center gap-2 rounded-2xl border border-ng/40 bg-ng/10 p-4 text-[14px] font-semibold text-ng">
            <XCircle className="size-5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {result ? (
          <div className="mt-4 flex items-start gap-4 rounded-2xl border border-ok/40 bg-ok/10 p-4 text-ok sm:p-5">
            <CheckCircle2 className="mt-0.5 size-7 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-extrabold">
                {result.alreadyReceived ? 'Sudah pernah diterima customer' : 'Diterima customer'}
              </p>
              <p className="tabular mt-1 text-[18px] font-bold text-ink">{result.documentNumber}</p>
              <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                {result.customerName ?? 'Customer tidak diketahui'} · {result.deliveryDate}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
