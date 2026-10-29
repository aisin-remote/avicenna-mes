'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, DatabaseZap, Eye } from 'lucide-react';
import { tarikMasterAction, type HasilTarikMaster } from '@/app/(app)/sap/actions';
import { useToast } from '../ui/toast';

/**
 * Tarik master manual, dengan langkah "lihat dulu".
 *
 * ── Kenapa dua tombol, bukan satu ───────────────────────────────────────────
 *
 * Tarik master MENIMPA isi layar master, dan tidak ada tombol untuk
 * membatalkannya. Untuk sesuatu yang dijalankan sebulan sekali, orang yang
 * menekannya tidak hafal apa yang akan terjadi — jadi langkah pertama yang
 * wajar adalah membaca staging dan melaporkan apa yang AKAN berubah, tanpa
 * menulis apa pun.
 *
 * Hasilnya ditampilkan sebagai tabel per entitas, bukan satu kalimat
 * "berhasil": yang ingin diketahui orang adalah "3 part baru, 1 dinonaktifkan"
 * — dan angka "1 dinonaktifkan" itulah yang membuatnya memeriksa dulu sebelum
 * menekan tombol kedua.
 */
export function MasterPullActions({ berkalaAktif }: { berkalaAktif: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState<HasilTarikMaster[] | null>(null);
  const [mode, setMode] = useState<'uji' | 'terapkan' | null>(null);

  async function jalankan(uji: boolean) {
    setSibuk(true);
    const res = await tarikMasterAction(uji);
    setSibuk(false);
    if ('error' in res) {
      setHasil(null);
      setMode(null);
      return toast.galat(res.error);
    }
    setHasil(res.hasil);
    setMode(uji ? 'uji' : 'terapkan');

    if (res.alasan) {
      toast.warn(res.alasan, 'Tarik master tidak dijalankan');
      return;
    }

    const total = res.hasil.reduce(
      (a, h) => ({
        baru: a.baru + h.baru,
        ubah: a.ubah + h.diperbarui,
        mati: a.mati + h.dinonaktifkan,
      }),
      { baru: 0, ubah: 0, mati: 0 },
    );
    const ringkas = `${total.baru} baru, ${total.ubah} diperbarui, ${total.mati} dinonaktifkan`;

    if (uji) {
      toast.info(`${ringkas}. Belum ada yang ditulis.`, 'Hasil pemeriksaan');
    } else {
      toast.ok(ringkas, 'Master ditarik');
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
            <DatabaseZap className="size-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
            Master dari staging SAP
          </p>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-muted">
            Part, customer, supplier, dan nomor part customer.{' '}
            {berkalaAktif
              ? 'Ditarik otomatis tiap 15 menit; tombol ini untuk saat tidak mau menunggu.'
              : 'Tarikan otomatis dimatikan — master hanya berubah saat tombol ini ditekan.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void jalankan(true)}
            disabled={sibuk || pending}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:border-ink disabled:opacity-50"
          >
            <Eye className="size-4" strokeWidth={1.9} aria-hidden />
            Lihat dulu
          </button>
          <button
            type="button"
            onClick={() => void jalankan(false)}
            disabled={sibuk || pending}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:opacity-50"
          >
            <DatabaseZap className="size-[18px]" strokeWidth={2.2} aria-hidden />
            {sibuk ? 'Menarik…' : 'Tarik master sekarang'}
          </button>
        </div>
      </div>

      {hasil ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            {mode === 'uji' ? 'Pemeriksaan — belum ada yang ditulis' : 'Hasil tarik'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13.5px] tabular-nums">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="pb-1 pr-4 font-semibold">Entitas</th>
                  <th className="pb-1 pr-4 text-right font-semibold">Dibaca</th>
                  <th className="pb-1 pr-4 text-right font-semibold">Baru</th>
                  <th className="pb-1 pr-4 text-right font-semibold">Diperbarui</th>
                  <th className="pb-1 pr-4 text-right font-semibold">Dinonaktifkan</th>
                  <th className="pb-1 text-right font-semibold">Dilewati</th>
                </tr>
              </thead>
              <tbody>
                {hasil.map((h) => (
                  <tr key={h.entitas} className="border-t border-line/60">
                    <td className="py-1.5 pr-4 font-medium">{h.entitas}</td>
                    <td className="py-1.5 pr-4 text-right">{h.dibaca}</td>
                    <td className="py-1.5 pr-4 text-right">{h.baru}</td>
                    <td className="py-1.5 pr-4 text-right">{h.diperbarui}</td>
                    <td
                      className={
                        h.dinonaktifkan > 0
                          ? 'py-1.5 pr-4 text-right font-semibold text-warn'
                          : 'py-1.5 pr-4 text-right'
                      }
                    >
                      {h.dinonaktifkan}
                    </td>
                    <td className="py-1.5 text-right">{h.dilewati}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Catatan dari API — mis. "tabel TM_PARTS di staging masih kosong",
              atau sebab sebuah baris dilewati. Justru ini yang menjelaskan
              kenapa angkanya nol. */}
          {hasil.some((h) => h.catatan.length > 0) ? (
            <ul className="mt-3 space-y-1 text-[13px] text-ink-muted">
              {hasil.flatMap((h) =>
                h.catatan.map((c, i) => (
                  <li key={`${h.entitas}-${i}`} className="flex items-start gap-1.5">
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-warn"
                      strokeWidth={1.9}
                      aria-hidden
                    />
                    <span>
                      <strong className="font-semibold">{h.entitas}</strong> — {c}
                    </span>
                  </li>
                )),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
