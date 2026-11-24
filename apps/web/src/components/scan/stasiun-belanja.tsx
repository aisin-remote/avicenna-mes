'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  CircleCheck,
  Keyboard,
  Layers,
  LogOut,
  RotateCcw,
  Trash2,
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
 * Tata letaknya mengikuti layar "Kanban Pairing Scan" yang sedang berjalan di
 * lantai (Handika, 17 Nov 2026): tombol Reset / Finish / Logout di atas, empat
 * kotak status, lalu dua panel besar — kartu induk dan kartu turunan — berisi
 * kartu terakhir yang ditembak. Operator tidak perlu belajar layar baru.
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
  /** Belanja terakhir yang tersimpan — tetap tampil hijau sampai kartu induk berikutnya. */
  const [selesai, setSelesai] = useState<SesiBelanja | null>(null);
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
    if (res.sesi) {
      setSesi(res.sesi);
      setSelesai(null);
    }

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
      setSelesai(sesi);
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

  function reset() {
    setSesi(null);
    setSelesai(null);
    setPesan(null);
    fokus();
  }

  /* ── Yang ditampilkan: sesi berjalan, atau belanja yang baru tersimpan ── */
  const tampil = sesi ?? selesai;
  const tersimpan = !sesi && !!selesai;
  const induk = tampil?.induk ?? [];
  const turunan = tampil?.kartuWip ?? [];
  const dipilih = tampil?.komponen.find((k) => k.dipilih) ?? null;
  const indukTerakhir = induk[induk.length - 1] ?? null;
  const turunanTerakhir = turunan[turunan.length - 1] ?? null;

  const status = tersimpan
    ? 'Tersimpan'
    : !sesi
      ? 'Scan Kanban Induk'
      : sesi.bolehDisimpan
        ? 'Siap Finish'
        : sesi.kartuWip.length === 0
          ? 'Scan Induk / Turunan'
          : 'Scan Kanban Turunan';

  return (
    <div className="scroll-slim flex h-dvh flex-col overflow-y-auto bg-surface">
      {/* ── Kepala + tombol ────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-line bg-card px-4 pb-4 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-[17px] font-extrabold uppercase tracking-wide text-[#2b3f8f]">
              <Barcode className="size-5 shrink-0" strokeWidth={2.2} aria-hidden />
              Kanban Pairing Scan
            </h1>
            <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
              Belanja {awal.pabrik.code}: scan kanban induk, lalu kanban turunan sesuai BOM.
              {awal.prosesWajib.length === 0 ? (
                /* Penanda belum dinyalakan disebut di layar: tanpa itu, belanja
                   yang tersimpan tapi tidak menginterlock apa pun terbaca sebagai
                   aplikasi yang diam-diam tidak bekerja. */
                <span className="block text-ng">Belum ada proses yang mewajibkan belanja.</span>
              ) : null}
            </p>
          </div>
          <Link
            href="/belanja"
            aria-label="Ganti area"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <ArrowLeftRight className="size-4" strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={reset}
            disabled={sibuk}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#c9372c] text-[15px] font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
          >
            <RotateCcw className="size-[18px]" strokeWidth={2.4} aria-hidden />
            Reset Transaksi
          </button>
          <button
            type="button"
            onClick={() => void simpan(sesi)}
            disabled={sibuk || !sesi?.bolehDisimpan}
            className={cn(
              'inline-flex h-12 items-center justify-center gap-2 rounded-lg text-[15px] font-bold text-white transition-[filter]',
              sesi?.bolehDisimpan ? 'bg-[#3f8f5a] hover:brightness-110' : 'cursor-not-allowed bg-[#b9cdbf]',
            )}
          >
            <CircleCheck className="size-[18px]" strokeWidth={2.4} aria-hidden />
            Finish
          </button>
        </div>
        <form action="/api/logout" method="post" className="mt-2.5">
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-line bg-card text-[15px] font-bold text-ink-muted transition-colors hover:text-ink"
          >
            <LogOut className="size-[18px]" strokeWidth={2.2} aria-hidden />
            Logout
          </button>
        </form>

        {/* Kotak scan: kecil, tetap di atas supaya fokus scanner tidak lepas. */}
        <div className="mt-2.5 flex items-center gap-2">
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
                ? 'Tembak kanban induk…'
                : sesi.kartuWip.length === 0
                  ? 'Tembak induk lagi, atau turunan…'
                  : 'Tembak kanban turunan…'
            }
            aria-label="Scan kartu"
            spellCheck={false}
            autoComplete="off"
            className="tabular h-11 min-w-0 flex-1 rounded-lg border-2 border-line bg-surface px-3 text-[14px] font-semibold outline-none transition-colors placeholder:text-[12.5px] placeholder:font-normal placeholder:text-ink-muted focus:border-[#2b3f8f] disabled:opacity-60"
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
              'grid size-11 shrink-0 place-items-center rounded-lg border-2 transition-colors',
              ketikManual
                ? 'border-[#2b3f8f] bg-[#2b3f8f] text-white'
                : 'border-line bg-card text-ink-muted hover:text-ink',
            )}
          >
            <Keyboard className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-3">
        {/* ── Pesan tembakan terakhir ──────────────────────────────────────── */}
        {pesan ? (
          <div
            aria-live="polite"
            className={cn(
              'rounded-xl border px-3 py-2 text-[12.5px] font-semibold leading-snug',
              pesan.buruk ? 'border-ng/45 bg-ng/8 text-ng' : 'border-ok/45 bg-ok/8 text-ok',
            )}
          >
            {pesan.teks}
          </div>
        ) : null}

        {/* ── Empat kotak status ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5">
          <KotakStatus judul="Status" isi={status} nada={tersimpan || sesi?.bolehDisimpan ? 'ok' : 'biasa'} />
          <KotakStatus
            judul="Part Induk"
            isi={indukTerakhir ? (indukTerakhir.backNumber ?? indukTerakhir.partNumber) : '-'}
            kecil={indukTerakhir?.backNumber ? indukTerakhir.partNumber : undefined}
          />
          <KotakStatus
            judul="Total Induk"
            isi={String(induk.length)}
            kecil={tampil ? `${tampil.unitInduk} unit` : undefined}
          />
          <KotakStatus
            judul="Total Turunan"
            isi={dipilih ? `${turunan.length}/${dipilih.kartuDibutuhkan ?? '?'}` : String(turunan.length)}
            kecil={dipilih ? `${dipilih.dibawa}/${dipilih.dibutuhkan} unit` : undefined}
            nada={dipilih?.cukup ? 'ok' : 'biasa'}
          />
        </div>

        {/* ── Panel kanban induk ──────────────────────────────────────────── */}
        <PanelKanban
          judul="Kanban Induk"
          ikon={<Boxes className="size-5" strokeWidth={2.2} aria-hidden />}
          keterangan={
            indukTerakhir
              ? `${indukTerakhir.partNumber} · seri ${induk.map((k) => k.serialNumber).join(', ')}`
              : 'Menunggu kanban induk'
          }
          utama={indukTerakhir ? (indukTerakhir.backNumber ?? indukTerakhir.partNumber) : '-'}
          bawah={indukTerakhir ? `#${indukTerakhir.serialNumber} · ${indukTerakhir.qty} unit` : undefined}
          nada={tersimpan ? 'ok' : indukTerakhir ? 'isi' : 'kosong'}
        />

        {/* ── Panel kanban turunan ────────────────────────────────────────── */}
        <PanelKanban
          judul="Kanban Turunan"
          ikon={<Layers className="size-5" strokeWidth={2.2} aria-hidden />}
          keterangan={
            !tampil
              ? 'Menunggu kanban induk'
              : dipilih
                ? `${dipilih.partNumber} · seri ${turunan.map((k) => k.serialNumber).join(', ')}`
                : `Pilih satu: ${tampil.komponen.map((k) => k.partNumber).join(', ') || '—'}`
          }
          utama={turunanTerakhir ? (turunanTerakhir.backNumber ?? turunanTerakhir.partNumber) : '-'}
          bawah={
            turunanTerakhir
              ? `#${turunanTerakhir.serialNumber} · ${turunanTerakhir.qty} unit`
              : sesi && !sesi.bolehDisimpan && sesi.galat[0]
                ? sesi.galat[0]
                : undefined
          }
          nada={tersimpan || dipilih?.cukup ? 'ok' : turunanTerakhir ? 'isi' : 'kosong'}
        />

        {/* ── Yang sudah belanja dan belum discan produksi ────────────────── */}
        <section className="rounded-2xl border border-line bg-card">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-[12px] font-bold uppercase tracking-wide text-[#2b3f8f]">
              Sudah belanja, menunggu produksi
            </h2>
            <span className="tabular text-[12px] text-ink-muted">{menunggu.length}</span>
          </header>
          {menunggu.length === 0 ? (
            <p className="px-4 py-4 text-center text-[12px] text-ink-muted">
              Tidak ada kartu yang menunggu.
            </p>
          ) : (
            <ul>
              {menunggu.map((m) => (
                <li
                  key={m.fgKanbanId}
                  className="flex items-center gap-2 border-b border-line/60 px-4 py-2 text-[12.5px] last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="tabular truncate font-semibold">
                      {m.backNumber ?? m.partNumber}
                      {m.backNumber ? (
                        <span className="ml-1.5 font-normal text-ink-muted">{m.partNumber}</span>
                      ) : null}
                    </div>
                    <div className="tabular truncate text-[11px] text-ink-muted">
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

        <p className="tabular pb-1 text-center text-[11px] text-ink-muted">NPK {npk}</p>
      </div>
    </div>
  );
}

function KotakStatus({
  judul,
  isi,
  kecil,
  nada = 'biasa',
}: {
  judul: string;
  isi: string;
  kecil?: string;
  nada?: 'biasa' | 'ok';
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card px-4 py-3">
      <div className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">{judul}</div>
      <div
        className={cn(
          'tabular mt-1 truncate text-[18px] font-extrabold leading-tight',
          nada === 'ok' ? 'text-ok' : 'text-[#2b3f8f]',
        )}
      >
        {isi}
      </div>
      {kecil ? <div className="tabular truncate text-[11px] text-ink-muted">{kecil}</div> : null}
    </div>
  );
}

function PanelKanban({
  judul,
  ikon,
  keterangan,
  utama,
  bawah,
  nada,
}: {
  judul: string;
  ikon: React.ReactNode;
  keterangan: string;
  utama: string;
  bawah?: string;
  nada: 'kosong' | 'isi' | 'ok';
}) {
  return (
    <section className="rounded-2xl border border-line bg-card px-4 pb-4 pt-3.5">
      <header className="flex items-start gap-3 border-b border-line pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-extrabold uppercase tracking-wide text-[#2b3f8f]">{judul}</h2>
          <p className="mt-0.5 truncate text-[12px] font-semibold text-ink-muted">{keterangan}</p>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-[#2b3f8f]">
          {ikon}
        </span>
      </header>
      <div
        className={cn(
          'mt-4 flex min-h-[160px] flex-col items-center justify-center rounded-xl px-3 text-center text-white shadow-inner',
          nada === 'ok'
            ? 'bg-gradient-to-br from-[#3f9a5f] to-[#2d7046]'
            : nada === 'isi'
              ? 'bg-gradient-to-br from-[#3a51a6] to-[#26387a]'
              : 'bg-gradient-to-br from-[#97a3b6] to-[#6b778d]',
        )}
      >
        <div className="tabular break-all text-[40px] font-extrabold leading-none drop-shadow-sm">{utama}</div>
        {bawah ? (
          <div className="tabular mt-2 text-[13px] font-semibold text-white/85">{bawah}</div>
        ) : null}
      </div>
    </section>
  );
}
