'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeftRight,
  ArrowRight,
  Keyboard,
  PackageCheck,
  ScanLine,
  Share2,
  XCircle,
} from 'lucide-react';
import type { RiwayatKomponen, ScanKomponenResult, StasiunKomponen } from '@avicenna/contracts';
import { scanKomponenAction } from '@/app/(station)/komponen/actions';
import { useScanSound } from './use-scan-sound';
import { cn } from '../ui/cn';

const RIWAYAT_MAKS = 15;

/**
 * Stasiun kanban — kartu komponen ARES, scanner genggam 375×667 tegak.
 *
 * ── Kenapa tata letaknya begini ─────────────────────────────────────────────
 *
 * Operator memegang box dengan satu tangan dan scanner dengan tangan lain. Ia
 * tidak mengetik, tidak memilih, dan tidak menggulir — satu-satunya hal yang ia
 * lakukan adalah menembak barcode lalu MELIHAT hasilnya. Karena itu panel hasil
 * mengambil seluruh ruang yang tersisa dan berada di tengah pandangan,
 * sementara kotak masukannya justru yang paling kecil: ia tidak pernah
 * disentuh.
 *
 * ── Kenapa kotak masukan di DASAR layar ─────────────────────────────────────
 *
 * Di layar selebar telapak tangan, yang di bawah adalah yang terjangkau jempol,
 * dan di situ pula papan tuts bawaan muncul kalau sampai terbuka. Menaruhnya di
 * atas berarti satu-satunya hal yang mungkin perlu disentuh justru paling jauh
 * dari jempol, dan tertutup papan tuts ketika benar-benar dibutuhkan.
 *
 * ── Tingginya dikunci ke layar ──────────────────────────────────────────────
 *
 * Apa pun yang jatuh di bawah lipatan sama saja dengan tidak ada bagi orang
 * yang berdiri sambil membawa barang. Tidak ada satu pun bagian layar ini yang
 * boleh menuntut digulir untuk terlihat.
 */
