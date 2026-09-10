'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Plus, Pencil, Trash2, Check, X, AlertCircle } from 'lucide-react';
import type { EntityDef, MasterEntity } from '@avicenna/contracts';
import { MasterForm, type RefOptions } from './master-form';
import { deleteMasterAction } from '@/app/(app)/master/actions';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

type Row = Record<string, unknown> & { id: number };

/**
 * Tabel data master beserta aksinya.
 *
 * Komponen klien karena harus mengelola keadaan panel formulir dan konfirmasi
 * hapus. Definisi entitas dioper dari server — isinya hanya string, angka, dan
 * array, jadi aman melewati batas RSC (berbeda dengan komponen ikon).
 */
export function MasterTable({
  def,
  entity,
  rows,
  options,
  refLabels,
}: {
  def: EntityDef;
  entity: MasterEntity;
  rows: Row[];
  options: RefOptions;
  /** Peta id -> label untuk kolom referensi, disiapkan di server. */
  refLabels: Record<string, Record<string, string>>;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  /**
   * Dinaikkan setiap kali panel dibuka, dipakai sebagai `key` MasterForm.
   *
   * useActionState menyimpan hasil terakhir. Tanpa remount, `state.ok` dari
   * penyimpanan sebelumnya masih bernilai true saat panel dibuka lagi, dan
   * efek penutup langsung menutupnya kembali — panel seolah tidak mau terbuka.
   */
  const [formKey, setFormKey] = useState(0);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const listFields = def.fields.filter((f) => f.inList);

  function openCreate() {
    setEditing(null);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  }

  function doDelete(id: number) {
    setError(null);
    const fd = new FormData();
    fd.set('__entity', entity);
    fd.set('__id', String(id));
    startTransition(async () => {
      const res = await deleteMasterAction({}, fd);
      if (res.error) setError(res.error);
      else {
        setConfirmId(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <motion.button
          type="button"
          onClick={openCreate}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: durations.fast, ease: easeSoft }}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
        >
          <Plus className="size-[18px]" strokeWidth={2.4} aria-hidden />
          Tambah {def.singular}
        </motion.button>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Tutup pesan">
            <X className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="scroll-slim overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {listFields.map((f) => (
                <th
                  key={f.name}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap border-b border-line px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted',
                    f.numeric ? 'text-right' : 'text-left',
                  )}
                >
                  {f.label}
                </th>
              ))}
              <th scope="col" className="w-px border-b border-line px-5 py-3">
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={listFields.length + 1}
                  className="px-5 py-14 text-center text-[14px] text-ink-muted"
                >
                  Belum ada data {def.label.toLowerCase()}. Tekan
                  <span className="font-semibold text-ink"> Tambah {def.singular} </span>
                  untuk membuat yang pertama.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="group transition-colors duration-150 last:[&>td]:border-b-0 hover:bg-surface"
                >
                  {listFields.map((f) => (
                    <td
                      key={f.name}
                      className={cn(
                        'border-b border-line px-5 py-3.5 text-ink-soft',
                        f.numeric && 'tabular text-right',
                      )}
                    >
                      {renderCell(f.name, row[f.name], f.kind, refLabels[f.name])}
                    </td>
                  ))}
                  <td className="border-b border-line px-5 py-3.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {confirmId === row.id ? (
                        <>
                          <span className="mr-1 text-[13px] text-ink-muted">Hapus?</span>
                          <button
                            type="button"
                            onClick={() => doDelete(row.id)}
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
                        // Tombol aksi selalu terlihat, tidak disembunyikan
                        // sampai disapu kursor. Layar di lantai produksi banyak
                        // yang berupa layar sentuh, dan di sana hover tidak ada
                        // sama sekali — aksi yang hanya muncul saat hover
                        // menjadi mustahil ditemukan.
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            aria-label={`Ubah ${String(row.code ?? row.partNumber ?? row.id)}`}
                            className="grid size-9 place-items-center rounded-full border border-line bg-card text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                          >
                            <Pencil className="size-4" strokeWidth={1.8} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setError(null);
                              setConfirmId(row.id);
                            }}
                            aria-label={`Hapus ${String(row.code ?? row.partNumber ?? row.id)}`}
                            className="grid size-9 place-items-center rounded-full border border-line bg-card text-ink-muted transition-colors hover:border-ng/40 hover:text-ng"
                          >
                            <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <MasterForm
        key={formKey}
        def={def}
        entity={entity}
        row={editing}
        options={options}
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />
    </>
  );
}

function renderCell(
  name: string,
  value: unknown,
  kind: string,
  labels?: Record<string, string>,
) {
  if (kind === 'boolean') {
    const on = Boolean(value);
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold',
          on ? 'bg-ok/10 text-ok' : 'bg-line text-ink-muted',
        )}
      >
        <span className={cn('size-1.5 rounded-full', on ? 'bg-ok' : 'bg-ink-muted')} />
        {on ? 'Aktif' : 'Non-aktif'}
      </span>
    );
  }

  if (kind === 'reference') {
    if (value === null || value === undefined) return <span className="text-ink-muted">—</span>;
    return labels?.[String(value)] ?? String(value);
  }

  if (value === null || value === undefined || value === '') {
    return <span className="text-ink-muted">—</span>;
  }

  if (kind === 'select') {
    return (
      <span className="inline-flex items-center rounded-full border border-line px-3 py-1.5 text-[12px]">
        {String(value)}
      </span>
    );
  }

  return String(value);
}
