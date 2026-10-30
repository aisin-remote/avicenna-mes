'use client';

import { useEffect, useState } from 'react';
import type { PapanStasiun as DataPapan } from '@avicenna/contracts';
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
 * nilai tetap di sini, bukan token tema.
 *
 * ── Kenapa tata letaknya diatur per pecahan, bukan lebar tetap ──────────────
 *
 * Kiri dan kanan masing-masing seperlima lebar, tengah tiga perlima. Dengan
 * lebar tetap (mis. 15rem) kedua sisi menyusut relatif di layar 55 inci dan
 * papannya jadi berat di tengah; dengan pecahan, perbandingannya sama di layar
 * mana pun.
 *
 * Dan yang membuatnya terlihat seimbang bukan lebar kolomnya, melainkan DUA
 * KOTAK KUNING yang sejajar persis atas dan bawah. Kolom kanan punya satu
 * baris tombol lebih banyak daripada kiri, jadi keduanya disusun sebagai grid
 * empat baris yang sama — baris terakhir di kiri sengaja kosong. Menumpuknya
 * dengan flex membuat kotak kiri lebih tinggi daripada kanan, dan mata
 * langsung menangkapnya sebagai miring.
 */

const KUNING = '#f2e14c';
const HIJAU = '#7ee8a6';
const MERAH = '#f0556b';
const NAVY = '#17253f';
const NAVY_STRIP = '#1b2a4a';

interface Props {
  awal: DataPapan;
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
      {/* ── Kepala: identitas kiri, lini di tengah, jam kanan ───────────── */}
      <header className="grid shrink-0 grid-cols-[1fr_3fr_1fr] items-center gap-4 px-6 py-3">
        <div className="truncate text-left">
          <div className="text-xl leading-none font-black tracking-tight">AVICENNA</div>
          <div className="truncate text-[0.7rem] tracking-wide opacity-60">
            {papan.line.plantName ?? ''}
          </div>
        </div>
        <div
          className="text-center font-black tracking-tight"
          style={{ fontSize: 'clamp(1.25rem, 2.4vw, 2.25rem)' }}
        >
          {papan.line.code} · {papan.line.name}
        </div>
        <div
          className="text-right font-black tabular-nums"
          style={{ fontSize: 'clamp(1.25rem, 2.4vw, 2.25rem)' }}
        >
          {jam || ' '}
        </div>
      </header>

      {/* ── Badan: 20% / 60% / 20% ───────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_3fr_1fr] gap-5 px-6 pb-4">
        {/*
         * Kiri dan kanan memakai KERANGKA BARIS yang sama persis — tombol,
         * kotak, tombol, tombol — supaya kotak kuningnya sejajar. Baris
         * terakhir di kiri kosong, dan itu disengaja.
         */}
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3">
          <div
            className="rounded-md py-2 text-center font-bold"
            style={{ background: NAVY, color: KUNING, fontSize: 'clamp(0.9rem,1.3vw,1.4rem)' }}
          >
            {papan.shift ?? 'SHIFT —'}
          </div>

          <KotakAngka
            atas="PLANNING"
            bawah="KANBAN"
            angka={b ? b.rencanaKanban : null}
            kecil={b ? `${b.rencanaPcs} pcs` : null}
          />

          <Tombol label="REPRINT" warna={HIJAU} onClick={onReprint} />
          <div aria-hidden className="h-0" />
        </div>

        {/* ── Tengah: perintah kerja yang berjalan ─────────────────────── */}
        <div className="flex min-h-0 flex-col items-center justify-center gap-1 text-center">
          {b ? (
            <>
              <div
                className="font-bold tracking-wide"
                style={{ fontSize: 'clamp(0.9rem, 1.5vw, 1.6rem)' }}
              >
                {b.nomor}
                {b.customer ? ` (${b.customer})` : ''}
              </div>
              <div
                className="leading-[0.9] font-black"
                style={{ color: KUNING, fontSize: 'clamp(4rem, 12vw, 11rem)' }}
              >
                {b.backNumber ?? b.partNumber}
              </div>
              <div
                className="mt-1 font-bold"
                style={{ fontSize: 'clamp(1rem, 2vw, 2rem)' }}
              >
                {b.partNumber}
              </div>
              {b.partName ? (
                <div
                  className="truncate italic opacity-80"
                  style={{ fontSize: 'clamp(0.85rem, 1.4vw, 1.4rem)', maxWidth: '100%' }}
                >
                  {b.partName}
                </div>
              ) : null}
              <div
                className="mt-4 font-bold"
                style={{ fontSize: 'clamp(1.25rem, 2.6vw, 2.6rem)' }}
              >
                {b.kotakTerisi} / {b.kotakKapasitas} PCS
              </div>
            </>
          ) : (
            <div
              className="max-w-xl font-semibold opacity-70"
              style={{ fontSize: 'clamp(1rem, 2vw, 1.8rem)' }}
            >
              {papan.catatan ?? 'Tidak ada perintah kerja yang berjalan.'}
            </div>
          )}
        </div>