export function StasiunKanban({ awal, npk }: { awal: StasiunKomponen; npk: string }) {
  const [kode, setKode] = useState('');
  const [hasil, setHasil] = useState<ScanKomponenResult | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [kartu, setKartu] = useState(awal.kartuHariIni);
  const [riwayat, setRiwayat] = useState<RiwayatKomponen[]>(awal.terakhir);
  /*
   * Papan tuts bawaan dimatikan, dengan satu tombol untuk memanggilnya.
   *
   * Scanner genggam mengirim barcode sebagai ketikan, jadi kotaknya harus tetap
   * terfokus sepanjang shift — dan kotak terfokus di perangkat sentuh membuka
   * papan tuts yang menelan separuh layar 667px, terus-menerus. `inputMode
   * none` menolak papan tuts tanpa menolak ketikan dari scanner.
   *
   * Tombolnya tetap ada karena barcode bisa rusak: tanpa itu, kartu yang
   * barcodenya tergores tidak punya jalan masuk sama sekali.
   */
  const [ketikManual, setKetikManual] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const sound = useScanSound(true);

  /*
   * Fokus dikembalikan terus-menerus. Scanner genggam mengetik lalu menekan
   * Enter; begitu fokus lepas — tersenggol layar sentuh, atau hilang setelah
   * navigasi — tembakan berikutnya mendarat entah di mana dan operator tidak
   * melihat apa pun terjadi.
   */
  const fokus = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => {
    fokus();
    const t = setInterval(fokus, 1500);
    return () => clearInterval(t);
  }, [fokus]);

  async function kirim(raw: string) {
    const nilai = raw.trim();
    if (!nilai || sibuk) return;
    setSibuk(true);
    setKode('');
    seq.current += 1;

    const res = await scanKomponenAction({
      plantCode: awal.pabrik.code,
      rawCode: nilai,
      clientRef: `${Date.now()}-${seq.current}`,
    });
    setSibuk(false);
    fokus();

    if ('error' in res) {
      sound.reject();
      setHasil({
        hasil: 'DITOLAK',
        jenisKartu: null,
        pesan: res.error,
        rawCode: nilai,
        partNumber: null,
        partName: null,
        backNumber: null,
        qty: null,
        dariSloc: null,
        keSloc: null,
        keSap: false,
        scannedAt: new Date().toISOString(),
      });
      return;
    }

    setHasil(res);
    if (res.hasil === 'DITERIMA') {
      sound.ok();
      setKartu((n) => n + 1);
      setRiwayat((lama) =>
        [
          {
            id: seq.current * -1,
            rawCode: res.rawCode,
            jenisKartu: res.jenisKartu,
            partNumber: res.partNumber,
            backNumber: res.backNumber,
            qty: res.qty,
            scannedAt: res.scannedAt,
          },
          ...lama,
        ].slice(0, RIWAYAT_MAKS),
      );
    } else {
      sound.reject();
    }
  }

  const diterima = hasil?.hasil === 'DITERIMA';

  return (
    <div className="flex h-dvh flex-col gap-2.5 overflow-hidden bg-surface p-2.5">
      {/* ── Bilah atas: area, SLOC, hitungan, jalan keluar ────────────────── */}
      <header className="flex shrink-0 items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold leading-none tracking-tight">
            {awal.pabrik.code}
          </div>
          <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-ink-muted">
            <span className="font-semibold">{awal.gudang ?? '—'}</span>
            <ArrowRight className="size-3 shrink-0" strokeWidth={2.6} aria-hidden />
            <span className="font-semibold">{awal.wip ?? '—'}</span>
            <span aria-hidden>·</span>
            <span className="tabular truncate">NPK {npk}</span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <motion.div
            key={kartu}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="tabular text-[20px] font-extrabold leading-none"
          >
            {kartu}
          </motion.div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-muted">kartu</div>
        </div>

        {/* Ganti area, bukan keluar: pindah pabrik jauh lebih sering terjadi
            daripada ganti orang di satu shift. */}
        <Link
          href="/komponen"
          aria-label="Ganti area"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-line text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <ArrowLeftRight className="size-[18px]" strokeWidth={2} aria-hidden />
        </Link>
      </header>

      {/* ── Panel hasil: sebesar sisa layar ──────────────────────────────── */}
      <section
        aria-live="polite"
        className={cn(
          'flex min-h-0 flex-1 flex-col items-center justify-center rounded-card border-2 px-4 py-3 text-center transition-colors duration-200',
          hasil === null
            ? 'border-line bg-card'
            : diterima
              ? 'border-ok/45 bg-ok/8'
              : 'border-ng/45 bg-ng/8',
        )}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${hasil?.rawCode ?? 'diam'}-${seq.current}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex w-full flex-col items-center gap-2"
          >
            {hasil === null ? (
              <>
                <ScanLine className="size-11 text-ink-muted" strokeWidth={1.5} aria-hidden />
                <div className="text-[24px] font-extrabold leading-tight text-ink-muted">
                  SCAN KARTU
                </div>
                <p className="text-[12px] text-ink-muted">Kartu komponen terbitan ARES</p>
              </>
            ) : diterima ? (
              <>
                <PackageCheck className="size-10 text-ok" strokeWidth={1.7} aria-hidden />
                <div className="text-[34px] font-extrabold leading-none tracking-tight text-ok">
                  PINDAH
                </div>
                {hasil.qty !== null ? (
                  <div className="tabular text-[26px] font-extrabold leading-none">
                    {hasil.qty} pcs
                  </div>
                ) : null}
                <div className="tabular w-full truncate text-[15px] font-bold">
                  {hasil.partNumber ?? '—'}
                  {hasil.backNumber ? (
                    <span className="ml-1.5 font-semibold text-ink-muted">{hasil.backNumber}</span>
                  ) : null}
                </div>
                {hasil.partName ? (
                  <div className="line-clamp-2 text-[11.5px] leading-snug text-ink-soft">
                    {hasil.partName}
                  </div>
                ) : null}

                <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
                  {hasil.dariSloc && hasil.keSloc ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 font-bold">
                      {hasil.dariSloc}
                      <ArrowRight className="size-3" strokeWidth={2.6} aria-hidden />
                      {hasil.keSloc}
                    </span>
                  ) : null}
                  {/* Disebut di layar supaya operator tahu mana yang sampai ke
                      SAP dan mana yang murni catatan kita. */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold',
                      hasil.keSap ? 'bg-accent/10 text-accent' : 'bg-line text-ink-muted',
                    )}
                  >
                    <Share2 className="size-3" strokeWidth={2.2} aria-hidden />
                    {hasil.keSap ? 'ke SAP' : 'tidak ke SAP'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <XCircle className="size-10 text-ng" strokeWidth={1.7} aria-hidden />
                <div className="text-[28px] font-extrabold leading-none tracking-tight text-ng">
                  DITOLAK
                </div>
                <p className="text-[13px] leading-snug text-ink-soft">{hasil.pesan}</p>
                <div className="tabular w-full truncate text-[10.5px] text-ink-muted">
                  {hasil.rawCode}
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      {/* ── Kartu terakhir: cukup untuk memastikan tembakan tadi masuk ───── */}
      <section className="flex h-[124px] shrink-0 flex-col rounded-2xl border border-line bg-card">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
          <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
            Kartu terakhir
          </h2>
          <span className="text-[10.5px] text-ink-muted">{riwayat.length}</span>
        </header>
        {riwayat.length === 0 ? (
          <p className="flex flex-1 items-center justify-center px-3 text-center text-[11.5px] text-ink-muted">
            Belum ada kartu discan di area ini hari ini.
          </p>
        ) : (
          <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            {riwayat.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[12px] last:border-b-0"
              >
                <span className="tabular w-9 shrink-0 text-ink-muted">
                  {new Date(r.scannedAt).toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="tabular min-w-0 flex-1 truncate font-semibold">
                  {r.partNumber ?? r.rawCode}
                </span>
                <span className="tabular w-8 shrink-0 text-right">{r.qty ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

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
          placeholder="Tembak barcode…"
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
            // Fokus dilepas lalu diambil lagi: papan tuts hanya menanggapi
            // inputMode yang berlaku saat kotaknya MENDAPAT fokus.
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
