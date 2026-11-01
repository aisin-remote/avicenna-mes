'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowLeftRight,
  Check,
  Keyboard,
  ShoppingCart,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { BelanjaMenunggu, SesiBelanja, StasiunBelanja } from '@avicenna/contracts';
import {
  batalBelanjaAction,
  scanBelanjaAction,
  simpanBelanjaAction,
} from '@/app/(station)/belanja/actions';
import { useScanSound } from './use-scan-sound';
import { cn } from '../ui/cn';

/**
 * Stasiun belanja — scanner genggam 375×667 tegak.
 *
 * ── Urutannya tetap: kartu FG dulu, lalu box-box-nya ────────────────────────
 *
 * Tembakan pertama adalah kartu FG — itulah perintahnya, dan dari situ layar
 * tahu apa yang harus diambil dan berapa. Tembakan berikutnya kartu WIP tiap
 * box yang diambil dari rak. Tidak ada tombol untuk memilih sisi: yang
 * menentukan adalah ada atau belum adanya sesi, dan itu sudah terbaca di layar.
 *
 * ── Yang paling besar adalah KEMAJUAN, bukan hasil tembakan ─────────────────
 *
 * Bedanya dengan stasiun kanban: di sana satu tembakan adalah satu pekerjaan
 * selesai, jadi yang dibesarkan hasilnya. Di sini satu tembakan hanyalah satu
 * langkah dari beberapa, dan yang terus dilihat orang adalah "masih kurang
 * berapa" — jadi itulah yang mengambil ruang.
 */
