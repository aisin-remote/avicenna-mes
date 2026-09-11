'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sun, Moon, Monitor, PanelLeft, Volume2, RotateCcw } from 'lucide-react';
import {
  ACCENTS,
  ACCENT_LABELS,
  SIDEBAR_LABELS,
  SIDEBAR_MODES,
  THEMES,
  THEME_LABELS,
  type Theme,
} from '@/lib/preferences';
import { usePreferences } from './preferences-provider';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

const THEME_ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/** Contoh warna tiap aksen, untuk titik pratinjau di tombol pilihan. */
const ACCENT_SWATCH: Record<string, string> = {
  hitam: '#111110',
  biru: '#1d4ed8',
  hijau: '#15803d',
  jingga: '#c2410c',
  ungu: '#6d28d9',
};

/**
 * Panel pengaturan tampilan.
 *
 * Digeser masuk dari kanan sebagai lapisan terpisah lewat portal ke
 * document.body. Kerangka aplikasi memakai `overflow-hidden` supaya hanya area
 * isi yang menggulir, dan panel yang dirender di dalamnya akan ikut terpotong.
 *
 * Perubahan berlaku SEKETIKA, tanpa tombol simpan. Pengaturan tampilan adalah
 * hal yang dinilai dengan mata: menyembunyikan hasilnya di balik satu tombol
 * lagi memaksa orang menebak-nebak.
 */
export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, set, reset } = usePreferences();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Portal hanya bisa dipasang setelah ada document — render pertama di server
  // tidak menghasilkan apa pun, dan itu memang yang diinginkan.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[60]">
          <motion.button
            type="button"
            aria-label="Tutup pengaturan"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="absolute inset-0 cursor-default bg-black/40"
          />

          <motion.aside
            role="dialog"
            aria-label="Pengaturan tampilan"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: durations.slow, ease: easeSoft }}
            className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-shell shadow-shell"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-line px-6 py-5">
              <div>
                <h2 className="text-[17px] font-extrabold tracking-tight">Pengaturan tampilan</h2>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  Berlaku untuk perangkat ini saja
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup pengaturan"
                className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink"
              >
                <X className="size-[18px]" strokeWidth={2} aria-hidden />
              </button>
            </header>

            <div className="scroll-slim flex-1 overflow-y-auto px-6 py-6">
              <Section title="Tema" hint="Mode gelap membantu di ruang kendali yang lampunya redup.">
                <div className="grid grid-cols-3 gap-2">
                  {THEMES.map((t) => {
                    const Icon = THEME_ICONS[t];
                    return (
                      <Choice
                        key={t}
                        active={prefs.theme === t}
                        onClick={() => set('theme', t)}
                        className="flex-col gap-2 py-4"
                      >
                        <Icon className="size-5" strokeWidth={1.8} aria-hidden />
                        <span className="text-[13px] font-semibold">{THEME_LABELS[t]}</span>
                      </Choice>
                    );
                  })}
                </div>
              </Section>

              <Section
                title="Warna aksen"
                hint="Dipakai untuk tombol utama dan penanda menu yang sedang aktif."
              >
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((a) => (
                    <Choice
                      key={a}
                      active={prefs.accent === a}
                      onClick={() => set('accent', a)}
                      className="gap-2.5 px-4 py-2.5"
                    >
                      <span
                        className="size-4 shrink-0 rounded-full ring-1 ring-black/10"
                        style={{ background: ACCENT_SWATCH[a] }}
                        aria-hidden
                      />
                      <span className="text-[13px] font-semibold">{ACCENT_LABELS[a]}</span>
                    </Choice>
                  ))}
                </div>
              </Section>

              <Section
                title="Menu samping"
                hint="Mode ikon saja memberi ruang lebih untuk tabel yang kolomnya banyak."
              >
                <div className="grid grid-cols-2 gap-2">
                  {SIDEBAR_MODES.map((m) => (
                    <Choice
                      key={m}
                      active={prefs.sidebar === m}
                      onClick={() => set('sidebar', m)}
                      className="gap-2.5 px-4 py-3"
                    >
                      <PanelLeft className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
                      <span className="text-[13px] font-semibold">{SIDEBAR_LABELS[m]}</span>
                    </Choice>
                  ))}
                </div>
              </Section>

              <Section
                title="Suara scan"
                hint="Nada pendek setiap kali barcode discan — operator sering tidak menatap layar."
              >
                <button
                  type="button"
                  onClick={() => set('scanSound', !prefs.scanSound)}
                  role="switch"
                  aria-checked={prefs.scanSound}
                  className="flex w-full items-center justify-between rounded-2xl border border-line px-4 py-3.5 text-left transition-colors hover:border-line-strong"
                >
                  <span className="flex items-center gap-3">
                    <Volume2 className="size-[18px] text-ink-muted" strokeWidth={1.8} aria-hidden />
                    <span className="text-[14px] font-semibold">
                      {prefs.scanSound ? 'Nyala' : 'Mati'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
                      prefs.scanSound ? 'bg-accent' : 'bg-line-strong',
                    )}
                    aria-hidden
                  >
                    <motion.span
                      layout
                      transition={{ duration: durations.fast, ease: easeSoft }}
                      className={cn(
                        'absolute top-0.5 size-5 rounded-full bg-white shadow-sm',
                        prefs.scanSound ? 'right-0.5' : 'left-0.5',
                      )}
                    />
                  </span>
                </button>
              </Section>
            </div>

            <footer className="shrink-0 border-t border-line px-6 py-4">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-ink hover:text-ink"
              >
                <RotateCcw className="size-4" strokeWidth={1.9} aria-hidden />
                Kembalikan ke bawaan
              </button>
            </footer>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7 last:mb-0">
      <h3 className="text-[14px] font-bold">{title}</h3>
      <p className="mb-3 mt-0.5 text-[12.5px] leading-snug text-ink-muted">{hint}</p>
      {children}
    </section>
  );
}

function Choice({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center justify-center rounded-2xl border transition-colors duration-200',
        active
          ? 'border-ink bg-surface text-ink'
          : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}
