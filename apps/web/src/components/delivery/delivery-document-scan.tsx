'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, ScanLine, XCircle } from 'lucide-react';
import {
  resolveDeliveryDocumentAction,
  type DeliveryDocumentMatch,
} from '@/app/(app)/delivery/actions';

export function DeliveryDocumentScan() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [matches, setMatches] = useState<DeliveryDocumentMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => input.current?.focus(), []);

  async function resolve() {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setMatches([]);
    const result = await resolveDeliveryDocumentAction(value);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      input.current?.focus();
      input.current?.select();
      return;
    }
    const open = result.matches.filter(
      (item) =>
        item.status !== 'SHIPPED' && item.status !== 'RECEIVED' && item.status !== 'CANCELLED',
    );
    if (open.length === 1 && result.matches.length === 1) {
      router.push(`/loading/${open[0]!.id}`);
      return;
    }
    setMatches(result.matches);
  }

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-sm">
      <header className="px-4 py-5 sm:px-6">
        <h2 className="text-[18px] font-extrabold">Scan manifest atau loading list</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Arahkan scanner ke barcode dokumen untuk membuka daftar item customer.
        </p>
      </header>
      <div className="border-t border-line p-4 sm:p-6">
        <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            ['1', 'Manifest / Loading List', true],
            ['2', 'Kanban customer', false],
            ['3', 'Kanban internal', false],
          ].map(([number, label, active]) => (
            <div
              key={String(number)}
              className={`flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border px-1.5 py-3 text-center sm:flex-row sm:gap-3 sm:p-3 sm:text-left ${active ? 'border-accent bg-accent text-white' : 'border-line text-ink-muted'}`}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-current text-[13px] font-bold">
                {number}
              </span>
              <span className="text-[10px] font-semibold leading-tight sm:text-[13px]">
                {label}
              </span>
            </div>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void resolve();
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
            aria-label="Barcode manifest atau loading list"
            placeholder="scan manifest atau loading list…"
            className="tabular h-16 w-full rounded-2xl border-2 border-line bg-surface pl-14 pr-4 text-[18px] font-semibold outline-none transition-colors focus:border-accent focus:bg-card sm:h-20 sm:rounded-3xl sm:pr-5 sm:text-[26px]"
          />
        </form>

        {busy ? <p className="mt-4 text-[14px] text-ink-muted">Mencari dokumen…</p> : null}
        {error ? (
          <p className="mt-4 flex items-center gap-2 rounded-2xl border border-ng/40 bg-ng/10 p-4 text-[14px] font-semibold text-ng">
            <XCircle className="size-5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {matches.length > 0 ? (
          <div className="mt-5 space-y-2">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
              Pilih loading list
            </p>
            {matches.map((item) => {
              const closed = ['SHIPPED', 'RECEIVED', 'CANCELLED'].includes(item.status);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={closed}
                  onClick={() => router.push(`/loading/${item.id}`)}
                  className="flex w-full items-center gap-4 rounded-2xl border border-line p-4 text-left transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface">
                    {closed ? <XCircle className="size-5" /> : <Check className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="tabular block font-bold">{item.documentNumber}</span>
                    <span className="block truncate text-[13px] text-ink-muted">
                      {item.customerName ?? '—'} · rit {item.cycle} · {item.status}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
