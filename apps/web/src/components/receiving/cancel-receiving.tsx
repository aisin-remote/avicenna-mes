'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelReceivingAction } from '@/app/(app)/receiving/actions';

export function CancelReceiving({ id, received }: { id: number; received: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <details className="mt-6 rounded-xl border border-ng/25 p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-ng">
        Batalkan penerimaan (admin)
      </summary>
      <form
        className="mt-4 max-w-lg"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const result = await cancelReceivingAction(id, reason);
            if ('error' in result) setError(result.error);
            else router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-ink-muted">
          {received
            ? 'Stok masuk akan dibalik melalui mutasi koreksi; riwayat tidak dihapus.'
            : 'Sesi scan dibatalkan tanpa menambah stok.'}{' '}
          GR yang sudah dikirim ke SAP tidak dapat dibatalkan dari sini.
        </p>
        <label className="mt-3 block font-semibold">
          Alasan
          <textarea
            required
            minLength={3}
            maxLength={255}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-20 w-full rounded-xl border border-line bg-card p-3 font-normal"
          />
        </label>
        <label className="my-3 flex min-h-11 items-center gap-3">
          <input
            required
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="size-5"
          />{' '}
          Saya yakin membatalkan dokumen ini.
        </label>
        {error && (
          <p role="alert" className="mb-3 text-ng">
            {error}
          </p>
        )}
        <button
          disabled={busy || !confirmed}
          className="min-h-11 rounded-xl border border-ng/40 px-4 font-bold text-ng disabled:opacity-50"
        >
          {busy ? 'Membatalkan…' : 'Konfirmasi pembatalan'}
        </button>
      </form>
    </details>
  );
}
