'use client';

import { useState, useRef, useEffect } from 'react';
import { ScanLine, AlertCircle, Loader2, UserRound } from 'lucide-react';
import type { StationSummary } from '@avicenna/contracts';
import { bukaLiniAction } from '@/app/(station)/scan/proses/[grup]/actions';
import { ScanStation } from './scan-station';
import { cn } from '../ui/cn';

interface Lini {
  id: number;
  code: string;
  name: string;
  processType: string;
  plantCode: string | null;
}

/**
 * Layar scan satu grup proses: pilih lini dulu, baru scan part.
 *
 * ── Kenapa lini discan, bukan dipilih dari daftar ───────────────────────────
 *
 * Operator berdiri di depan satu lini dan barcodenya tertempel di situ.
 * Memilih dari daftar menuntut membaca dan mengetuk — dan salah ketuk berarti
 * seluruh hasil produksi satu shift tercatat di lini yang keliru, tanpa ada
 * yang menyadarinya sampai laporan harian dibandingkan.
 *
 * Daftar tetap disediakan sebagai jalan keluar saat barcode lininya rusak.
 */
export function StasiunProses({
  grup,
  label,
  lines,
  operator,
}: {
  grup: string;
  label: string;
  lines: Lini[];
  /**
   * Nama yang sedang masuk, dari server.
   *
   * Ditampilkan karena layar stasiun tidak punya sidebar: tanpa ini, serah
   * terima operator tidak meninggalkan satu pun tanda di layar — yang baru
   * tidak bisa memastikan kartunya diterima, dan yang lama tidak bisa melihat
   * bahwa ia sudah keluar.
   */
  operator: string;
}) {
  const [summary, setSummary] = useState<StationSummary | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [kode, setKode] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // Fokus dikembalikan ke kotak scan setiap saat: scanner mengetik seperti
  // papan ketik, dan fokus yang lepas membuat scan hilang tanpa jejak.
  useEffect(() => {
    if (!summary) input.current?.focus();
  }, [summary]);


  async function buka(c: string) {
    const bersih = c.trim();
    if (!bersih || sibuk) return;
    setSibuk(true);
    setGalat(null);
    const hasil = await bukaLiniAction(grup, bersih);
    setSibuk(false);
    setKode('');
    if ('error' in hasil) {
      setGalat(hasil.error);
      input.current?.focus();
      return;
    }
    setSummary(hasil.summary);
  }

  if (summary) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-[13px]">
          <span className="text-ink-muted">
            {label} · <span className="font-semibold text-ink">{summary.line.name}</span>{' '}
            ({summary.line.code})
          </span>
          <span className="flex items-center gap-2 text-ink-muted">
            <UserRound className="size-4" strokeWidth={1.8} aria-hidden />
            <span className="font-semibold text-ink">{operator}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setSummary(null);
              setGalat(null);
            }}
            className="rounded-md border border-line px-3 py-1 font-semibold transition-colors hover:border-ink"
          >
            Ganti lini
          </button>
        </div>
        <ScanStation summary={summary} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <ScanLine className="mx-auto size-10 text-accent" strokeWidth={1.6} aria-hidden />
          <h1 className="mt-3 text-[26px] font-extrabold tracking-tight">Scan barcode lini</h1>
          <p className="mt-1 text-[15px] text-ink-muted">
            Proses {label}. Scan barcode yang tertempel di lini tempat Anda berdiri.
          </p>
          {/* Nama disebut juga di layar ini, bukan hanya setelah lini terbuka:
              operator yang baru men-scan kartunya perlu tahu kartunya diterima
              sebelum ia menyentuh apa pun yang lain. */}
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-ink-muted">
            <UserRound className="size-4" strokeWidth={1.8} aria-hidden />
            Masuk sebagai <span className="font-semibold text-ink">{operator}</span>
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void buka(kode);
          }}
        >
          <input
            id="kode-lini"
            ref={input}
            value={kode}
            onChange={(e) => setKode(e.target.value)}
            disabled={sibuk}
            autoComplete="off"
            placeholder="mis. DCAA01"
            className={cn(
              'w-full rounded-card border-2 bg-card px-4 py-4 text-center text-[22px] font-bold tracking-wider outline-none',
              galat ? 'border-ng' : 'border-line focus-visible:border-ink',
            )}
          />
        </form>

        {sibuk ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-[14px] text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> memeriksa lini…
          </p>
        ) : null}

        {galat ? (
          <p className="mt-3 flex items-start gap-2 rounded-card border border-ng/40 bg-ng/10 px-4 py-3 text-[15px] text-ng">
            <AlertCircle className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden />
            <span>{galat}</span>
          </p>
        ) : null}

        {/* Jalan keluar saat barcode lininya rusak. Sengaja tidak menonjol:
            yang benar adalah men-scan, bukan memilih. */}
        {lines.length > 0 ? (
          <details className="mt-8">
            <summary className="cursor-pointer text-[14px] text-ink-muted">
              Barcode lini rusak? Pilih dari daftar
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {lines.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => void buka(l.code)}
                  disabled={sibuk}
                  className="flex items-center justify-between rounded-card border border-line px-4 py-3 text-left transition-colors hover:border-ink"
                >
                  <span>
                    <span className="font-semibold">{l.name}</span>
                    <span className="ml-2 text-[13px] text-ink-muted">{l.code}</span>
                  </span>
                  <span className="text-[12px] text-ink-muted">{l.processType}</span>
                </button>
              ))}
            </div>
          </details>
        ) : (
          <p className="mt-8 text-center text-[14px] text-ink-muted">
            Belum ada lini {label} yang aktif di pabrik Anda.
          </p>
        )}
      </div>
    </div>
  );
}
