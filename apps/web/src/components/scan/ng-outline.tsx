'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Loader2, PackageX, Barcode } from 'lucide-react';
import type { NgType, NgResult, NgSource } from '@avicenna/contracts';
import { NG_SOURCE_LABELS } from '@avicenna/contracts';
import { jenisNgAction, ngOutlineAction } from '@/app/(station)/ng/actions';
import { useScanSound } from './use-scan-sound';
import { springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

/**
 * Layar NG outline — kerusakan yang ketemu DI LUAR LINI: di rak, saat audit,
 * saat barang mau dikirim.
 *
 * ── Kenapa jenis NG dipilih SEBELUM barangnya discan ────────────────────────
 *
 * Kebalikan dari layar NG inline, dan disengaja. Orang yang memeriksa rak
 * biasanya memisahkan banyak barang dengan kerusakan yang SAMA; memintanya
 * memilih jenis lagi untuk tiap barang membuat pemeriksaan satu rak jadi
 * ratusan ketukan, dan yang terburu-buru akan berhenti mencatat.
 *
 * ── Kenapa "lewat apa" dipilih, bukan ditebak ───────────────────────────────
 *
 * Kartu kanban dan part code sama-sama barcode. Menebaknya dari bentuk berarti
 * kartu yang kebetulan lolos dibaca sebagai part code hanya akan menggugurkan
 * satu pcs — padahal satu box yang bermasalah, dan sisanya tetap terkirim ke
 * customer.
 */
export function NgOutline({ lineCode }: { lineCode?: string }) {
  const [jenis, setJenis] = useState<NgType[]>([]);
  const [terpilih, setTerpilih] = useState<NgType | null>(null);
  const [via, setVia] = useState<NgSource>('PART_CODE');
  const [kode, setKode] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [riwayat, setRiwayat] = useState<NgResult[]>([]);

  const input = useRef<HTMLInputElement>(null);
  const sound = useScanSound(true);

  const fokus = useCallback(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    let batal = false;
    // Tanpa grup: NG outline tidak terikat satu proses, dan barang di rak bisa
    // datang dari proses mana pun.
    void jenisNgAction().then((r) => {
      if (batal) return;
      if ('error' in r) setGalat(r.error);
      else setJenis(r.jenis);
    });
    return () => {
      batal = true;
    };
  }, []);

  useEffect(() => {
    if (terpilih && !sibuk) fokus();
  }, [terpilih, sibuk, fokus]);

  async function kirim(raw: string) {
    const nilai = raw.trim();
    if (!nilai || !terpilih || sibuk) return;

    setSibuk(true);
    setGalat(null);

    const hasil = await ngOutlineAction({
      rawCode: nilai,
      via,
      ngMasterId: terpilih.id,
      lineCode,
    });

    setSibuk(false);
    setKode('');
    fokus();

    if ('error' in hasil) {
      setGalat(hasil.error);
      sound.reject();
      return;
    }

    setRiwayat((prev) => [hasil, ...prev].slice(0, 15));
    sound.ok();
  }

  const totalPcs = riwayat.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="space-y-5">
      {/* ── Jenis NG ─────────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            1 · Pilih jenis NG
          </h2>
          {terpilih ? (
            <span className="text-[13px] text-ink-muted">
              Berlaku untuk semua barang yang discan berikutnya.
            </span>
          ) : null}
        </div>

        {jenis.length === 0 ? (
          <p className="mt-4 text-[14px] text-ink-muted">
            Belum ada jenis NG terdaftar. Tambahkan di master NG lebih dulu.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {jenis.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setTerpilih(j)}
                className={cn(
                  'min-h-[56px] rounded-xl border-2 px-3 py-2.5 text-[15px] font-bold leading-tight transition-colors',
                  terpilih?.id === j.id
                    ? 'border-ng bg-ng/15 text-ng'
                    : 'border-line hover:border-ng hover:bg-ng/8',
                )}
              >
                {j.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Scan ─────────────────────────────────────────────────────────── */}
      <section
        className={cn(
          'rounded-card border-2 p-5 transition-colors',
          terpilih ? 'border-ng/30 bg-ng/5' : 'border-line bg-card opacity-60',
        )}
      >
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          2 · Scan barangnya
        </h2>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['PART_CODE', 'KANBAN'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setVia(v);
                setGalat(null);
                fokus();
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                via === v
                  ? 'border-ink bg-surface text-ink'
                  : 'border-line text-ink-muted hover:border-ink hover:text-ink',
              )}
            >
              {v === 'KANBAN' ? (
                <PackageX className="size-4" strokeWidth={1.8} aria-hidden />
              ) : (
                <Barcode className="size-4" strokeWidth={1.8} aria-hidden />
              )}
              {NG_SOURCE_LABELS[v]}
            </button>
          ))}
        </div>

        {/* Akibat pilihan itu disebutkan, bukan disimpan sebagai pengetahuan
            orang dalam: satu scan kanban menggugurkan SEISI box. */}
        <p className="mt-3 text-[13px] leading-snug text-ink-soft">
          {via === 'KANBAN'
            ? 'Satu scan kartu menggugurkan SELURUH isi box. Kartunya dikosongkan dan kembali ke lini.'
            : 'Satu scan menggugurkan satu barang.'}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void kirim(kode);
          }}
          className="mt-4"
        >
          <input
            ref={input}
            value={kode}
            onChange={(e) => setKode(e.target.value)}
            disabled={!terpilih}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label={via === 'KANBAN' ? 'Barcode kanban' : 'Barcode part'}
            placeholder={terpilih ? 'Fokus di sini lalu scan' : 'Pilih jenis NG lebih dulu'}
            className="tabular h-14 w-full rounded-2xl border-2 border-line bg-surface px-4 text-[18px] font-semibold outline-none transition-colors duration-200 placeholder:text-[15px] placeholder:font-normal placeholder:text-ink-muted focus:border-ng focus:bg-card disabled:cursor-not-allowed"
          />
        </form>

        {sibuk ? (
          <p className="mt-3 flex items-center gap-2 text-[14px] text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> mencatat…
          </p>
        ) : null}

        <AnimatePresence>
          {galat ? (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={springSoft}
              className="mt-4 flex items-start gap-2 rounded-xl border border-ng/40 bg-ng/10 px-4 py-3 text-[15px] font-medium text-ng"
            >
              <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden />
              <span>{galat}</span>
            </motion.p>
          ) : null}
        </AnimatePresence>
      </section>

      {/* ── Riwayat ──────────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">Tercatat sesi ini</h2>
          <span className="tabular text-[13px] text-ink-muted">{totalPcs} pcs</span>
        </header>
        {riwayat.length === 0 ? (
          <p className="px-5 py-10 text-center text-[14px] text-ink-muted">Belum ada.</p>
        ) : (
          <ul className="divide-y divide-line">
            {riwayat.map((r, i) => (
              <li key={`${r.occurredAt}-${i}`} className="px-5 py-3 text-[14px]">
                <div className="flex items-center gap-4">
                  <span className="tabular w-20 shrink-0 text-[13px] text-ink-muted">
                    {new Date(r.occurredAt).toLocaleTimeString('id-ID', {
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
                  <span className="tabular w-16 shrink-0 text-right font-semibold text-ng">
                    {r.qty} pcs
                  </span>
                </div>
                {/* Pembalikan stok disebut per baris: ini satu-satunya tempat
                    operator bisa melihat bahwa hasil produksi ikut berkurang. */}
                <p className="mt-1 text-[12px] text-ink-muted">
                  {r.kanbanDikosongkan ? `Kanban ${r.kanbanDikosongkan} dikosongkan · ` : ''}
                  {r.dibalik > 0
                    ? `hasil produksi ${r.dibalik} pcs dibatalkan`
                    : 'belum pernah tercatat baik — stok tidak berubah'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
