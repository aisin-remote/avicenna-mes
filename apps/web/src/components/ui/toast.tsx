'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { springSoft } from '../motion/transitions';
import { cn } from './cn';

/**
 * ─── Toast: pemberitahuan yang selalu terlihat ──────────────────────────────
 *
 * Menggantikan banner yang ditempel di atas halaman. Banner itu punya satu
 * cacat yang baru terasa di lapangan: tabel master dan matriks rute panjang,
 * orang menekan tombol di baris ke-40, dan pesan "gagal" muncul 2.000 piksel
 * di atas — tidak pernah terbaca, dan orangnya mengira tombolnya tidak jalan.
 *
 * Toast diposisikan tetap di pojok kanan bawah, tidak ikut menggulir.
 *
 * ── Yang TIDAK memakai ini ──────────────────────────────────────────────────
 *
 *   galat per kolom formulir   tetap di bawah kolomnya — di situlah diperbaiki
 *   panel status layar stasiun tetap besar di tengah — dibaca dari jarak
 *                              beberapa meter, dan toast kecil di pojok justru
 *                              luput dari mata operator
 */

export type NadaToast = 'ok' | 'galat' | 'warn' | 'info';

interface Toast {
  id: number;
  nada: NadaToast;
  judul?: string;
  pesan: string;
  /** Milidetik sebelum hilang sendiri. 0 = menetap sampai ditutup. */
  lama: number;
}

interface IsiKonteks {
  tampilkan: (t: Omit<Toast, 'id'>) => void;
  tutup: (id: number) => void;
}

const KonteksToast = createContext<IsiKonteks | null>(null);

/*
 * Galat bertahan dua kali lebih lama daripada kabar baik.
 *
 * Kabar baik cukup dilihat sekilas; galat harus sempat DIBACA — pesannya
 * menyebut sebab dan tindakan, dan itu butuh waktu. Galat juga selalu punya
 * tombol tutup, jadi yang membacanya cepat tidak perlu menunggu.
 */
const LAMA: Record<NadaToast, number> = { ok: 4000, info: 5000, warn: 7000, galat: 9000 };
const MAKS_TAMPIL = 4;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [daftar, setDaftar] = useState<Toast[]>([]);
  const urut = useRef(0);

  const tutup = useCallback((id: number) => {
    setDaftar((d) => d.filter((t) => t.id !== id));
  }, []);

  const tampilkan = useCallback((t: Omit<Toast, 'id'>) => {
    urut.current += 1;
    const id = urut.current;
    setDaftar((d) => {
      /*
       * Pesan yang sama persis tidak ditumpuk.
       *
       * Menekan tombol yang gagal tiga kali menghasilkan tiga toast identik —
       * tidak menambah informasi, hanya menutupi layar. Yang lama dibuang,
       * yang baru masuk supaya penghitung waktunya mulai dari awal.
       */
      const tanpaKembar = d.filter((x) => !(x.nada === t.nada && x.pesan === t.pesan));
      // Yang paling lama tergeser keluar bila melewati batas tampil.
      return [...tanpaKembar, { ...t, id }].slice(-MAKS_TAMPIL);
    });
  }, []);

  const nilai = useMemo(() => ({ tampilkan, tutup }), [tampilkan, tutup]);

  return (
    <KonteksToast.Provider value={nilai}>
      {children}
      <WadahToast daftar={daftar} tutup={tutup} />
    </KonteksToast.Provider>
  );
}

/**
 * Cara memanggilnya dari komponen:
 *
 *   const toast = useToast();
 *   toast.ok('Tersimpan');
 *   toast.galat(hasil.error);
 */
export function useToast() {
  const ctx = useContext(KonteksToast);
  if (!ctx) {
    throw new Error('useToast dipanggil di luar ToastProvider — pasang di layout akar.');
  }
  const { tampilkan } = ctx;
  return useMemo(
    () => ({
      ok: (pesan: string, judul?: string) => tampilkan({ nada: 'ok', pesan, judul, lama: LAMA.ok }),
      galat: (pesan: string, judul?: string) =>
        tampilkan({ nada: 'galat', pesan, judul, lama: LAMA.galat }),
      warn: (pesan: string, judul?: string) =>
        tampilkan({ nada: 'warn', pesan, judul, lama: LAMA.warn }),
      info: (pesan: string, judul?: string) =>
        tampilkan({ nada: 'info', pesan, judul, lama: LAMA.info }),
    }),
    [tampilkan],
  );
}

const IKON: Record<NadaToast, typeof CheckCircle2> = {
  ok: CheckCircle2,
  galat: XCircle,
  warn: AlertTriangle,
  info: Info,
};

const WARNA: Record<NadaToast, string> = {
  ok: 'border-ok/40 text-ok',
  galat: 'border-ng/40 text-ng',
  warn: 'border-warn/40 text-warn',
  info: 'border-line text-ink',
};

function WadahToast({ daftar, tutup }: { daftar: Toast[]; tutup: (id: number) => void }) {
  return (
    /*
     * Pojok kanan bawah, tidak ikut menggulir, di atas segala lapisan lain.
     * Lebar dibatasi supaya di ponsel tidak menutupi seluruh layar.
     */
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <AnimatePresence initial={false}>
        {daftar.map((t) => (
          <SatuToast key={t.id} toast={t} onTutup={() => tutup(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function SatuToast({ toast, onTutup }: { toast: Toast; onTutup: () => void }) {
  const Ikon = IKON[toast.nada];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sisa = useRef(toast.lama);
  const mulai = useRef(0);

  /*
   * Hitung mundur berhenti saat kursor di atasnya.
   *
   * Orang yang sedang membaca pesan galat panjang tidak boleh kehilangan
   * pesannya di tengah kalimat. Sisa waktunya disimpan, dilanjutkan saat kursor
   * pergi — bukan diulang dari awal.
   */
  const jalan = useCallback(() => {
    if (sisa.current <= 0) return;
    mulai.current = Date.now();
    timer.current = setTimeout(onTutup, sisa.current);
  }, [onTutup]);

  const jeda = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    sisa.current -= Date.now() - mulai.current;
  }, []);

  useEffect(() => {
    if (toast.lama > 0) jalan();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jalan, toast.lama]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={springSoft}
      onMouseEnter={jeda}
      onMouseLeave={jalan}
      // Galat diumumkan langsung oleh pembaca layar; yang lain menunggu giliran.
      role={toast.nada === 'galat' ? 'alert' : 'status'}
      aria-live={toast.nada === 'galat' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-card border bg-card px-4 py-3 shadow-lift',
        WARNA[toast.nada],
      )}
    >
      <Ikon className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden />
      <div className="min-w-0 flex-1 text-ink">
        {toast.judul ? (
          <div className="text-[14px] font-bold leading-tight">{toast.judul}</div>
        ) : null}
        <div className={cn('text-[14px] leading-snug', toast.judul && 'mt-0.5 text-ink-soft')}>
          {toast.pesan}
        </div>
      </div>
      <button
        type="button"
        onClick={onTutup}
        aria-label="Tutup pemberitahuan"
        className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
      >
        <X className="size-4" strokeWidth={2} aria-hidden />
      </button>
    </motion.div>
  );
}