        {/* ── Kanan: hitungan nyata dan tombol ─────────────────────────── */}
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3">
          <Tombol label="STOP" warna={MERAH} onClick={onLineStop} />

          <KotakAngka
            atas="ACTUAL"
            bawah="KANBAN"
            angka={b ? b.aktualKanban : null}
            kecil={b ? `${b.aktualPcs} pcs` : null}
          />

          <Tombol label="DANDORI" warna={HIJAU} onClick={onDandori} />
          <div className="grid grid-cols-2 gap-2">
            <Tombol label="LINE STOP" warna={HIJAU} kecil onClick={onLineStop} />
            <Tombol label="REJECT/NG" warna={HIJAU} kecil onClick={onReject} />
          </div>
        </div>
      </div>

      {/* ── Antrean perintah kerja berikutnya ───────────────────────────── */}
      <AntreanStrip antrean={papan.antrean} />
    </div>
  );
}

/**
 * Deretan perintah kerja berikutnya.
 *
 * Tingginya DIKUNCI seperlima layar, bukan mengikuti isi: deret ini harus
 * selalu ada di tempat yang sama supaya leader bisa melirik tanpa mencari.
 * Pita nomor bernavy dipisahkan dari isinya, persis seperti papan INES —
 * nomor urut adalah penanda posisi, bukan bagian dari angkanya.
 */
function AntreanStrip({ antrean }: { antrean: DataPapan['antrean'] }) {
  if (antrean.length === 0) {
    return (
      <div className="shrink-0 border-t border-white/15 px-6 py-6 text-center text-sm opacity-60">
        Antrean rencana kosong.
      </div>
    );
  }
  const kolom = `repeat(${antrean.length}, minmax(0, 1fr))`;
  return (
    <div className="shrink-0" style={{ height: '21vh' }}>
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
        <div className="grid" style={{ gridTemplateColumns: kolom, background: NAVY_STRIP }}>
          {antrean.map((a) => (
            <div
              key={`no-${a.planId}`}
              className="border-r border-black/40 py-1 text-center text-sm font-bold last:border-r-0"
            >
              {a.urut}
            </div>
          ))}
        </div>
        <div className="grid min-h-0" style={{ gridTemplateColumns: kolom }}>
          {antrean.map((a) => {
            const genap = a.aktualPcs >= a.rencanaPcs;
            return (
              <div
                key={a.planId}
                className="flex min-w-0 flex-col items-center justify-center gap-0.5 border-r border-white/10 px-1 last:border-r-0"
                style={{ background: a.berjalan ? 'rgba(242,225,76,0.12)' : 'transparent' }}
              >
                <div
                  className="w-full truncate text-center font-semibold"
                  style={{ fontSize: 'clamp(0.9rem, 1.7vw, 1.9rem)' }}
                >
                  {a.backNumber ?? a.partNumber}
                </div>
                <div
                  className="font-black"
                  style={{
                    fontSize: 'clamp(1.1rem, 2.2vw, 2.4rem)',
                    opacity: genap ? 0.5 : 1,
                    color: a.berjalan ? KUNING : undefined,
                  }}
                >
                  {a.aktualPcs}
                  <span className="text-[0.5em] font-bold opacity-70">/{a.rencanaPcs}</span>
                </div>
                <div className="w-full truncate text-center text-[0.6rem] opacity-55">
                  {a.nomor}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Tombol lebar penuh. Mati bila belum ada penanganannya — bukan disembunyikan. */
function Tombol({
  label,
  warna,
  kecil,
  onClick,
}: {
  label: string;
  warna: string;
  kecil?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full rounded-md font-bold text-black disabled:opacity-35"
      style={{
        background: warna,
        padding: kecil ? '0.5rem 0.25rem' : '0.75rem 0.5rem',
        fontSize: kecil ? 'clamp(0.7rem,1vw,1rem)' : 'clamp(0.9rem,1.3vw,1.4rem)',
      }}
    >
      {label}
    </button>
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
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-md border-2"
      style={{ borderColor: KUNING }}
    >
      <div
        className="border-b-2 py-1 text-center font-bold"
        style={{ borderColor: KUNING, color: KUNING, fontSize: 'clamp(0.75rem,1.1vw,1.15rem)' }}
      >
        {atas}
      </div>
      <div className="flex min-h-0 items-center justify-center gap-1 px-2">
        <span
          className="leading-none font-black"
          style={{ color: KUNING, fontSize: 'clamp(2.5rem, 7vw, 6.5rem)' }}
        >
          {angka ?? '—'}
        </span>
        {kecil ? (
          <span className="self-end pb-2 text-[0.75rem] opacity-70">{kecil}</span>
        ) : null}
      </div>
      <div
        className="border-t-2 py-1 text-center font-bold"
        style={{ borderColor: KUNING, color: KUNING, fontSize: 'clamp(0.75rem,1.1vw,1.15rem)' }}
      >
        {bawah}
      </div>
    </div>
  );
}
