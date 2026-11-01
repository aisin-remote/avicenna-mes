'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { DELIVERY_SAP_STAGES, DELIVERY_SAP_LABELS, type DeliveryFlow } from '@avicenna/contracts';
const LABELS: Record<DeliveryFlow['stage'], string> = {
  WAITING_GI_AIIA: 'Menunggu GI AIIA',
  WAITING_GR_AII: 'Menunggu GR AII',
  READY: 'Surat jalan siap untuk driver',
  WAITING_GI_AII: 'Pickup selesai · menunggu GI AII',
  SHIPPED: 'GI AII berhasil · pengiriman berangkat',
  BLOCKED: 'Alur pengiriman perlu diperiksa',
};
export function DeliveryFlowPanel({
  flow,
  allowRefresh = true,
}: {
  flow: DeliveryFlow;
  allowRefresh?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="rounded-card border border-line bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">{LABELS[flow.stage]}</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {flow.number ?? 'Nomor DO terbit setelah GI AIIA & GR AII berhasil'} · PDS{' '}
            {flow.pdsNumber}
          </p>
        </div>
        {allowRefresh ? (
          <button
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
            className="min-h-11 rounded-full border border-line px-4 text-sm disabled:opacity-50"
          >
            {pending ? 'Memuat…' : 'Perbarui status'}
          </button>
        ) : null}
      </div>
      {flow.isSimulation ? (
        <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm font-bold text-warn">
          SIMULASI · bukan bukti posting SAP nyata
        </p>
      ) : null}
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {DELIVERY_SAP_STAGES.map((type, index) => {
          const step = flow.steps.find((s) => s.type === type);
          return (
            <li
              key={type}
              className={`min-w-0 rounded-2xl border p-3 ${step?.status === 'CONFIRMED' ? 'border-ok/40 bg-ok/5' : 'border-line bg-surface'}`}
            >
              <p className="text-sm font-bold">
                {index + 1}. {DELIVERY_SAP_LABELS[type]}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {step?.status ??
                  (type === 'DELIVERY_GI_AII'
                    ? 'Menunggu Selesai Pickup'
                    : 'Menunggu tahap sebelumnya')}
                {step?.isSimulation ? ' · SIMULASI' : ''}
              </p>
              {step?.sapDocNumber ? (
                <p className="mt-1 break-all text-sm">{step.sapDocNumber}</p>
              ) : null}
              {step?.error ? (
                <p className="mt-2 break-words text-xs text-warn">
                  {step.status === 'HELD' && step.error.startsWith('Kontrak staging SD')
                    ? 'Integrasi SAP belum siap. Hubungi admin untuk melanjutkan.'
                    : step.error}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {flow.stage === 'READY' ? (
        <Link
          href="/delivery-return"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-white"
        >
          Absensi Driver
        </Link>
      ) : null}
    </section>
  );
}
