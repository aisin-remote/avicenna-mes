'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  Check,
  Keyboard,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import type { BelanjaMenunggu, SesiBelanja, StasiunBelanja } from '@avicenna/contracts';
import { alokasiBelanja } from '@avicenna/domain';
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
 * ── Kartu induk dulu, lalu kartu turunan ──────────────────────────────────
 *
 * Tembak satu atau beberapa kartu induk (part yang sama, mis. 5 × KPJ9 isi 8 =
 * 40 unit), lalu kartu turunan dari SATU part di BOM-nya (KN2N atau KO47,
 * tidak dicampur). Jumlah kartu turunan mengikuti total isi induk: isi 8 →
 * 5 kartu, isi 16 → 3 kartu. Begitu cukup, belanja langsung tersimpan.
 * Belanja adalah pengaman warna/model (Handika, 13 Nov 2026).
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
      indukKanbanIds: sesi?.induk.map((k) => k.kanbanId) ?? [],
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
    // Sesi dari balasan MENANG atas yang di layar: server yang memeriksa
    // turunannya, dan layar tidak boleh punya pendapat sendiri soal itu.
    if (res.sesi) setSesi(res.sesi);

    // Turunan sudah cukup → langsung simpan. Sesi dari balasan dipakai, bukan state,
    // karena state baru terbaca di render berikutnya.
    if (res.hasil === 'DITERIMA' && res.sisi === 'TURUNAN' && res.sesi?.bolehDisimpan) {
      await simpan(res.sesi);
    }
  }

  async function simpan(sesi: SesiBelanja | null) {
    if (!sesi) return;
    setSibuk(true);
    const res = await simpanBelanjaAction({
      plantCode: awal.pabrik.code,
      indukKanbanIds: sesi.induk.map((k) => k.kanbanId),
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
      // Pembagiannya sama dengan server (alokasiBelanja), jadi angka box per
      // induk di daftar ini cocok dengan yang tercatat.
      const dipilih = sesi.komponen.find((k) => k.dipilih);
      const qtyPer = dipilih && sesi.unitInduk > 0 ? dipilih.dibutuhkan / sesi.unitInduk : 1;
      const alokasi = alokasiBelanja(sesi.induk, sesi.kartuWip, qtyPer);
      const sekarang = new Date().toISOString();
      setMenunggu((lama) => [
        ...sesi.induk.map((k) => ({
          fgKanbanId: k.kanbanId,
          partNumber: k.partNumber,
          backNumber: k.backNumber,
          serialNumber: k.serialNumber,
          jumlahKartu: alokasi.filter((a) => a.indukKanbanId === k.kanbanId).length,
          unit: k.qty,
          pairedAt: sekarang,
          npk,
        })),
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
      // Satu belanja bisa berisi beberapa induk; semuanya ikut batal.
      const batalSemua = new Set([fgKanbanId, ...res.indukDibatalkan]);
      setMenunggu((lama) => lama.filter((m) => !batalSemua.has(m.fgKanbanId)));
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
              {sesi.induk[0]?.partNumber}
              {sesi.induk[0]?.backNumber ? (
                <span className="ml-1.5 text-[13px] font-semibold text-ink-muted">
                  {sesi.induk[0].backNumber}
                </span>
              ) : null}
            </div>
            <div className="tabular mt-0.5 text-[11.5px] text-ink-muted">
              <span className="font-bold text-ink">
                {sesi.induk.length} kartu · {sesi.unitInduk} unit
              </span>
              <span className="block truncate">
                seri {sesi.induk.map((k) => k.serialNumber).join(', ')}
              </span>
            </div>
          </section>

          {/* ── Turunan yang boleh discan: pilih SATU ───────────────────── */}
          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-card">
            <header className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted">
                Turunan — satu part saja
              </h2>
              <span className="text-[10.5px] text-ink-muted">{sesi.komponen.length}</span>
            </header>
            <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
              {sesi.komponen.map((k) => {
                const kartu = sesi.kartuWip.filter((w) => w.partId === k.partId);
                return (
                  <li
                    key={k.partId}
                    className={cn(
                      'flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0',
                      k.cukup ? 'bg-ok/8' : k.dipilih && 'bg-surface',
                      // Part lain redup setelah satu dipilih: tidak boleh dicampur.
                      sesi.komponen.some((x) => x.dipilih) && !k.dipilih && 'opacity-45',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="tabular truncate text-[13px] font-bold">{k.partNumber}</div>
                      <div className="tabular truncate text-[10.5px] text-ink-muted">
                        {k.dipilih
                          ? `seri ${kartu.map((w) => w.serialNumber).join(', ')}`
                          : (k.partName ?? `butuh ${k.dibutuhkan} unit`)}
                      </div>
                    </div>
                    {k.dipilih ? (
                      <div className="shrink-0 text-right">
                        <div
                          className={cn(
                            'tabular text-[17px] font-extrabold leading-none',
                            k.cukup ? 'text-ok' : 'text-ink',
                          )}
                        >
                          {k.jumlahKartu}
                          <span className="text-[12px] font-bold text-ink-muted">
                            /{k.kartuDibutuhkan ?? '?'} kartu
                          </span>
                        </div>
                        <div className="tabular mt-0.5 text-[10.5px] text-ink-muted">
                          {k.dibawa}/{k.dibutuhkan} unit
                        </div>
                      </div>
                    ) : null}
                    {k.cukup ? (
                      <Check className="size-5 shrink-0 text-ok" strokeWidth={3} aria-hidden />
                    ) : null}
                  </li>
                );
              })}
            </ul>
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
              onClick={() => void simpan(sesi)}
              disabled={sibuk || !sesi.bolehDisimpan}
              className={cn(
                'h-12 min-w-0 flex-1 rounded-xl text-[16px] font-bold transition-[filter] duration-200',
                sesi.bolehDisimpan
                  ? 'bg-ok text-white hover:brightness-110'
                  : 'cursor-not-allowed bg-line text-ink-muted',
              )}
            >
              {sesi.bolehDisimpan ? 'SIMPAN BELANJA' : (sesi.galat[0] ?? 'Scan kartu turunan')}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* ── Belum ada sesi ──────────────────────────────────────────── */}
          <section className="flex shrink-0 flex-col items-center justify-center rounded-card border-2 border-line bg-card px-4 py-6 text-center">
            <ShoppingCart className="size-10 text-ink-muted" strokeWidth={1.6} aria-hidden />
            <div className="mt-2 text-[22px] font-extrabold leading-tight text-ink-muted">
              SCAN KARTU INDUK
            </div>
            <p className="mt-1 text-[12px] leading-snug text-ink-muted">
              Kartu induk dulu (boleh beberapa), lalu kartu turunan — tersimpan otomatis saat cukup
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
          placeholder={
            !sesi
              ? 'Tembak kartu induk…'
              : sesi.kartuWip.length === 0
                ? 'Tembak induk lagi, atau turunan…'
                : 'Tembak kartu turunan…'
          }
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
