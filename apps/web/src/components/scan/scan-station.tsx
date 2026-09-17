'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ScanLine, CheckCircle2, XCircle, CopyX, Volume2, VolumeX, AlertTriangle, LogOut,
} from 'lucide-react';
import type { StationResult, StationSummary, ProcessType } from '@avicenna/contracts';
import { grupProses, sepertiKartuLogin } from '@avicenna/domain';
import { submitScanAction } from '@/app/(app)/scan/actions';
import { keluarStasiunAction } from '@/app/(station)/scan/proses/[grup]/actions';
import { NgInline } from './ng-inline';
import { useScanSound } from './use-scan-sound';
import { usePreferences } from '../shell/preferences-provider';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

type Row = StationSummary['recent'][number];

const MAX_RECENT = 12;

/**
 * Layar stasiun scan untuk operator.
 *
 * Tata letaknya mengikuti layar avicenna yang sudah dipakai bertahun-tahun:
 * input di kiri, status besar di tengah, penghitung di kanan, riwayat di bawah.
 * Menjaga susunan itu disengaja — operator sudah hafal di mana harus melihat,
 * dan mengubahnya berarti melatih ulang orang tanpa alasan yang cukup.
 *
 * Tiga hal yang menentukan layar ini berguna atau tidak:
 *  1. Fokus HARUS selalu kembali ke input. Scanner barcode mengetik lalu
 *     menekan Enter; kalau fokus lepas, scan berikutnya hilang tanpa jejak.
 *  2. Status harus terbaca dari jarak beberapa meter.
 *  3. Hasilnya harus terdengar, karena operator sering tidak menatap layar.
 */
