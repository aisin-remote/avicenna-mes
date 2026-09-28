'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Download, Upload, X, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import type { HasilImpor, MasterEntity } from '@avicenna/contracts';
import { imporMasterAction } from '@/app/(app)/master/actions';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

/**
 * Unduh template dan unggah Excel untuk sebuah master.
 *
 * ── Pratinjau dulu, baru simpan ─────────────────────────────────────────────
 *
 * Berkas diperiksa lebih dulu tanpa menulis apa pun, dan hasilnya ditampilkan
 * lengkap dengan nomor baris. Baru sesudah orang melihat berapa yang akan
 * masuk dan mana yang ditolak, tombol simpan muncul.
 *
 * Tanpa itu, kesalahan baru ketahuan setelah ratusan baris masuk — dan
 * membatalkannya berarti menghapus satu per satu lewat layar.
 */
export function MasterImport({
  entity,
  label,
}: {
  entity: MasterEntity;
  label: string;
}) {
  const [buka, setBuka] = useState(false);
  const [berkas, setBerkas] = useState<File | null>(null);
  const [hasil, setHasil] = useState<HasilImpor | null>(null);
  const [sibuk, mulai] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  function tutup() {
    setBuka(false);
    setBerkas(null);
    setHasil(null);
  }

  function jalankan(f: File, ujiSaja: boolean) {
    const fd = new FormData();
    fd.set('berkas', f);
    mulai(async () => {
      const r = await imporMasterAction(entity, fd, ujiSaja);
      if ('error' in r) {
        toast.galat(r.error, 'Berkas tidak bisa diproses');
        setHasil(null);
        return;
      }
      setHasil(r);
      if (!ujiSaja && r.ditulis > 0) {
        toast.ok(`${r.ditulis} baris ${label.toLowerCase()} ditambahkan.`);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <a
          href={`/master/${entity}/template`}
          className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          <Download className="size-4" strokeWidth={1.8} aria-hidden /> Template Excel
        </a>
        <button
          type="button"
          onClick={() => setBuka(true)}
          className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          <Upload className="size-4" strokeWidth={1.8} aria-hidden /> Unggah Excel
        </button>
      </div>

      <AnimatePresence>
        {buka ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={springSoft}
              role="dialog"
              aria-modal="true"
              aria-label={`Unggah Excel ${label}`}
              className="w-full max-w-2xl rounded-card border border-line bg-card p-6 shadow-shell"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[18px] font-extrabold tracking-tight">
                    Unggah Excel — {label}
                  </h2>
                  {/* Sifatnya disebut di muka, bukan ditemukan sesudahnya. */}
                  <p className="mt-1 text-[13px] leading-snug text-ink-muted">
                    Unggahan <span className="font-semibold text-ink">menambah</span> baris baru.
                    Baris yang kodenya sudah ada ditolak, tidak ditimpa — perubahan data yang sudah
                    ada dilakukan lewat layar ini, satu per satu.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={tutup}
                  aria-label="Tutup"
                  className="shrink-0 rounded-full border border-line p-1.5 text-ink-muted transition-colors hover:border-ink hover:text-ink"
                >
                  <X className="size-4" strokeWidth={2} aria-hidden />
                </button>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-card border-2 border-dashed border-line px-4 py-5 transition-colors hover:border-ink">
                <FileSpreadsheet className="size-6 shrink-0 text-ink-muted" strokeWidth={1.6} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">
                    {berkas ? berkas.name : 'Pilih berkas .xlsx'}
                  </span>
                  <span className="block text-[12px] text-ink-muted">
                    {berkas
                      ? `${(berkas.size / 1024).toFixed(0)} KB`
                      : 'Pakai template yang disediakan agar judul kolomnya cocok.'}
                  </span>
                </span>
                <input
                  ref={input}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setBerkas(f);
                    setHasil(null);
                    if (f) jalankan(f, true);
                  }}
                />
              </label>

              {sibuk ? (
                <p className="mt-3 text-[14px] text-ink-muted">memeriksa berkas…</p>
              ) : null}


              {hasil ? <Ringkasan hasil={hasil} /> : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={tutup}
                  className="rounded-full border border-line px-4 py-2 text-[14px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  {hasil && !hasil.ujiSaja ? 'Tutup' : 'Batal'}
                </button>
                {/* Tombol simpan hanya muncul setelah pratinjau menunjukkan ada
                    yang bisa masuk — tidak ada jalan menyimpan tanpa melihat. */}
                {berkas && hasil?.ujiSaja && hasil.diterima > 0 ? (
                  <button
                    type="button"
                    disabled={sibuk}
                    onClick={() => jalankan(berkas, false)}
                    className="rounded-full bg-accent px-5 py-2 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {sibuk ? 'Menyimpan…' : `Simpan ${hasil.diterima} baris`}
                  </button>
                ) : null}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function Ringkasan({ hasil }: { hasil: HasilImpor }) {
  const selesai = !hasil.ujiSaja;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: durations.base, ease: easeSoft }}
      className="mt-4"
    >
      <div
        className={cn(
          'flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-card border px-4 py-3 text-[14px]',
          selesai && hasil.ditulis > 0
            ? 'border-ok/40 bg-ok/10'
            : 'border-line bg-surface',
        )}
      >
        {selesai ? (
          <span className="flex items-center gap-2 font-semibold text-ok">
            <CheckCircle2 className="size-4" strokeWidth={2} aria-hidden />
            {hasil.ditulis} baris ditambahkan
          </span>
        ) : (
          <span className="font-semibold">
            {hasil.diterima} baris siap ditambahkan
          </span>
        )}
        {hasil.ditolak.length > 0 ? (
          <span className="text-ink-muted">
            {hasil.ditolak.length} ditolak dari {hasil.totalBaris} baris terisi
          </span>
        ) : null}
      </div>

      {hasil.ditolak.length > 0 ? (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-card border border-line">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 border-b border-line bg-card text-left text-[12px] uppercase tracking-wide text-ink-muted">
              <tr>
                {/* Nomor baris SEPERTI DI EXCEL — orang membetulkannya di sana,
                    bukan di layar ini. */}
                <th className="px-3 py-2 font-semibold">Baris</th>
                <th className="px-3 py-2 font-semibold">Kolom</th>
                <th className="px-3 py-2 font-semibold">Sebab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {hasil.ditolak.map((d, i) => (
                <tr key={`${d.baris}-${d.kolom}-${i}`}>
                  <td className="tabular px-3 py-2 font-semibold">{d.baris}</td>
                  <td className="px-3 py-2 text-ink-soft">{d.kolom ?? '—'}</td>
                  <td className="px-3 py-2">{d.sebab}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </motion.div>
  );
}
