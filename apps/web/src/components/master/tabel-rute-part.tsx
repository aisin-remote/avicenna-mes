'use client';

import { Fragment, useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { SCAN_MODE_LABELS } from '@avicenna/contracts';
import type { BarisRutePart, EntityDef, ScanMode } from '@avicenna/contracts';
import { deleteMasterAction } from '@/app/(app)/master/actions';
import { MasterForm, type PilihanDariMaster, type RefOptions } from './master-form';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

const JUDUL = [
  'Group Product',
  'Part Number',
  'Work Center',
  'SAP',
  'Asal',
  'Tujuan',
  'Sequence',
  'Mode',
  'Utama',
];

const Kosong = () => <span className="text-ink-muted">—</span>;

/** Tabel rute dengan kolom yang sama seperti tabel rute PPIC. */
export function TabelRutePart({
  def,
  rows,
  options,
  pilihanDariMaster,
}: {
  def: EntityDef;
  rows: BarisRutePart[];
  options: RefOptions;
  pilihanDariMaster: PilihanDariMaster;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BarisRutePart | null>(null);
  // Kunci MasterForm: useActionState menyimpan hasil terakhir, dan tanpa remount
  // `ok` lama langsung menutup panel yang baru dibuka.
  const [formKey, setFormKey] = useState(0);
  const tutupFormulir = useCallback(() => setFormOpen(false), []);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function buka(row: BarisRutePart | null) {
    setEditing(row);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  }

  function hapus(id: number) {
    const fd = new FormData();
    fd.set('__entity', 'part-processes');
    fd.set('__id', String(id));
    startTransition(async () => {
      const res = await deleteMasterAction({}, fd);
      if (res.error) {
        toast.galat(res.error, `${def.singular} tidak terhapus`);
        return;
      }
      setConfirmId(null);
      toast.ok(`${def.singular} dihapus.`);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <button
          type="button"
          onClick={() => buka(null)}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
        >
          <Plus className="size-[18px]" strokeWidth={2.4} aria-hidden />
          Tambah {def.singular}
        </button>
      </div>

      <div className="scroll-slim overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {JUDUL.map((j) => (
                <th
                  key={j}
                  scope="col"
                  className="whitespace-nowrap border-b border-line px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {j}
                </th>
              ))}
              <th scope="col" className="w-px border-b border-line px-4 py-3">
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={JUDUL.length + 1} className="px-5 py-14 text-center text-ink-muted">
                  Tidak ada langkah rute yang cocok.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const kelasSel = cn(
                'px-4 py-3 align-top text-ink-soft',
                r.masalah.length === 0 && 'border-b border-line',
                !r.isActive && 'opacity-50',
              );
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td className={kelasSel}>{r.project ?? <Kosong />}</td>
                    <td className={kelasSel}>
                      <div className="tabular whitespace-nowrap font-semibold text-ink">
                        {r.partNumber}
                        {r.backNumber ? ` (${r.backNumber})` : ''}
                      </div>
                      <div className="text-[12px] text-ink-muted">{r.partName}</div>
                    </td>
                    <td className={kelasSel}>
                      <div className="font-semibold text-ink">
                        {r.workCenter ?? r.lineCode ?? <Kosong />}
                      </div>
                      <div className="whitespace-nowrap text-[12px] text-ink-muted">
                        {r.processLabel}
                      </div>
                    </td>
                    <td className={kelasSel}>{r.sapProductionEnabled ? 'Ya' : 'Tidak'}</td>
                    <td className={kelasSel}>{r.inputLocationCode ?? <Kosong />}</td>
                    <td className={kelasSel}>{r.outputLocationCode ?? <Kosong />}</td>
                    <td className={cn(kelasSel, 'tabular')}>
                      {r.seqNo}
                      {r.isActive ? null : <div className="text-[12px]">Non-aktif</div>}
                    </td>
                    <td className={kelasSel}>
                      {r.scanMode ? (
                        (SCAN_MODE_LABELS[r.scanMode as ScanMode] ?? r.scanMode)
                      ) : (
                        <Kosong />
                      )}
                    </td>
                    <td className={kelasSel}>{r.isPrimary ? 'Utama' : <Kosong />}</td>
                    <td className={cn('px-4 py-3 align-top', r.masalah.length === 0 && 'border-b border-line')}>
                      <div className="flex items-center justify-end gap-1.5">
                        {confirmId === r.id ? (
                          <>
                            <span className="mr-1 text-[13px] text-ink-muted">Hapus?</span>
                            <button
                              type="button"
                              onClick={() => hapus(r.id)}
                              disabled={pending}
                              aria-label="Ya, hapus"
                              className="grid size-9 place-items-center rounded-full bg-ng text-white transition-colors hover:opacity-90 disabled:opacity-50"
                            >
                              <Check className="size-4" strokeWidth={2.4} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              aria-label="Batal"
                              className="grid size-9 place-items-center rounded-full border border-line transition-colors hover:bg-card"
                            >
                              <X className="size-4" strokeWidth={2.2} aria-hidden />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => buka(r)}
                              aria-label={`Ubah ${r.partNumber} sequence ${r.seqNo}`}
                              className="grid size-9 place-items-center rounded-full border border-line bg-card text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                            >
                              <Pencil className="size-4" strokeWidth={1.8} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(r.id)}
                              aria-label={`Hapus ${r.partNumber} sequence ${r.seqNo}`}
                              className="grid size-9 place-items-center rounded-full border border-line bg-card text-ink-muted transition-colors hover:border-ng/40 hover:text-ng"
                            >
                              <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {r.masalah.length > 0 ? (
                    <tr>
                      <td colSpan={JUDUL.length + 1} className="border-b border-line px-4 pb-3">
                        <p className="flex items-start gap-1.5 text-[13px] text-warn">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                          {r.masalah.join(' · ')}
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <MasterForm
        key={formKey}
        def={def}
        entity="part-processes"
        row={editing as (Record<string, unknown> & { id: number }) | null}
        options={options}
        pilihanDariMaster={pilihanDariMaster}
        open={formOpen}
        onClose={tutupFormulir}
      />
    </>
  );
}