export function ScanStation({ summary }: { summary: StationSummary }) {
  /*
   * OK dan NG dalam SATU layar, bukan dua halaman.
   *
   * Lininya sudah dipilih dan tersimpan di layar ini. Halaman NG terpisah harus
   * mengetahui lini itu lagi — sistem lama menitipkannya di localStorage
   * (`avi_line_number`), dan nilai basi di situ membuat NG tercatat di lini yang
   * sudah ditinggalkan operator, tanpa satu pun tanda di layar.
   */
  const [mode, setMode] = useState<'OK' | 'NG'>('OK');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<StationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(summary.counterToday);
  const [recent, setRecent] = useState<Row[]>(summary.recent.slice(0, MAX_RECENT));
  const [busy, setBusy] = useState(false);
  // Diawali dari preferensi tersimpan, lalu masih bisa dimatikan sesaat dari
  // layar ini tanpa mengubah pengaturan perangkat.
  const { prefs } = usePreferences();
  const [soundOn, setSoundOn] = useState(prefs.scanSound);


  /*
   * Preferensi tersimpan baru terbaca setelah komponen terpasang — membaca
   * localStorage saat render akan membuat hasil render server dan klien
   * berbeda. Nilai awal useState karena itu selalu bawaan, dan efek inilah
   * yang menyusulkan pilihan yang sebenarnya.
   */
  useEffect(() => {
    setSoundOn(prefs.scanSound);
  }, [prefs.scanSound]);

  /** Grup proses lini ini — dipakai layar NG dan serah terima operator. */
  const grup = grupProses(summary.line.processType as ProcessType);

  const inputRef = useRef<HTMLInputElement>(null);
  const sound = useScanSound(soundOn);
  const seq = useRef(0);
  /** Sedang keluar karena kartu login discan — layar berpindah ke halaman login. */
  const [sedangKeluar, setKeluar] = useState(false);

  /** Mengembalikan fokus ke input — dipanggil setelah setiap kejadian apa pun. */
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (mode === 'OK') focusInput();
  }, [focusInput, mode]);

  /*
   * Kembalikan fokus setiap kali proses pengiriman selesai.
   *
   * Memanggil focusInput() langsung setelah setBusy(false) tidak cukup:
   * setState bersifat asinkron, jadi saat fokus dipanggil komponen belum
   * dirender ulang. Efek ini berjalan SETELAH render, ketika input sudah siap.
   *
   * Input juga sengaja tidak pernah di-disable. Elemen yang dinonaktifkan
   * kehilangan fokus, dan scan berikutnya akan hilang tanpa jejak — kegagalan
   * paling mahal di layar ini karena operator tidak menyadarinya.
   */
  useEffect(() => {
    if (!busy && mode === 'OK') focusInput();
  }, [busy, focusInput, mode]);

  // Klik di mana pun pada layar mengembalikan fokus. Operator sering tidak
  // sengaja menyentuh area lain, dan tanpa ini scan berikutnya hilang diam-diam.
  useEffect(() => {
    /*
     * Hanya berlaku di mode OK. Tanpa penjagaan ini, kotak scan di sini akan
     * merebut fokus dari kotak scan layar NG setiap kali operator menyentuh
     * layar — dan scan NG berikutnya hilang tanpa jejak.
     */
    if (mode !== 'OK') return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('input')) return;
      // Ditunda satu tick agar tidak berebut dengan fokus bawaan browser.
      setTimeout(focusInput, 0);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [focusInput, mode]);

  async function submit(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;

    /*
     * Kartu login discan ke kotak yang sama, bukan ke tombol tersendiri.
     *
     * Di tengah pergantian shift, langkah tambahan adalah langkah yang
     * dilewati — dan hasil produksi operator berikutnya tercatat atas nama orang
     * yang sudah pulang. Men-scan kartu mengakhiri sesi ini; yang berikutnya
     * masuk di halaman login.
     *
     * Penyaringnya ketat (lihat sepertiKartuLogin): kartu kanban dan barcode
     * part berpemisah tidak ikut tersaring ke sini, karena tersaring berarti
     * operator dikeluarkan di tengah shift oleh barcode barang biasa.
     */
    if (sepertiKartuLogin(value)) {
      void keluar();
      return;
    }

    setBusy(true);
    setError(null);
    seq.current += 1;

    const res = await submitScanAction({
      rawCode: value,
      lineCode: summary.line.code,
      // Kunci idempoten: scanner kadang mengirim ulang saat jaringan tersendat.
      clientRef: `${summary.line.code}-${Date.now()}-${seq.current}`,
    });

    setCode('');
    setBusy(false);
    focusInput();

    if ('error' in res) {
      setError(res.error);
      setResult(null);
      sound.reject();
      return;
    }

    setResult(res);
    setCounter(res.counterToday);

    if (res.status === 'ACCEPTED') {
      sound.ok();
      setRecent((prev) =>
        [
          {
            id: Date.now(),
            kind: 'PRODUCTION',
            rawCode: res.rawCode,
            serialNumber: null,
            qty: res.qty,
            scannedAt: res.scannedAt,
            partNumber: res.partNumber,
            partName: res.partName,
          },
          ...prev,
        ].slice(0, MAX_RECENT),
      );
    } else {
      sound.reject();
    }
  }

  /**
   * Mengakhiri sesi karena ada yang men-scan kartu login.
   *
   * Kartunya sendiri TIDAK dikirim ke mana pun — yang dilakukan hanya keluar.
   * Orang berikutnya men-scan kartunya lagi di halaman login, tempat kredensial
   * memang diperiksa.
   */
  async function keluar() {
    setBusy(true);
    setError(null);
    setResult(null);
    setKeluar(true);
    sound.ok();

    /*
     * Aksi ini berakhir dengan redirect ke halaman login, jadi tidak ada yang
     * perlu dikerjakan sesudahnya. `busy` sengaja dibiarkan menyala: layar
     * sedang berpindah, dan mengembalikan fokus ke kotak scan hanya membuka
     * peluang scan berikutnya terkirim ke sesi yang sudah berakhir.
     */
    await keluarStasiunAction();
  }

  const tone = !result
    ? 'idle'
    : result.status === 'ACCEPTED'
      ? 'ok'
      : result.status === 'DUPLICATE'
        ? 'dup'
        : 'bad';

  const tab = (
    <div className="flex gap-1.5" role="tablist" aria-label="Mode scan">
      <TabMode
        aktif={mode === 'OK'}
        onClick={() => setMode('OK')}
        label="Scan hasil OK"
        nada="ok"
      />
      <TabMode
        aktif={mode === 'NG'}
        onClick={() => setMode('NG')}
        label="Input NG"
        nada="ng"
        icon={AlertTriangle}
      />
    </div>
  );

  if (mode === 'NG') {
    return (
      <div className="space-y-5">
        {tab}
        <NgInline lineCode={summary.line.code} lineName={summary.line.name} grup={grup} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {tab}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,260px)]">
        {/* ── Input ─────────────────────────────────────────────────────── */}
        <section className="rounded-card border border-line bg-card p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Scan Part
          </h2>
          <p className="mt-2 text-[13px] leading-snug text-ink-muted">
            Arahkan barcode ke scanner. Hasilnya muncul besar di sebelah kanan.
          </p>
          {/* Disebutkan di layar, bukan disimpan sebagai pengetahuan orang
              dalam: operator berikutnya harus tahu kartunya discan ke kotak
              yang sama, bukan lewat tombol keluar. */}
          <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">
            Ganti shift? Scan kartu login di kotak ini untuk keluar, lalu masuk
            lagi di halaman login.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(code);
            }}
            className="mt-4"
          >
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Barcode part"
              placeholder="Fokus di sini lalu scan"
              className="tabular h-14 w-full rounded-2xl border-2 border-line bg-surface px-4 text-[18px] font-semibold outline-none transition-colors duration-200 placeholder:text-[15px] placeholder:font-normal placeholder:text-ink-muted focus:border-ink focus:bg-card"
            />
          </form>

          <button
            type="button"
            onClick={() => {
              setSoundOn((v) => !v);
              focusInput();
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface"
          >
            {soundOn ? (
              <Volume2 className="size-4" strokeWidth={1.8} aria-hidden />
            ) : (
              <VolumeX className="size-4" strokeWidth={1.8} aria-hidden />
            )}
            Suara {soundOn ? 'aktif' : 'mati'}
          </button>
        </section>

        {/* ── Status besar ──────────────────────────────────────────────── */}
        <section
          id="scan-status"
          aria-live="assertive"
          className={cn(
            'flex min-h-[220px] flex-col items-center justify-center rounded-card border-2 p-6 text-center transition-colors duration-300',
            tone === 'idle' && 'border-line bg-card',
            tone === 'ok' && 'border-ok/30 bg-ok/8',
            tone === 'dup' && 'border-warn/30 bg-warn/8',
            tone === 'bad' && 'border-ng/30 bg-ng/8',
          )}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={`${sedangKeluar ? 'keluar' : (result?.rawCode ?? 'idle')}-${result?.status ?? ''}-${seq.current}`}
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={springSoft}
              className="flex flex-col items-center gap-3"
            >
              {sedangKeluar ? (
                <>
                  <LogOut className="size-12 text-ink-muted" strokeWidth={1.6} aria-hidden />
                  <div className="text-[26px] font-extrabold leading-tight">KELUAR</div>
                  <p className="max-w-md text-[15px] text-ink-soft">
                    Membuka halaman masuk. Scan kartu Anda di sana.
                  </p>
                </>
              ) : error ? (
                <>
                  <XCircle className="size-12 text-ng" strokeWidth={1.6} aria-hidden />
                  <div className="text-[26px] font-extrabold leading-tight text-ng">
                    GAGAL KIRIM
                  </div>
                  <p className="max-w-md text-[15px] text-ink-soft">{error}</p>
                </>
              ) : !result ? (
                <>
                  <ScanLine className="size-12 text-ink-muted" strokeWidth={1.4} aria-hidden />
                  <div className="text-[26px] font-extrabold leading-tight text-ink-muted">
                    MENUNGGU SCAN
                  </div>
                </>
              ) : result.status === 'ACCEPTED' ? (
                <>
                  <CheckCircle2 className="size-12 text-ok" strokeWidth={1.6} aria-hidden />
                  <div className="text-[38px] font-extrabold leading-none tracking-tight text-ok">
                    OK
                  </div>
                  <div className="tabular text-[20px] font-bold">{result.rawCode}</div>
                  {result.partName ? (
                    <div className="text-[15px] text-ink-soft">
                      {result.partNumber} — {result.partName}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {result.status === 'DUPLICATE' ? (
                    <CopyX className="size-12 text-warn" strokeWidth={1.6} aria-hidden />
                  ) : (
                    <XCircle className="size-12 text-ng" strokeWidth={1.6} aria-hidden />
                  )}
                  <div
                    className={cn(
                      'text-[32px] font-extrabold leading-none tracking-tight',
                      result.status === 'DUPLICATE' ? 'text-warn' : 'text-ng',
                    )}
                  >
                    {result.status === 'DUPLICATE' ? 'SUDAH DISCAN' : 'DITOLAK'}
                  </div>
                  <div className="tabular text-[18px] font-bold">{result.rawCode}</div>
                  <p className="max-w-md text-[15px] text-ink-soft">{result.message}</p>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </section>

        {/* ── Penghitung ────────────────────────────────────────────────── */}
        <section className="flex flex-col justify-center rounded-card border border-line bg-card p-5 text-center">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Total OK hari ini
          </div>
          <motion.div
            key={counter}
            initial={{ scale: 1.18 }}
            animate={{ scale: 1 }}
            transition={{ duration: durations.slow, ease: easeSoft }}
            className="tabular mt-3 text-[56px] font-extrabold leading-none tracking-tight"
          >
            {counter}
          </motion.div>
          <div className="mt-2 text-[13px] text-ink-muted">Line {summary.line.code}</div>
        </section>
      </div>

      {/* ── Riwayat ─────────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">Scan terakhir</h2>
          <span className="text-[13px] text-ink-muted">{recent.length} terbaru</span>
        </header>

        {recent.length === 0 ? (
          <p className="px-5 py-12 text-center text-[14px] text-ink-muted">
            Belum ada scan pada line ini hari ini.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {recent.map((r) => (
                <motion.li
                  key={`${r.id}-${r.rawCode}`}
                  layout
                  initial={{ opacity: 0, height: 0, backgroundColor: 'rgba(22,163,74,0.10)' }}
                  animate={{ opacity: 1, height: 'auto', backgroundColor: 'rgba(22,163,74,0)' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    layout: springSoft,
                    height: { duration: durations.base, ease: easeSoft },
                    opacity: { duration: durations.base, ease: easeSoft },
                    backgroundColor: { duration: 1.4, ease: easeSoft },
                  }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-4 px-5 py-3 text-[14px]">
                    <span className="tabular w-20 shrink-0 text-[13px] font-medium text-ink-muted">
                      {new Date(r.scannedAt).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span className="tabular min-w-0 flex-1 truncate font-semibold">
                      {r.rawCode}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-ink-soft sm:block">
                      {r.partName ?? '—'}
                    </span>
                    <span className="tabular w-16 shrink-0 text-right font-semibold">
                      {r.qty} pcs
                    </span>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Pemilih mode OK / NG.
 *
 * NG diberi warnanya sendiri dan tidak pernah jadi mode awal: layar ini paling
 * sering dipakai untuk mencatat hasil baik, dan mode NG yang tertinggal aktif
 * akan membuat hasil produksi satu shift tercatat sebagai kerusakan.
 */
function TabMode({
  aktif,
  onClick,
  label,
  nada,
  icon: Icon,
}: {
  aktif: boolean;
  onClick: () => void;
  label: string;
  nada: 'ok' | 'ng';
  icon?: typeof AlertTriangle;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={aktif}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-[14px] font-bold transition-colors',
        !aktif && 'border-line text-ink-muted hover:border-ink hover:text-ink',
        aktif && nada === 'ok' && 'border-ink bg-surface text-ink',
        aktif && nada === 'ng' && 'border-ng bg-ng/10 text-ng',
      )}
    >
      {Icon ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}
      {label}
    </button>
  );
}
