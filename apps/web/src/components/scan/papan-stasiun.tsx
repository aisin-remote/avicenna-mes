'use client';

import { useEffect, useState } from 'react';
import type { PapanStasiun } from '@avicenna/contracts';
import { muatPapanAction } from '@/app/(app)/scan/actions';

/**
 * Papan perintah kerja lini finish good.
 *
 * ── Kenapa warnanya dikunci, tidak ikut tema aplikasi ───────────────────────
 *
 * Papan ini menyala sepanjang shift di layar besar yang dibaca dari beberapa
 * meter, sering di bawah lampu pabrik yang terang. Yang dibutuhkan kontras
 * tertinggi yang bisa didapat — hitam pekat dengan kuning — dan itu tidak
 * boleh berubah mengikuti tema terang/gelap aplikasi. Karena itu warnanya
 * ditulis sebagai nilai tetap di sini, bukan lewat token tema.
 *
 * ── Kenapa angka besar sekali ───────────────────────────────────────────────
 *
 * Satu-satunya hal yang dibaca dari jauh adalah back number dan dua angka
 * hitungan. Sisanya hanya perlu terbaca saat orang mendekat. Ukuran yang
 * seragam membuat papan terlihat rapi tetapi tidak terbaca, dan papan yang
 * tidak terbaca sama saja dengan tidak ada.
 */

const KUNING = '#f5e663';
const HIJAU = '#86efac';
const MERAH = '#f87171';

interface Props {
  awal: PapanStasiun;
  /** Berapa detik sekali papan menarik ulang isinya. */
  jedaDetik?: number;
  onLineStop?: () => void;
  onDandori?: () => void;
  onReject?: () => void;
  onReprint?: () => void;
}

