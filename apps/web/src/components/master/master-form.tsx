'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertCircle, Check } from 'lucide-react';
import { nadaTombol } from '@avicenna/contracts';
import type { EntityDef, FieldDef, MasterEntity } from '@avicenna/contracts';

import { saveMasterAction, type FormState } from '@/app/(app)/master/actions';
import { useToast } from '../ui/toast';
import { useHasilAksi } from '../ui/use-hasil-aksi';
import { BidangGambar } from './bidang-gambar';
import { durations, easeSoft, springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

export type RefOption = { value: number; label: string; short?: string; plantId?: number | null };
export type RefOptions = Record<string, RefOption[]>;

/**
 * Pilihan untuk kolom yang daftarnya HIDUP di master lain sambil menyimpan
 * KODE, bukan id — sejauh ini hanya jenis proses.
 *
 * Terpisah dari RefOptions karena `RefOption.value` bertipe angka: kolom
 * seperti ini menyimpan teks, dan memaksanya masuk ke bentuk yang sama akan
 * membuat id dan kode tertukar tanpa ada yang menolak.
 *
 * Kuncinya nama entitas sumbernya, sama seperti `optionsFrom` di registry.
 */
export type PilihanDariMaster = Record<string, Array<{ value: string; label: string }>>;

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
 *
 * Dirender lewat portal ke document.body. position:fixed mengacu pada
 * containing block terdekat, dan leluhur mana pun yang punya transform, filter,
 * atau perspective akan menjadi containing block itu — membuat panel terkurung
 * di dalam kotak leluhur alih-alih memenuhi layar. Portal melepaskannya dari
 * seluruh pohon DOM halaman sehingga masalah itu tidak bisa terjadi lagi,
 * termasuk oleh pembungkus yang ditambahkan di kemudian hari.
 */
export function MasterForm({
  def,
  entity,
  row,
  options,
  pilihanDariMaster,
  open,
  onClose,
}: {
  def: EntityDef;
  entity: MasterEntity;
  row?: (Record<string, unknown> & { id: number }) | null;
  options: RefOptions;
  pilihanDariMaster?: PilihanDariMaster;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveMasterAction, initial);
  /*
   * Pabrik yang sedang dipilih di formulir ini.
   *
   * Dipakai untuk menyaring dropdown referensi: lokasi, lini, dan part ada
   * satu salinan per pabrik dengan kode yang sama, jadi tanpa saringan "WP01"
   * muncul dua kali dan yang terpilih bisa milik pabrik lain. Server tetap
   * menolak referensi lintas pabrik — saringan ini supaya orang tidak sampai
   * ke penolakan itu.
   */
  const [plantId, setPlantId] = useState<string>(row?.plantId == null ? '' : String(row.plantId));
  const toast = useToast();
  const router = useRouter();
  const titleId = useId();
  // Portal hanya bisa dibuat setelah komponen hidup di browser; saat render
  // di server document belum ada.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Disetel ulang tiap kali panel dibuka untuk baris lain — bukan tiap render,
  // supaya pilihan pabrik yang sedang diubah orang tidak melompat balik.
  const rowId = row?.id;
  const rowPlantId = row?.plantId == null ? '' : String(row.plantId);
  useEffect(() => {
    if (open) setPlantId(rowPlantId);
  }, [open, rowId, rowPlantId]);

  useHasilAksi(state, (hasil) => {
    if (!hasil.ok) return;
    toast.ok(`${def.singular} tersimpan.`);
    onClose();
    router.refresh();
  });

  /*
   * Galat tingkat formulir (bukan per kolom) jadi toast.
   *
   * Panel ini bisa lebih tinggi dari layar — part punya 14 kolom. Banner di
   * atasnya luput saat orang menekan Simpan di bawah; toast tidak ikut
   * menggulir. Galat per kolom tetap di bawah kolomnya: di situlah diperbaiki.
   */
  /*
   * Satu hasil = satu toast.
   *
   * Dipicu perubahan objek `state`, bukan isi pesannya: dua kali Simpan dengan
   * galat yang sama harus tetap memberi tahu dua kali — kalau yang kedua diam,
   * orangnya mengira tombolnya tidak jalan.
   */
  useHasilAksi(state, (hasil) => {
    if (hasil.error && !hasil.fieldErrors) toast.galat(hasil.error, 'Tidak tersimpan');
  });

  // Esc menutup panel — jalan pintas yang diharapkan ada pada panel semacam ini.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Kunci gulir halaman selama panel terbuka, supaya latar tidak ikut bergeser
  // saat pengguna menggulir isi formulir.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isEdit = Boolean(row);

  if (!mounted) return null;

  return createPortal(
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
            className="absolute inset-0 cursor-default bg-black/30 backdrop-blur-[2px]"
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
                {def.fields.map((field) => (
                  <Field
                    key={field.name}
                    field={field}
                    value={row?.[field.name]}
                    options={saringPerPabrik(options[field.refEntity ?? ''] ?? [], plantId)}
                    dariMaster={
                      field.optionsFrom ? pilihanDariMaster?.[field.optionsFrom] : undefined
                    }
                    error={state.fieldErrors?.[field.name]}
                    tergantungPabrik={
                      field.kind === 'reference' &&
                      !plantId &&
                      (options[field.refEntity ?? ''] ?? []).some((o) => o.plantId != null)
                    }
                    onChange={field.name === 'plantId' ? setPlantId : undefined}
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
    </AnimatePresence>,
    document.body,
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

/**
 * Pemilih warna: kotak color picker + kolom hex yang bisa diketik.
 *
 * ── Kenapa dua-duanya, bukan picker saja ────────────────────────────────────
 *
 * Picker bawaan browser bagus untuk MEMILIH, tetapi tidak bisa ditempel. Warna
 * pabrik biasanya sudah ada kodenya di standar visual perusahaan, dan orang
 * yang memegang kode itu akan menempelnya — bukan mencari-cari nuansa yang
 * sama di roda warna. Keduanya menulis ke satu nilai, jadi mengubah salah satu
 * langsung terlihat di yang lain.
 *
 * Nilai yang dikirim ke server datang dari kolom teks (yang tersembunyi dari
 * sisi picker), karena di situlah bentuk `#RRGGBB` dijaga — picker selalu
 * mengirim bentuk itu, ketikan orang belum tentu.
 */
function PilihWarna({ id, name, awal }: { id: string; name: string; awal: string }) {
  const [warna, setWarna] = useState(awal);
  const sah = /^#[0-9a-fA-F]{6}$/.test(warna);

  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="color"
        aria-label="Pilih warna"
        value={sah ? warna : '#DC2626'}
        onChange={(e) => setWarna(e.target.value.toUpperCase())}
        className="size-11 shrink-0 cursor-pointer rounded-2xl border border-line bg-surface p-1"
      />
      <input
        type="text"
        name={name}
        value={warna}
        onChange={(e) => setWarna(e.target.value.toUpperCase())}
        placeholder="#DC2626"
        spellCheck={false}
        className={cn(inputClass, 'tabular flex-1 uppercase')}
      />
      {/* Contoh tombolnya, bukan sekadar kotak warna: yang ingin dilihat orang
          adalah apakah TULISANNYA terbaca, dan itu hanya terlihat kalau
          contohnya berbentuk tombol yang sebenarnya. */}
      <ContohTombol warna={sah ? warna : null} />
    </div>
  );
}

function ContohTombol({ warna }: { warna: string | null }) {
  const nada = nadaTombol(warna);
  return (
    <span
      aria-hidden
      className="inline-flex h-11 shrink-0 items-center rounded-2xl border px-4 text-[13px] font-bold uppercase tracking-wide"
      style={
        nada ? { backgroundColor: nada.bg, borderColor: nada.border, color: nada.teks } : undefined
      }
    >
      Contoh
    </span>
  );
}

/**
 * Pilihan yang boleh ditawarkan untuk pabrik yang sedang dipilih.
 *
 * Pilihan tanpa pabrik (customer, supplier) selalu lolos. Kalau pabrik belum
 * dipilih, semuanya lolos — dropdown-nya dinonaktifkan oleh pemanggil, jadi
 * tidak ada yang bisa memilih dari daftar campuran itu.
 */
function saringPerPabrik(options: RefOption[], plantId: string): RefOption[] {
  if (!plantId) return options;
  const id = Number(plantId);
  return options.filter((o) => o.plantId == null || o.plantId === id);
}

function Field({
  field,
  value,
  options,
  dariMaster,
  error,
  tergantungPabrik = false,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  options: RefOption[];
  /** Pilihan untuk kolom `optionsFrom`; kosong berarti kolomnya bukan jenis itu. */
  dariMaster?: Array<{ value: string; label: string }>;
  error?: string;
  /** Pilihannya per pabrik tetapi pabrik belum dipilih — kunci dulu. */
  tergantungPabrik?: boolean;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const [checked, setChecked] = useState(
    value === undefined ? Boolean(field.defaultValue) : Boolean(value),
  );

  if (field.kind === 'image') {
    return (
      <BidangGambar
        name={field.name}
        label={field.label}
        hint={field.hint}
        nilaiAwal={value === undefined || value === null ? null : String(value)}
        error={error}
      />
    );
  }

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
          {/* Kolom `optionsFrom` tidak punya daftar tetap di registry: daftarnya
              diambil dari master sumbernya dan diteruskan ke sini. Tanpa ini
              dropdown-nya hanya berisi "— pilih —". */}
          {(
            dariMaster ??
            (field.options ?? []).map((o) => ({ value: o, label: field.optionLabels?.[o] ?? o }))
          ).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.kind === 'color' ? (
        <PilihWarna
          id={id}
          name={field.name}
          awal={
            value === undefined || value === null || value === ''
              ? ((field.defaultValue as string | undefined) ?? '#DC2626')
              : String(value)
          }
        />
      ) : field.kind === 'reference' ? (
        <select
          id={id}
          name={field.name}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          disabled={tergantungPabrik}
          className={cn(inputClass, 'disabled:opacity-60')}
        >
          <option value="">{tergantungPabrik ? '— pilih pabrik dulu —' : '— pilih —'}</option>
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
