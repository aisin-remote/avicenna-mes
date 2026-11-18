'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from './cn';

export interface PilihanCari {
  value: string;
  label: string;
  /** Teks redup di bawah label; ikut dicari. */
  keterangan?: string;
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
  className,
}: {
  name: string;
  pilihan: PilihanCari[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
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
  const tersaring = useMemo(() => {
    const potongan = kata.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!potongan.length) return pilihan;
    return pilihan.filter((p) => {
      const teks = `${p.label} ${p.keterangan ?? ''}`.toLowerCase();
      return potongan.every((k) => teks.includes(k));
    });
  }, [pilihan, kata]);

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
        onClick={() => (buka ? setBuka(false) : bukaDaftar())}
        onKeyDown={(e) => {
          if (!buka && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            bukaDaftar();
          }
        }}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-2xl border bg-card px-3 text-left text-[14px] outline-none',
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
