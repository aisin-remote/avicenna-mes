'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  PreparationSchedule,
  PreparationScheduleInput,
  PreparationSnapshot,
} from '@avicenna/contracts';
import { preparationScheduleSchema } from '@avicenna/contracts';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { PreparationDialog } from './dialog';
import {
  savePreparationCycleAction,
  deletePreparationCycleAction,
} from '@/app/(app)/preparation-monitoring/actions';

const inputClass =
  'h-11 w-full rounded-xl border border-line bg-surface px-3 outline-none focus:border-ink';
export function MasterCycle({
  data,
  canManage,
}: {
  data: PreparationSnapshot;
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PreparationSchedule | 'NEW' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const item = editing && editing !== 'NEW' ? editing : null;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = preparationScheduleSchema.safeParse({
      customerId: form.get('customerId'),
      destination: form.get('destination'),
      gate: form.get('gate'),
      cycle: form.get('cycle'),
      preparationStart: form.get('preparationStart'),
      preparationEnd: form.get('preparationEnd'),
      dayOffset: form.get('dayOffset'),
      truckTime: form.get('truckTime') || null,
      isActive: form.get('isActive') === 'on',
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues.map((i) => i.message).join('. '));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await savePreparationCycleAction(
        item?.id ?? null,
        parsed.data as PreparationScheduleInput,
      );
      if ('error' in result) setMessage(result.error ?? 'Gagal menyimpan master cycle.');
      else {
        setMessage(result.message);
        setEditing(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: PreparationSchedule) {
    if (
      !window.confirm(
        `Hapus jadwal ${row.customerName} cycle ${row.cycle}? Dokumen dan riwayat scan tetap utuh.`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await deletePreparationCycleAction(row.id);
      setMessage(
        'error' in result ? (result.error ?? 'Gagal menghapus master cycle.') : result.message,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {message && (
        <p role="status" className="rounded-xl border border-line p-3 text-sm">
          {message}
        </p>
      )}
      <Card>
        <CardHeader
          icon={Pencil}
          title="Master Cycle"
          subtitle="Jadwal PPIC menentukan rentang preparation dan ETA truck. Jam mentah SAP tidak otomatis menjadi deadline."
          actions={
            canManage ? (
              <Button
                icon={Plus}
                size="sm"
                onClick={() => {
                  setMessage('');
                  setEditing('NEW');
                }}
              >
                Tambah Master Cycle
              </Button>
            ) : undefined
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Customer / destination</Th>
              <Th>Cycle</Th>
              <Th>Rentang preparation</Th>
              <Th>Hari offset</Th>
              <Th>ETA truck</Th>
              <Th>Referensi jam SAP</Th>
              <Th>Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {data.schedules.map((row) => (
              <Tr key={row.id}>
                <Td strong>
                  {row.customerName}
                  <span className="mt-1 block text-xs font-normal text-ink-muted">
                    {row.destination || 'Semua destination'} · {row.gate || 'Semua gate'}
                    {!row.isActive ? ' · Nonaktif' : ''}
                  </span>
                </Td>
                <Td>{row.cycle}</Td>
                <Td>
                  {row.preparationStart?.slice(0, 5) ?? '—'} –{' '}
                  {row.preparationEnd?.slice(0, 5) ?? '—'}
                </Td>
                <Td>
                  H{row.dayOffset > 0 ? '+' : ''}
                  {row.dayOffset || ''}
                </Td>
                <Td>{row.truckTime?.slice(0, 5) ?? '—'}</Td>
                <Td>
                  <span className="block text-xs">
                    Pick {row.sapPickTime ?? '—'}
                    <br />
                    Loading {row.sapLoadingTime ?? '—'}
                    <br />
                    Delivery {row.sapDeliveryTime ?? '—'}
                  </span>
                </Td>
                <Td>
                  {canManage && (
                    <span className="flex gap-2">
                      <button
                        aria-label={`Edit cycle ${row.cycle} ${row.customerName}`}
                        onClick={() => {
                          setMessage('');
                          setEditing(row);
                        }}
                        className="rounded-lg border border-line p-2"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        disabled={busy}
                        aria-label={`Hapus cycle ${row.cycle} ${row.customerName}`}
                        onClick={() => void remove(row)}
                        className="rounded-lg border border-line p-2 text-red-500"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
            {!data.schedules.length && (
              <EmptyState colSpan={7}>
                Belum ada Master Cycle. Tambahkan jadwal PPIC atau sync referensi jadwal dari SAP.
              </EmptyState>
            )}
          </tbody>
        </Table>
      </Card>
      <Card>
        <div className="border-b border-line p-5 font-bold">Daftar Customer</div>
        <div className="grid gap-2 p-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {data.customers.map((c) => (
            <span key={c.id}>{c.name}</span>
          ))}
        </div>
      </Card>
      {editing && (
        <PreparationDialog
          title={item ? 'Edit Master Cycle' : 'Tambah Master Cycle'}
          close={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                Customer
                <select
                  name="customerId"
                  required
                  defaultValue={item?.customerId ?? ''}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Pilih customer
                  </option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                Cycle
                <input
                  name="cycle"
                  type="number"
                  min="1"
                  max="9999"
                  required
                  defaultValue={item?.cycle ?? ''}
                  list="preparation-cycles"
                  className={inputClass}
                />
                <datalist id="preparation-cycles">
                  {[...new Set(data.cycleGroups.map((g) => g.cycle))]
                    .sort((a, b) => a - b)
                    .map((c) => (
                      <option key={c} value={c} />
                    ))}
                </datalist>
              </label>
              <label className="space-y-2 text-sm">
                Destination (kosong = semua)
                <input
                  name="destination"
                  maxLength={32}
                  defaultValue={item?.destination ?? ''}
                  className={inputClass}
                />
              </label>
              <label className="space-y-2 text-sm">
                Gate (kosong = acuan PPIC)
                <input
                  name="gate"
                  maxLength={32}
                  defaultValue={item?.gate ?? ''}
                  className={inputClass}
                />
              </label>
              <label className="space-y-2 text-sm">
                Mulai preparation
                <input
                  name="preparationStart"
                  type="time"
                  required
                  defaultValue={item?.preparationStart?.slice(0, 5)}
                  className={inputClass}
                />
              </label>
              <label className="space-y-2 text-sm">
                Selesai preparation
                <input
                  name="preparationEnd"
                  type="time"
                  required
                  defaultValue={item?.preparationEnd?.slice(0, 5)}
                  className={inputClass}
                />
              </label>
              <label className="space-y-2 text-sm">
                Hari offset preparation
                <select name="dayOffset" defaultValue={item?.dayOffset ?? 0} className={inputClass}>
                  {Array.from({ length: 29 }, (_, i) => i - 14).map((n) => (
                    <option value={n} key={n}>
                      {n === 0 ? 'H (hari delivery)' : `H${n > 0 ? '+' : ''}${n}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                ETA truck
                <input
                  name="truckTime"
                  type="time"
                  required
                  defaultValue={item?.truckTime?.slice(0, 5)}
                  className={inputClass}
                />
              </label>
            </div>
            <p className="text-sm text-ink-muted">
              Jika jam selesai ≤ jam mulai, preparation berlanjut ke hari berikutnya. ETA truck
              mengikuti hari preparation dan aturan lintas tengah malam.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input name="isActive" type="checkbox" defaultChecked={item?.isActive ?? true} />
              Aktif
            </label>
            {message && (
              <p role="alert" className="text-sm text-red-500">
                {message}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Menyimpan…' : 'Simpan Master Cycle'}
              </Button>
            </div>
          </form>
        </PreparationDialog>
      )}
    </div>
  );
}
