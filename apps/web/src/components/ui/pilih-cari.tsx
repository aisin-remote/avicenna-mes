'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from './cn';

export interface PilihanCari {
  value: string;
  label: string;
  /** Teks redup di bawah label; ikut dicari. */
  keterangan?: string;
  /** Label pendek untuk chip di PilihCariBanyak; kosong = label. */
  ringkas?: string;
}

/**
 * Dropdown dengan kotak pencarian, seperti select2.
 *
 * Nilainya dikirim lewat input bernama `name`, jadi bisa dipakai di dalam
 * formulir biasa atau `next/form` tanpa state di luar komponen. Input itu
 * tetap ikut validasi `required`; saat formulir ditolak karena kosong, daftar
 * dibuka supaya jelas apa yang harus dipilih.
 */
export function PilihCari({
  name,
  pilihan,
  defaultValue = '',
  placeholder = '— pilih —',
  required,
  disabled,
  className,
}: {
  name: string;
  pilihan: PilihanCari[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [nilai, setNilai] = useState(defaultValue);
  const [buka, setBuka] = useState(false);
  const [kata, setKata] = useState('');
  const [sorot, setSorot] = useState(0);
  const akar = useRef<HTMLDivElement>(null);
  const kotakCari = useRef<HTMLInputElement>(null);
  const daftar = useRef<HTMLUListElement>(null);
  const idDaftar = useId();

  const terpilih = pilihan.find((p) => p.value === nilai);
  const tersaring = useMemo(() => saring(pilihan, kata), [pilihan, kata]);

  useEffect(() => {
    if (!buka) return;
    const tutupDiLuar = (e: PointerEvent) => {
      if (!akar.current?.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('pointerdown', tutupDiLuar);
    return () => document.removeEventListener('pointerdown', tutupDiLuar);
  }, [buka]);

  useEffect(() => {
    daftar.current?.querySelector<HTMLElement>(`[data-i="${sorot}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sorot, buka]);

  function bukaDaftar() {
    setKata('');
    setSorot(Math.max(0, pilihan.findIndex((p) => p.value === nilai)));
    setBuka(true);
    requestAnimationFrame(() => kotakCari.current?.focus());
  }

  function pilih(p: PilihanCari) {
    setNilai(p.value);
    setBuka(false);
  }

  function tombolCari(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSorot((i) => Math.min(i + 1, tersaring.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSorot((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = tersaring[sorot];
      if (p) pilih(p);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBuka(false);
    }
  }

  return (
    <div ref={akar} className={cn('relative', className)}>
      <input
        name={name}
        value={nilai}
        required={required}
        onChange={() => {}}
        onInvalid={(e) => {
          e.preventDefault();
          bukaDaftar();
        }}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
      <button
        type="button"
        role="combobox"
        aria-expanded={buka}
        aria-controls={idDaftar}
        disabled={disabled}
        onClick={() => (buka ? setBuka(false) : bukaDaftar())}
        onKeyDown={(e) => {
          if (!buka && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            bukaDaftar();
          }
        }}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-2xl border bg-card px-3 text-left text-[14px] outline-none disabled:opacity-60',
          buka ? 'border-ink' : 'border-line focus:border-ink',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !terpilih && 'text-ink-muted')}>
          {terpilih ? terpilih.label : placeholder}
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
      </button>

      {buka ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
            <input
              ref={kotakCari}
              value={kata}
              onChange={(e) => {
                setKata(e.target.value);
                setSorot(0);
              }}
              onKeyDown={tombolCari}
              placeholder="Cari nomor part, back number, atau nama"
              aria-autocomplete="list"
              aria-controls={idDaftar}
              className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            />
          </div>
          <ul ref={daftar} id={idDaftar} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {tersaring.length === 0 ? (
              <li className="px-3 py-2.5 text-[13px] text-ink-muted">Tidak ada yang cocok.</li>
            ) : (
              tersaring.map((p, i) => (
                <li
                  key={p.value}
                  data-i={i}
                  role="option"
                  aria-selected={p.value === nilai}
                  onPointerEnter={() => setSorot(i)}
                  onClick={() => pilih(p)}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 px-3 py-2 text-[14px]',
                    i === sorot && 'bg-surface',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.label}</span>
                    {p.keterangan ? (
                      <span className="block truncate text-[12px] text-ink-muted">{p.keterangan}</span>
                    ) : null}
                  </span>
                  {p.value === nilai ? (
                    <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Pencocokan kata per kata: "kpj9 handle" menemukan "42312014170AA7 (KPJ9) — HANDLE…". */
function saring(pilihan: PilihanCari[], kata: string): PilihanCari[] {
  const potongan = kata.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!potongan.length) return pilihan;
  return pilihan.filter((p) => {
    const teks = `${p.label} ${p.keterangan ?? ''}`.toLowerCase();
    return potongan.every((k) => teks.includes(k));
  });
}

/**
 * Versi PilihCari yang bisa memilih banyak, seperti select2 `multiple`.
 *
 * Tiap nilai terpilih dikirim sebagai input `name` tersendiri (dibaca dengan
 * `formData.getAll(name)`), ditambah `labelName` berisi labelnya pada urutan
 * yang sama — supaya pesan gagal di server bisa menyebut part-nya, bukan id.
 *
 * Daftar tetap terbuka setelah memilih: orang yang memasukkan delapan part
 * anggota mold mengetik, Enter, mengetik lagi — tanpa membuka ulang daftarnya.
 */
export function PilihCariBanyak({
  name,
  labelName,
  pilihan,
  defaultValue = [],
  placeholder = '— pilih —',
  required,
  disabled,
  className,
}: {
  name: string;
  labelName?: string;
  pilihan: PilihanCari[];
  defaultValue?: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [nilai, setNilai] = useState<string[]>(defaultValue);
  const [buka, setBuka] = useState(false);
  const [kata, setKata] = useState('');
  const [sorot, setSorot] = useState(0);
  const akar = useRef<HTMLDivElement>(null);
  const kotakCari = useRef<HTMLInputElement>(null);
  const daftar = useRef<HTMLUListElement>(null);
  const idDaftar = useId();

  const petaPilihan = useMemo(() => new Map(pilihan.map((p) => [p.value, p])), [pilihan]);
  const terpilih = nilai.map((v) => petaPilihan.get(v)).filter((p): p is PilihanCari => !!p);
  const tersaring = useMemo(() => saring(pilihan, kata), [pilihan, kata]);

  useEffect(() => {
    if (!buka) return;
    const tutupDiLuar = (e: PointerEvent) => {
      if (!akar.current?.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('pointerdown', tutupDiLuar);
    return () => document.removeEventListener('pointerdown', tutupDiLuar);
  }, [buka]);

  useEffect(() => {
    daftar.current?.querySelector<HTMLElement>(`[data-i="${sorot}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sorot, buka]);

  function bukaDaftar() {
    setKata('');
    setSorot(0);
    setBuka(true);
    requestAnimationFrame(() => kotakCari.current?.focus());
  }

  function balik(p: PilihanCari) {
    setNilai((n) => (n.includes(p.value) ? n.filter((v) => v !== p.value) : [...n, p.value]));
    // Kata dibiarkan: orang biasanya memilih beberapa hasil dari satu pencarian.
    requestAnimationFrame(() => kotakCari.current?.focus());
  }

  function tombolCari(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSorot((i) => Math.min(i + 1, tersaring.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSorot((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const p = tersaring[sorot];
      if (p) balik(p);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBuka(false);
    } else if (e.key === 'Backspace' && kata === '' && nilai.length > 0) {
      setNilai((n) => n.slice(0, -1));
    }
  }

  return (
    <div ref={akar} className={cn('relative', className)}>
      {terpilih.map((p) => (
        <span key={p.value} hidden>
          <input type="hidden" name={name} value={p.value} />
          {labelName ? <input type="hidden" name={labelName} value={p.label} /> : null}
        </span>
      ))}
      {/* Penjaga `required`: input tersembunyi biasa tidak ikut validasi. */}
      <input
        value={nilai.length ? 'ada' : ''}
        required={required}
        onChange={() => {}}
        onInvalid={(e) => {
          e.preventDefault();
          bukaDaftar();
        }}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />

      <div
        role="combobox"
        aria-expanded={buka}
        aria-controls={idDaftar}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (disabled) return;
          if (!buka) bukaDaftar();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (!buka && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            bukaDaftar();
          }
        }}
        className={cn(
          'flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-2xl border bg-card px-2 py-1.5 text-left text-[14px] outline-none',
          buka ? 'border-ink' : 'border-line focus:border-ink',
          disabled && 'cursor-default opacity-60',
        )}
      >
        {terpilih.length === 0 ? (
          <span className="flex-1 px-1 text-ink-muted">{placeholder}</span>
        ) : (
          terpilih.map((p) => (
            <span
              key={p.value}
              className="inline-flex max-w-full items-center gap-1 rounded-xl bg-surface py-1 pl-2.5 pr-1 text-[13px]"
            >
              <span className="truncate" title={p.label}>
                {p.ringkas ?? p.label}
              </span>
              <button
                type="button"
                aria-label={`Hapus ${p.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setNilai((n) => n.filter((v) => v !== p.value));
                }}
                className="grid size-5 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-line hover:text-ink"
              >
                <X className="size-3" strokeWidth={2.4} aria-hidden />
              </button>
            </span>
          ))
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-1 text-ink-muted">
          {terpilih.length > 1 ? (
            <span className="tabular text-[12px]">{terpilih.length} dipilih</span>
          ) : null}
          <ChevronDown className="size-4" strokeWidth={2} aria-hidden />
        </span>
      </div>

      {buka ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
            <input
              ref={kotakCari}
              value={kata}
              onChange={(e) => {
                setKata(e.target.value);
                setSorot(0);
              }}
              onKeyDown={tombolCari}
              placeholder="Cari nomor part, back number, atau nama"
              aria-autocomplete="list"
              aria-controls={idDaftar}
              className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
            />
            {nilai.length > 0 ? (
              <button
                type="button"
                onClick={() => setNilai([])}
                className="shrink-0 text-[12.5px] font-semibold text-ink-muted hover:text-ink"
              >
                Kosongkan
              </button>
            ) : null}
          </div>
          <ul
            ref={daftar}
            id={idDaftar}
            role="listbox"
            aria-multiselectable
            className="max-h-72 overflow-y-auto py-1"
          >
            {tersaring.length === 0 ? (
              <li className="px-3 py-2.5 text-[13px] text-ink-muted">Tidak ada yang cocok.</li>
            ) : (
              tersaring.map((p, i) => {
                const dipilih = nilai.includes(p.value);
                return (
                  <li
                    key={p.value}
                    data-i={i}
                    role="option"
                    aria-selected={dipilih}
                    onPointerEnter={() => setSorot(i)}
                    onClick={() => balik(p)}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 px-3 py-2 text-[14px]',
                      i === sorot && 'bg-surface',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border',
                        dipilih ? 'border-ink bg-ink text-card' : 'border-line-strong',
                      )}
                    >
                      {dipilih ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.label}</span>
                      {p.keterangan ? (
                        <span className="block truncate text-[12px] text-ink-muted">{p.keterangan}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
