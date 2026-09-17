'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, ScanLine, Undo2, X, Loader2, Info } from 'lucide-react';
import type { NgType, NgOnUnit } from '@avicenna/contracts';
import {
  jenisNgAction,
  periksaUnitAction,
  ngInlineAction,
  batalNgAction,
  type UnitDiperiksa,
} from '@/app/(station)/ng/actions';
import { useScanSound } from './use-scan-sound';
import { springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

/**
 * Layar NG inline — kerusakan yang ketemu DI LINI, barangnya di tangan operator.
 *
 * Alurnya persis layar NG avicenna yang sudah dipakai bertahun-tahun:
 *
 *   scan part code  ->  tekan jenis NG di layar  ->  barangnya tercap
 *
 * Yang berbeda dari layar lama, dan sengaja:
 *
 *  1. Nama part ditampilkan setelah scan. Layar lama hanya menampilkan daftar
 *     NG-nya, jadi salah scan barang baru ketahuan saat laporan dibaca.
 *
 *  2. Layar menyebutkan lebih dulu apakah barangnya sudah pernah tercatat baik,
 *     karena hanya yang begitu yang stoknya akan dikurangi. Operator berhak tahu
 *     sebelum menekan, bukan sesudah angkanya berubah.
 *
 *  3. Menekan jenis yang sama dua kali TIDAK menghapus. Layar lama menghapus
 *     barisnya diam-diam; di sini pembatalan punya tombolnya sendiri dan
 *     meninggalkan jejak.
 */
export function NgInline({
  lineCode,
  lineName,
  grup,
}: {
  lineCode: string;
  lineName: string;
  grup: string;
}) {
  const [jenis, setJenis] = useState<NgType[]>([]);
  const [kode, setKode] = useState('');
  const [unit, setUnit] = useState<UnitDiperiksa | null>(null);
  const [ngAktif, setNgAktif] = useState<NgOnUnit[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const sound = useScanSound(true);

  const fokus = useCallback(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    let batal = false;
    void jenisNgAction(grup).then((r) => {
      if (batal) return;
      if ('error' in r) setGalat(r.error);
      else setJenis(r.jenis);
    });
    return () => {
      batal = true;
    };
  }, [grup]);

  // Fokus kembali ke kotak scan setelah tiap kejadian: scanner mengetik seperti
  // papan ketik, dan fokus yang lepas membuat scan hilang tanpa jejak.
  useEffect(() => {
    if (!sibuk && !unit) fokus();
  }, [sibuk, unit, fokus]);

  async function periksa(raw: string) {
    const nilai = raw.trim();
    if (!nilai || sibuk) return;

    setSibuk(true);
    setGalat(null);
    setKabar(null);

    const hasil = await periksaUnitAction(nilai, lineCode);
    setSibuk(false);
    setKode('');

    if ('error' in hasil) {
      setGalat(hasil.error);
      setUnit(null);
      setNgAktif([]);
      sound.reject();
      fokus();
      return;
    }

    setUnit(hasil);
    setNgAktif(hasil.ngAktif);
    sound.ok();
  }

  async function capNg(j: NgType) {
    if (!unit || sibuk) return;

    setSibuk(true);
    setGalat(null);

    const hasil = await ngInlineAction({
      rawCode: unit.rawCode,
      lineCode,
      ngMasterId: j.id,
    });
    setSibuk(false);

    if ('error' in hasil) {
      setGalat(hasil.error);
      sound.reject();
      return;
    }

    setNgAktif(hasil.ngAktif);
    setKabar(
      hasil.dibalik > 0
        ? `NG ${j.name} tercatat. Hasil produksi ${hasil.dibalik} pcs dibatalkan.`
        : `NG ${j.name} tercatat. Barang ini memang belum pernah tercatat baik, jadi stok tidak berubah.`,
    );
    sound.ok();
  }

  async function batalkan(n: NgOnUnit) {
    if (sibuk) return;
    setSibuk(true);
    setGalat(null);

    const hasil = await batalNgAction(n.id);
    setSibuk(false);

    if ('error' in hasil) {
      setGalat(hasil.error);
      sound.reject();
      return;
    }
    setNgAktif(hasil.ngAktif);
    setKabar(`Catatan NG ${n.ngName ?? ''} dibatalkan.`);
  }

  function ganti() {
    setUnit(null);
    setNgAktif([]);
    setKabar(null);
    setGalat(null);
    setKode('');
    fokus();
  }

  const sudahDicap = new Set(ngAktif.map((n) => n.ngMasterId));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        {/* ── Barang ────────────────────────────────────────────────────── */}
        <section className="rounded-card border-2 border-ng/30 bg-ng/5 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-ng" strokeWidth={2} aria-hidden />
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ng">
              Input part NG — line {lineName}
            </h2>
          </div>

          {!unit ? (
            <>
              <p className="mt-2 text-[13px] leading-snug text-ink-muted">
                Scan barcode part yang rusak. Jenis NG dipilih setelah barangnya terbaca.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void periksa(kode);
                }}
                className="mt-4"
              >
                <input
                  ref={input}
                  value={kode}
                  onChange={(e) => setKode(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label="Barcode part NG"
                  placeholder="Fokus di sini lalu scan"
                  className="tabular h-14 w-full rounded-2xl border-2 border-line bg-surface px-4 text-[18px] font-semibold outline-none transition-colors duration-200 placeholder:text-[15px] placeholder:font-normal placeholder:text-ink-muted focus:border-ng focus:bg-card"
                />
              </form>
              {sibuk ? (
                <p className="mt-3 flex items-center gap-2 text-[14px] text-ink-muted">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> memeriksa barang…
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-4">
              <div className="tabular text-[24px] font-extrabold leading-tight">
                {unit.rawCode}
              </div>
              <div className="mt-1 text-[15px] text-ink-soft">
                {unit.partNumber} — {unit.partName}
              </div>

              {/* Disebut lebih dulu, bukan sesudah angkanya berubah. */}
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-card px-3 py-2 text-[13px] text-ink-soft">
                <Info className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.8} aria-hidden />
                {unit.adaScanProduksi
                  ? 'Barang ini sudah tercatat sebagai hasil baik. Mencapnya NG akan mengurangi hasil produksi.'
                  : 'Barang ini belum pernah tercatat sebagai hasil baik. Stok tidak akan berubah.'}
              </p>

              <button
                type="button"
                onClick={ganti}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface"
              >
                <ScanLine className="size-4" strokeWidth={1.8} aria-hidden /> Scan barang lain
              </button>
            </div>
          )}

          <AnimatePresence>
            {galat ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={springSoft}
                className="mt-4 rounded-xl border border-ng/40 bg-ng/10 px-4 py-3 text-[15px] font-medium text-ng"
              >
                {galat}
              </motion.p>
            ) : null}
            {kabar && !galat ? (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={springSoft}
                className="mt-4 rounded-xl border border-ok/40 bg-ok/10 px-4 py-3 text-[15px] font-medium text-ok"
              >
                {kabar}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </section>

        {/* ── NG yang menempel ──────────────────────────────────────────── */}
        <section className="rounded-card border border-line bg-card">
          <header className="border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-bold">NG pada barang ini</h2>
          </header>
          {ngAktif.length === 0 ? (
            <p className="px-5 py-10 text-center text-[14px] text-ink-muted">
              {unit ? 'Belum ada.' : 'Scan barang lebih dulu.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {ngAktif.map((n) => (
                <li key={n.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ng">
                      {n.ngName ?? n.ngCode}
                    </span>
                    <span className="tabular text-[12px] text-ink-muted">
                      {n.qty} pcs ·{' '}
                      {new Date(n.occurredAt).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {n.npk ? ` · ${n.npk}` : ''}
                    </span>
                  </span>
                  {/* Pembatalan punya tombolnya sendiri. Menekan ulang jenis
                      NG-nya tidak menghapus apa pun — salah tekan di layar lama
                      menghapus baris tanpa jejak. */}
                  <button
                    type="button"
                    onClick={() => void batalkan(n)}
                    disabled={sibuk}
                    aria-label={`Batalkan NG ${n.ngName ?? ''}`}
                    className="shrink-0 rounded-full border border-line p-1.5 text-ink-muted transition-colors hover:border-ink hover:text-ink"
                  >
                    <Undo2 className="size-4" strokeWidth={1.8} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Tombol jenis NG ─────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Jenis NG
        </h2>
        {jenis.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-muted">
            Belum ada jenis NG untuk proses ini. Tambahkan di master NG lebih dulu.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {jenis.map((j) => {
              const dicap = sudahDicap.has(j.id);
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => void capNg(j)}
                  disabled={!unit || sibuk || dicap}
                  className={cn(
                    'min-h-[64px] rounded-xl border-2 px-3 py-3 text-[15px] font-bold leading-tight transition-colors',
                    dicap
                      ? 'cursor-default border-ng bg-ng/15 text-ng'
                      : unit
                        ? 'border-line hover:border-ng hover:bg-ng/8'
                        : 'border-line text-ink-muted opacity-50',
                  )}
                >
                  {j.name}
                  {dicap ? (
                    <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wide">
                      tercatat
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        {!unit ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-muted">
            <X className="size-4" strokeWidth={1.8} aria-hidden />
            Tombol aktif setelah barangnya discan.
          </p>
        ) : null}
      </section>
    </div>
  );
}
