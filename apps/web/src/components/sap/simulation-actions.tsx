'use client';

import { useState } from 'react';
import { Check, X, RotateCcw } from 'lucide-react';
import { simulateSapAction } from '@/app/(app)/sap/actions';
import { useToast } from '@/components/ui/toast';

export function SimulationActions({ id, reset = false }: { id: number; reset?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(outcome: 'CONFIRMED' | 'REJECTED' | 'PENDING') {
    if (outcome === 'REJECTED' && !window.confirm('Simulasikan Good Issue ditolak SAP?')) return;
    setBusy(true);
    const result = await simulateSapAction(id, outcome);
    setBusy(false);
    if ('error' in result) return toast.galat(result.error);
    toast.ok(
      outcome === 'PENDING'
        ? 'Good Issue trial siap disimulasikan ulang.'
        : outcome === 'CONFIRMED'
          ? `Good Issue trial dikonfirmasi: ${result.sapDocNumber ?? 'tanpa nomor'}`
          : 'Good Issue trial ditandai ditolak.',
    );
  }

  return (
    <span className="mt-1 flex gap-1">
      {reset ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run('PENDING')}
          aria-label="Ulangi simulasi GI"
          className="grid size-7 place-items-center rounded-full border border-line text-ink-muted"
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void run('CONFIRMED')}
            disabled={busy}
            title="Simulasikan berhasil"
            aria-label="Simulasikan GI berhasil"
            className="grid size-7 place-items-center rounded-full border border-ok/40 text-ok hover:bg-ok/10 disabled:opacity-40"
          >
            <Check className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void run('REJECTED')}
            disabled={busy}
            title="Simulasikan ditolak"
            aria-label="Simulasikan GI ditolak"
            className="grid size-7 place-items-center rounded-full border border-ng/40 text-ng hover:bg-ng/10 disabled:opacity-40"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </>
      )}
    </span>
  );
}
