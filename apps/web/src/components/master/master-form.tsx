'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertCircle, Check } from 'lucide-react';
import type { EntityDef, FieldDef, MasterEntity } from '@avicenna/contracts';
import { saveMasterAction, type FormState } from '@/app/(app)/master/actions';
import { durations, easeSoft, springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

export type RefOptions = Record<string, Array<{ value: number; label: string; short?: string }>>;

const initial: FormState = {};

/**
 * Panel geser untuk membuat atau mengubah data master.
 *
 * Isinya dibangun dari definisi entitas, jadi satu komponen ini melayani
 * kesembilan entitas. Menambah kolom di registry langsung memunculkan
 * inputnya di sini tanpa perubahan kode.
 *
 * Panel geser dipilih daripada halaman terpisah supaya konteks daftar tetap
 * terlihat di belakangnya — operator tidak kehilangan tempatnya saat menyunting
 * satu baris di antara puluhan.
 */
export function MasterForm({
  def,
  entity,
  row,
  options,
  open,
  onClose,
}: {
  def: EntityDef;
  entity: MasterEntity;
  row?: (Record<string, unknown> & { id: number }) | null;
  options: RefOptions;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveMasterAction, initial);
  const router = useRouter();
  const titleId = useId();

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
  }, [state.ok, onClose, router]);

  // Esc menutup panel — jalan pintas yang diharapkan ada pada panel semacam ini.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const isEdit = Boolean(row);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.button
            type="button"
            aria-label="Tutup"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="absolute inset-0 cursor-default bg-ink/20 backdrop-blur-[2px]"
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={springSoft}
            className="relative flex h-full w-full max-w-[520px] flex-col bg-shell shadow-shell"
          >
            <header className="flex items-start gap-4 border-b border-line px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[19px] font-bold tracking-tight">
                  {isEdit ? `Ubah ${def.singular}` : `Tambah ${def.singular}`}
                </h2>
                <p className="mt-1 text-[13px] text-ink-muted">{def.description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup"
                className="grid size-9 shrink-0 place-items-center rounded-full border border-line transition-colors hover:bg-surface"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
              </button>
            </header>

            <form action={formAction} className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="__entity" value={entity} />
              <input type="hidden" name="__id" value={row?.id ?? ''} />

              <div className="scroll-slim flex-1 space-y-5 overflow-y-auto px-6 py-6">
                {state.error && !state.fieldErrors ? (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-2xl border border-ng/25 bg-ng/8 px-4 py-3 text-[14px] text-ng"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
                    {state.error}
                  </p>
                ) : null}

                {def.fields.map((field) => (
                  <Field
                    key={field.name}
                    field={field}
                    value={row?.[field.name]}
                    options={options[field.refEntity ?? ''] ?? []}
                    error={state.fieldErrors?.[field.name]}
                  />
                ))}
              </div>

              <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-full px-5 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                >
                  Batal
                </button>
                <motion.button
                  type="submit"
                  disabled={pending}
                  whileTap={pending ? undefined : { scale: 0.97 }}
                  transition={{ duration: durations.fast, ease: easeSoft }}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-60"
                >
                  {pending ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                      className="size-4 rounded-full border-2 border-white/30 border-t-white"
                    />
                  ) : (
                    <Check className="size-4" strokeWidth={2.4} aria-hidden />
                  )}
                  {pending ? 'Menyimpan' : 'Simpan'}
                </motion.button>
              </footer>
            </form>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

function Field({
  field,
  value,
  options,
  error,
}: {
  field: FieldDef;
  value: unknown;
  options: Array<{ value: number; label: string; short?: string }>;
  error?: string;
}) {
  const id = useId();
  const [checked, setChecked] = useState(
    value === undefined ? Boolean(field.defaultValue) : Boolean(value),
  );

  if (field.kind === 'boolean') {
    return (
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={id}
          onClick={() => setChecked((v) => !v)}
          className={cn(
            'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
            checked ? 'bg-ok' : 'bg-line-strong',
          )}
        >
          <motion.span
            layout
            transition={springSoft}
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow-sm',
              checked ? 'right-0.5' : 'left-0.5',
            )}
          />
        </button>
        {checked ? <input type="hidden" name={field.name} value="on" /> : null}
        <div className="min-w-0">
          <label id={id} className="block text-[14px] font-semibold">
            {field.label}
          </label>
          {field.hint ? (
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{field.hint}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-semibold">
        {field.label}
        {field.required ? <span className="ml-1 text-ng">*</span> : null}
      </label>

      {field.kind === 'select' ? (
        <select
          id={id}
          name={field.name}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          className={inputClass}
        >
          <option value="">— pilih —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.kind === 'reference' ? (
        <select
          id={id}
          name={field.name}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          className={inputClass}
        >
          <option value="">— pilih —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.name}
          type={field.kind === 'number' ? 'number' : 'text'}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          min={field.min}
          maxLength={field.kind === 'text' ? field.max : undefined}
          defaultValue={
            value === undefined || value === null
              ? field.defaultValue !== undefined && !Number.isNaN(field.defaultValue)
                ? String(field.defaultValue)
                : ''
              : String(value)
          }
          className={inputClass}
        />
      )}

      {error ? (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ng">
          <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : field.hint ? (
        <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">{field.hint}</p>
      ) : null}
    </div>
  );
}