export function PapanStasiun({
  awal,
  jedaDetik = 10,
  onLineStop,
  onDandori,
  onReject,
  onReprint,
}: Props) {
  const [papan, setPapan] = useState(awal);
  const [jam, setJam] = useState<string>('');

  /*
   * Jam dirender SETELAH mount, tidak pada server.
   *
   * Jam server dan jam layar tidak pernah sama persis, dan menyuntikkannya
   * dari server membuat React mengeluh soal hydration mismatch setiap muat.
   * Papan ini juga memang ingin jam dinding pabriknya sendiri.
   */
  useEffect(() => {
    const tulis = () => setJam(new Date().toLocaleTimeString('id-ID', { hour12: false }));
    tulis();
    const t = setInterval(tulis, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let batal = false;
    const tarik = async () => {
      try {
        const baru = await muatPapanAction(awal.line.code);
        if (!batal && !('error' in baru)) setPapan(baru);
      } catch {
        /*
         * Diam saja, dan BIARKAN angka lama di layar.
         *
         * Jaringan pabrik putus-nyambung. Mengosongkan papan setiap kali satu
         * permintaan gagal membuatnya berkedip sepanjang shift, dan operator
         * berhenti mempercayainya. Angka lama yang terlambat beberapa detik
         * jauh lebih berguna daripada papan kosong.
         */
      }
    };
    const t = setInterval(tarik, jedaDetik * 1000);
    return () => {
      batal = true;
      clearInterval(t);
    };
  }, [awal.line.code, jedaDetik]);

  const b = papan.berjalan;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-black text-white"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {/* ── Kepala ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between px-6 py-3">
        <div className="text-xl font-black tracking-tight">
          {papan.line.plantName ?? 'AVICENNA'}
        </div>
        <div className="text-2xl font-bold tracking-wide">
          {papan.line.plantCode ? `${papan.line.plantCode} ` : ''}
          {papan.line.code}
        </div>
        <div className="text-2xl font-bold tabular-nums">{jam || ' '}</div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,15rem)] gap-4 px-6 pb-3">
        {/* ── Kiri: shift dan rencana ──────────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-3">
          <div
            className="rounded px-4 py-2 text-center text-lg font-bold"
            style={{ background: '#1e293b', color: KUNING }}
          >
            {papan.shift ?? 'SHIFT —'}
          </div>

          <KotakAngka
            atas="PLANNING"
            bawah="KANBAN"
            angka={b ? b.rencanaKanban : null}
            kecil={b ? `${b.rencanaPcs} pcs` : null}
          />

          <button
            type="button"
            onClick={onReprint}
            disabled={!onReprint}
            className="rounded py-3 text-base font-bold text-black disabled:opacity-40"
            style={{ background: HIJAU }}
          >
            REPRINT
          </button>
        </div>

        {/* ── Tengah: perintah kerja yang berjalan ─────────────────────── */}
        <div className="flex min-h-0 flex-col items-center justify-center text-center">
          {b ? (
            <>
              <div className="text-lg font-bold tracking-wide">
                {b.nomor}
                {b.customer ? ` (${b.customer})` : ''}
              </div>
              <div
                className="leading-none font-black"
                style={{ color: KUNING, fontSize: 'clamp(4rem, 13vw, 11rem)' }}
              >
                {b.backNumber ?? b.partNumber}
              </div>
              <div className="mt-2 text-2xl font-bold">{b.partNumber}</div>
              {b.partName ? (
                <div className="text-lg italic opacity-80">{b.partName}</div>
              ) : null}
              <div className="mt-4 text-3xl font-bold">
                {b.kotakTerisi} / {b.kotakKapasitas} PCS
              </div>
            </>
          ) : (
            <div className="max-w-xl text-2xl font-semibold opacity-70">
              {papan.catatan ?? 'Tidak ada perintah kerja yang berjalan.'}
            </div>
          )}
        </div>

        {/* ── Kanan: hitungan nyata dan tombol ─────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-3">
          <button
            type="button"
            onClick={onLineStop}
            disabled={!onLineStop}
            className="rounded py-3 text-base font-bold text-black disabled:opacity-40"
            style={{ background: MERAH }}
          >
            STOP
          </button>

          <KotakAngka
            atas="ACTUAL"
            bawah="KANBAN"
            angka={b ? b.aktualKanban : null}
            kecil={b ? `${b.aktualPcs} pcs` : null}
          />

          <button
            type="button"
            onClick={onDandori}
            disabled={!onDandori}
            className="rounded py-3 text-base font-bold text-black disabled:opacity-40"
            style={{ background: HIJAU }}
          >
            DANDORI
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onLineStop}
              disabled={!onLineStop}
              className="rounded py-2 text-sm font-bold text-black disabled:opacity-40"
              style={{ background: HIJAU }}
            >
              LINE STOP
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={!onReject}
              className="rounded py-2 text-sm font-bold text-black disabled:opacity-40"
              style={{ background: HIJAU }}
            >
              REJECT/NG
            </button>
          </div>
        </div>
      </div>

      {/* ── Antrean perintah kerja berikutnya ───────────────────────────── */}
      <div className="shrink-0 border-t border-white/15">
        {papan.antrean.length === 0 ? (
          <div className="px-6 py-4 text-center text-sm opacity-60">
            Antrean rencana kosong.
          </div>
        ) : (
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${papan.antrean.length}, minmax(0, 1fr))`,
            }}
          >
            {papan.antrean.map((a) => {
              const genap = a.aktualPcs >= a.rencanaPcs;
              return (
                <div
                  key={a.planId}
                  className="border-r border-white/10 px-2 py-2 text-center last:border-r-0"
                  style={{
                    background: a.berjalan ? 'rgba(245,230,99,0.14)' : 'transparent',
                  }}
                >
                  <div className="text-xs font-bold opacity-70">{a.urut}</div>
                  <div className="truncate text-xl font-semibold">
                    {a.backNumber ?? a.partNumber}
                  </div>
                  <div className="text-2xl font-black" style={{ opacity: genap ? 0.55 : 1 }}>
                    {a.aktualPcs}
                    <span className="text-base font-bold opacity-70">/{a.rencanaPcs}</span>
                  </div>
                  <div className="truncate text-[10px] opacity-60">{a.nomor}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Kotak angka besar berlabel dua sisi — bentuk yang dipakai PLANNING dan ACTUAL.
 *
 * Label ATAS mengatakan angka apa ini, label BAWAH satuannya. Keduanya perlu:
 * "80" tanpa satuan pernah dibaca sebagai pcs padahal kanban, dan selisihnya
 * sebesar isi satu box.
 */
function KotakAngka({
  atas,
  bawah,
  angka,
  kecil,
}: {
  atas: string;
  bawah: string;
  angka: number | null;
  kecil: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border-2" style={{ borderColor: KUNING }}>
      <div
        className="border-b-2 py-1 text-center text-sm font-bold"
        style={{ borderColor: KUNING, color: KUNING }}
      >
        {atas}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-1 px-2">
        <span
          className="leading-none font-black"
          style={{ color: KUNING, fontSize: 'clamp(2.5rem, 6vw, 5rem)' }}
        >
          {angka ?? '—'}
        </span>
        {kecil ? <span className="self-end pb-2 text-sm opacity-70">{kecil}</span> : null}
      </div>
      <div
        className="border-t-2 py-1 text-center text-sm font-bold"
        style={{ borderColor: KUNING, color: KUNING }}
      >
        {bawah}
      </div>
    </div>
  );
}