export function StasiunBelanjaLayar({ awal, npk }: { awal: StasiunBelanja; npk: string }) {
  const [kode, setKode] = useState('');
  const [sesi, setSesi] = useState<SesiBelanja | null>(null);
  const [pesan, setPesan] = useState<{ teks: string; buruk: boolean } | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [menunggu, setMenunggu] = useState<BelanjaMenunggu[]>(awal.menunggu);
  const [ketikManual, setKetikManual] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sound = useScanSound(true);

  const fokus = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => {
    fokus();
    const t = setInterval(fokus, 1500);
    return () => clearInterval(t);
  }, [fokus]);

  function lapor(res: { hasil: 'DITERIMA' | 'DITOLAK'; pesan: string }) {
    setPesan({ teks: res.pesan, buruk: res.hasil === 'DITOLAK' });
    if (res.hasil === 'DITERIMA') sound.ok();
    else sound.reject();
  }

  async function kirim(raw: string) {
    const nilai = raw.trim();
    if (!nilai || sibuk) return;
    setSibuk(true);
    setKode('');

    const res = await scanBelanjaAction({
      plantCode: awal.pabrik.code,
      fgKanbanId: sesi?.fg.kanbanId ?? null,
      rawCode: nilai,
      wipKanbanIds: sesi?.kartuWip.map((k) => k.kanbanId) ?? [],
    });
    setSibuk(false);
    fokus();

    if ('error' in res) {
      sound.reject();
      setPesan({ teks: res.error, buruk: true });
      return;
    }
    lapor(res);
    // Sesi dari balasan MENANG atas yang di layar: server yang menghitung
    // kebutuhannya, dan layar tidak boleh punya pendapat sendiri soal itu.
    if (res.sesi) setSesi(res.sesi);
  }

  async function simpan() {
    if (!sesi || sibuk) return;
    setSibuk(true);
    const res = await simpanBelanjaAction({
      plantCode: awal.pabrik.code,
      fgKanbanId: sesi.fg.kanbanId,
      wipKanbanIds: sesi.kartuWip.map((k) => k.kanbanId),
    });
    setSibuk(false);
    fokus();

    if ('error' in res) {
      sound.reject();
      setPesan({ teks: res.error, buruk: true });
      return;
    }
    lapor(res);
    if (res.hasil === 'DITERIMA') {
      /*
       * Daftar tunggu ditambah di layar, tidak dimuat ulang dari server.
       * Memuat ulang halaman di stasiun berarti fokus kotak scan lepas.
       */
      setMenunggu((lama) => [
        {
          fgKanbanId: sesi.fg.kanbanId,
          partNumber: sesi.fg.partNumber,
          backNumber: sesi.fg.backNumber,
          serialNumber: sesi.fg.serialNumber,
          jumlahKartu: sesi.kartuWip.length,
          unit: sesi.unitFg,
          pairedAt: new Date().toISOString(),
          npk,
        },
        ...lama,
      ]);
      setSesi(null);
    } else if (res.sesi) {
      setSesi(res.sesi);
    }
  }

  async function batal(fgKanbanId: number) {
    if (sibuk) return;
    setSibuk(true);
    const res = await batalBelanjaAction({ plantCode: awal.pabrik.code, fgKanbanId });
    setSibuk(false);
    fokus();
    if ('error' in res) {
      sound.reject();
      setPesan({ teks: res.error, buruk: true });
      return;
    }
    lapor(res);
    if (res.hasil === 'DITERIMA') {
      setMenunggu((lama) => lama.filter((m) => m.fgKanbanId !== fgKanbanId));
    }
  }

  return (
    <div className="flex h-dvh flex-col gap-2.5 overflow-hidden bg-surface p-2.5">
      {/* ── Bilah atas ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2">
        <ShoppingCart className="size-5 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold leading-none tracking-tight">
            Belanja {awal.pabrik.code}
          </div>
          <div className="mt-1 truncate text-[11px] text-ink-muted">
            {awal.prosesWajib.length > 0 ? (
              <span className="truncate">{awal.prosesWajib.join(', ')}</span>
            ) : (
              /* Penanda belum dinyalakan disebut di layar: tanpa itu, belanja
                 yang tersimpan tapi tidak menginterlock apa pun terbaca sebagai
                 aplikasi yang diam-diam tidak bekerja. */
              <span className="text-ng">Belum ada proses yang mewajibkan belanja</span>
            )}
            {' · '}
            <span className="tabular">NPK {npk}</span>
          </div>
        </div>
        <Link
          href="/belanja"
          aria-label="Ganti area"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-line text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <ArrowLeftRight className="size-[18px]" strokeWidth={2} aria-hidden />
        </Link>
      </header>

      {/* ── Pesan tembakan terakhir ────────────────────────────────────────── */}
      {pesan ? (
        <div
          aria-live="polite"
          className={cn(
            'shrink-0 rounded-xl border px-3 py-2 text-[12.5px] font-semibold leading-snug',
            pesan.buruk ? 'border-ng/45 bg-ng/8 text-ng' : 'border-ok/45 bg-ok/8 text-ok',
          )}
        >
          {pesan.teks}
        </div>
      ) : null}

      {sesi ? (
        <>
          {/* ── Kartu FG yang sedang dibelanjakan ───────────────────────── */}
          <section className="shrink-0 rounded-2xl border-2 border-ink/15 bg-card px-3 py-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
              Perintah
            </div>
            <div className="tabular mt-0.5 truncate text-[16px] font-extrabold leading-tight">
              {sesi.fg.partNumber}
              {sesi.fg.backNumber ? (
                <span className="ml-1.5 text-[13px] font-semibold text-ink-muted">
                  {sesi.fg.backNumber}
                </span>
              ) : null}
            </div>
            <div className="tabular mt-0.5 text-[11.5px] text-ink-muted">
              seri {sesi.fg.serialNumber} · {sesi.unitFg} unit
            </div>
          </section>

          {/* ── Kemajuan per komponen: bagian terpenting layar ──────────── */}
          <section className="flex shrink-0 flex-col gap-2">
            {sesi.komponen.map((k) => {
              const rasio = k.dibutuhkan > 0 ? Math.min(1, k.dibawa / k.dibutuhkan) : 0;
              return (
                <div
                  key={k.partId}
                  className={cn(
                    'rounded-2xl border px-3 py-2',
                    k.pas ? 'border-ok/45 bg-ok/8' : 'border-line bg-card',
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="tabular min-w-0 flex-1 truncate text-[13px] font-bold">
                      {k.partNumber}
                    </span>
                    <span
                      className={cn(
                        'tabular text-[17px] font-extrabold leading-none',
                        k.pas ? 'text-ok' : k.dibawa > k.dibutuhkan ? 'text-ng' : 'text-ink',
                      )}
                    >
                      {k.dibawa}
                      <span className="text-[12px] font-bold text-ink-muted">/{k.dibutuhkan}</span>
                    </span>
                    {k.pas ? (
                      <Check className="size-4 shrink-0 text-ok" strokeWidth={3} aria-hidden />
                    ) : null}
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                    <motion.div
                      className={cn('h-full rounded-full', k.pas ? 'bg-ok' : 'bg-ink')}
                      initial={false}
                      animate={{ width: `${rasio * 100}%` }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-muted">
                    <span>{k.jumlahKartu} kartu</span>
                    {k.tidakAkanPas ? (
                      <span className="flex items-center gap-1 text-ng">
                        <TriangleAlert className="size-3" strokeWidth={2.2} aria-hidden />
                        isi box {k.tidakAkanPas.isiBox} tidak bisa pas
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>

          {/* ── Kartu WIP yang sudah ditembak ───────────────────────────── */}
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-card">
            <header className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                Box diambil
              </h2>
              <span className="text-[10.5px] text-ink-muted">{sesi.kartuWip.length}</span>
            </header>
            {sesi.kartuWip.length === 0 ? (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-[11.5px] text-ink-muted">
                Tembak kartu WIP tiap box yang diambil dari rak.
              </p>
            ) : (
              <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
                {[...sesi.kartuWip].reverse().map((k) => (
                  <li
                    key={k.kanbanId}
                    className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12px] last:border-b-0"
                  >
                    <span className="tabular min-w-0 flex-1 truncate font-semibold">
                      {k.partNumber}
                    </span>
                    <span className="tabular w-16 shrink-0 truncate text-right text-ink-muted">
                      {k.serialNumber}
                    </span>
                    <span className="tabular w-10 shrink-0 text-right">{k.qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Simpan / buang sesi ─────────────────────────────────────── */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSesi(null);
                setPesan(null);
                fokus();
              }}
              disabled={sibuk}
              aria-label="Buang sesi belanja"
              className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-line bg-card text-ink-muted transition-colors hover:text-ink disabled:opacity-60"
            >
              <X className="size-5" strokeWidth={2.4} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void simpan()}
              disabled={sibuk || !sesi.bolehDisimpan}
              className={cn(
                'h-12 min-w-0 flex-1 rounded-xl text-[16px] font-bold transition-[filter] duration-200',
                sesi.bolehDisimpan
                  ? 'bg-ok text-white hover:brightness-110'
                  : 'cursor-not-allowed bg-line text-ink-muted',
              )}
            >
              {sesi.bolehDisimpan ? 'SIMPAN BELANJA' : (sesi.galat[0] ?? 'Belum pas')}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* ── Belum ada sesi ──────────────────────────────────────────── */}
          <section className="flex shrink-0 flex-col items-center justify-center rounded-card border-2 border-line bg-card px-4 py-6 text-center">
            <ShoppingCart className="size-10 text-ink-muted" strokeWidth={1.6} aria-hidden />
            <div className="mt-2 text-[22px] font-extrabold leading-tight text-ink-muted">
              SCAN KARTU FG
            </div>
            <p className="mt-1 text-[12px] leading-snug text-ink-muted">
              Kartu FG dulu sebagai perintah, lalu kartu WIP tiap box
            </p>
          </section>

          {/* ── Yang sudah belanja dan belum discan produksi ────────────── */}
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-card">
            <header className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                Sudah belanja, menunggu produksi
              </h2>
              <span className="text-[10.5px] text-ink-muted">{menunggu.length}</span>
            </header>
            {menunggu.length === 0 ? (
              <p className="flex flex-1 items-center justify-center px-4 text-center text-[11.5px] text-ink-muted">
                Tidak ada kartu yang menunggu.
              </p>
            ) : (
              <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
                {menunggu.map((m) => (
                  <li
                    key={m.fgKanbanId}
                    className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12px] last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="tabular truncate font-semibold">{m.partNumber}</div>
                      <div className="tabular truncate text-[10.5px] text-ink-muted">
                        seri {m.serialNumber} · {m.jumlahKartu} box · {m.unit} unit
                      </div>
                    </div>
                    {/* Pembatalan ada di sini, bukan di menu lain: yang tahu
                        belanja mana yang keliru adalah orang yang baru saja
                        melakukannya, dan ia sedang memegang layar ini. */}
                    <button
                      type="button"
                      onClick={() => void batal(m.fgKanbanId)}
                      disabled={sibuk}
                      aria-label={`Batalkan belanja ${m.serialNumber}`}
                      className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-ink-muted transition-colors hover:border-ng/45 hover:text-ng disabled:opacity-60"
                    >
                      <Trash2 className="size-4" strokeWidth={2} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* ── Kotak masukan: paling kecil, paling bawah ────────────────────── */}
      <div className="flex shrink-0 items-center gap-2">
        <input
          ref={inputRef}
          value={kode}
          onChange={(e) => setKode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void kirim(kode);
            }
          }}
          disabled={sibuk}
          inputMode={ketikManual ? 'text' : 'none'}
          placeholder={sesi ? 'Tembak kartu WIP…' : 'Tembak kartu FG…'}
          aria-label="Scan kartu"
          spellCheck={false}
          autoComplete="off"
          className="tabular h-12 min-w-0 flex-1 rounded-xl border-2 border-line bg-card px-3 text-[15px] font-semibold outline-none transition-colors duration-200 placeholder:text-[13px] placeholder:font-normal placeholder:text-ink-muted focus:border-ink disabled:opacity-60"
        />
        <button
          type="button"
          aria-label="Ketik manual"
          aria-pressed={ketikManual}
          onClick={() => {
            setKetikManual((n) => !n);
            inputRef.current?.blur();
            requestAnimationFrame(fokus);
          }}
          className={cn(
            'grid size-12 shrink-0 place-items-center rounded-xl border-2 transition-colors',
            ketikManual
              ? 'border-ink bg-ink text-white'
              : 'border-line bg-card text-ink-muted hover:text-ink',
          )}
        >
          <Keyboard className="size-5" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
