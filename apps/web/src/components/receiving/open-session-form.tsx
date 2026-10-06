'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine, Keyboard } from 'lucide-react';
import { openReceivingAction } from '@/app/(app)/receiving/actions';

export function OpenReceivingForm({
  locations,
}: {
  locations: Array<{ value: number; label: string }>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [locationId, setLocationId] = useState(String(locations[0]?.value ?? ''));
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => input.current?.focus(), []);

  return (
    <section className="mb-6 rounded-card border border-line bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <ScanLine className="size-5" aria-hidden /> Mulai receiving
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Scan Order Sheet, kemudian scan kanban setiap box yang datang.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setManual(!manual);
            input.current?.focus();
          }}
          aria-pressed={manual}
          aria-label="Keyboard manual"
          className="min-h-11 rounded-xl border border-line px-3"
        >
          <Keyboard className="size-5" aria-hidden />
        </button>
      </div>
      <form
        className="grid items-end gap-4 sm:grid-cols-[1fr_1.4fr_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const result = await openReceivingAction(code, Number(locationId));
            if ('error' in result) {
              setError(result.error);
              input.current?.select();
            } else
              router.push(
                result.status === 'DRAFT'
                  ? `/receiving-scan/${result.id}`
                  : `/receiving/${result.id}`,
              );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-sm font-semibold">
          Gudang penerimaan
          <select
            required
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3 text-ink"
          >
            {!locations.length && <option value="">Belum ada lokasi warehouse</option>}
            {locations.map((location) => (
              <option key={location.value} value={location.value}>
                {location.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Order Sheet
          <input
            ref={input}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode={manual ? 'text' : 'none'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Scan Order Sheet…"
            className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-4 font-mono focus:border-accent focus:outline-none"
          />
        </label>
        <button
          disabled={busy || !locations.length}
          className="min-h-12 rounded-xl bg-accent px-6 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Membuka…' : 'Buka sesi'}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-4 text-sm font-semibold text-ng">
          {error}
        </p>
      )}
    </section>
  );
}
