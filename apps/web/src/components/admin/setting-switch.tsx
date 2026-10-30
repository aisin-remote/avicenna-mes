'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Database, RotateCw, Settings2 } from 'lucide-react';
import type { DefinisiPengaturan, NilaiPengaturan } from '@avicenna/contracts';
import { ubahPengaturanAction } from '@/app/(app)/admin/pengaturan/actions';
import { useToast } from '@/components/ui/toast';

/**
 * Satu saklar pengaturan sistem.
 *
 * ── Kenapa peringatannya dikonfirmasi, dan hanya saat MENYALAKAN ────────────
 *
 * Sebagian saklar punya akibat yang tidak bisa dibatalkan dengan mematikannya
 * lagi — menyalakan tarik master akan menimpa ketikan orang di layar master,
 * dan ketikan itu tidak kembali saat saklarnya dimatikan. Jadi menyalakan
 * menuntut konfirmasi, sedangkan mematikan tidak: menghalangi orang mematikan
 * sesuatu yang sedang bermasalah adalah hal terakhir yang boleh dilakukan
 * layar ini.
 */
export function SettingSwitch({ def, nilai }: { def: DefinisiPengaturan; nilai: NilaiPengaturan }) {
  const toast = useToast();
  const [pending, mulai] = useTransition();
  /* Keadaan optimis supaya saklarnya bergerak saat diklik, bukan setelah
     balasan server datang. Dikembalikan bila server menolak. */
  const [tampak, setTampak] = useState(nilai.nilai);
  const [mintaKonfirmasi, setMintaKonfirmasi] = useState(false);

  function kirim(baru: boolean) {
    setMintaKonfirmasi(false);
    const sebelum = tampak;
    setTampak(baru);
    mulai(async () => {
      const hasil = await ubahPengaturanAction(def.key, baru);
      if (hasil.error) {
        setTampak(sebelum);
        toast.galat(hasil.error, def.label);
        return;
      }
      if (def.berlaku === 'perlu-restart') {
        toast.warn(`Tersimpan, tetapi baru berlaku setelah API di-restart.`, def.label);
      } else {
        toast.ok(baru ? 'Dinyalakan' : 'Dimatikan', def.label);
      }
    });
  }

  function diklik() {
    const menyalakan = !tampak;
    if (menyalakan && def.peringatan) {
      setMintaKonfirmasi(true);
      return;
    }
    kirim(menyalakan);
  }

  const asal =
    nilai.sumber === 'tabel'
      ? `diubah ${nilai.diubahOleh ?? 'seseorang'}${
          nilai.diubahPada ? ` · ${nilai.diubahPada.slice(0, 16).replace('T', ' ')}` : ''
        }`
      : nilai.sumber === 'env'
        ? `dari .env (${def.env})`
        : 'bawaan sistem';

  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{def.label}</span>
            {def.berlaku === 'perlu-restart' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <RotateCw className="size-3" strokeWidth={2.2} aria-hidden />
                perlu restart
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-muted">
            {def.deskripsi}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
            {nilai.sumber === 'tabel' ? (
              <Database className="size-3.5" strokeWidth={1.8} aria-hidden />
            ) : (
              <Settings2 className="size-3.5" strokeWidth={1.8} aria-hidden />
            )}
            {asal}
            <code className="ml-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[11px]">
              {def.key}
            </code>
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={tampak}
          aria-label={def.label}
          disabled={pending}
          onClick={diklik}
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-50 ${
            tampak ? 'border-ok bg-ok' : 'border-line bg-surface'
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-card shadow-sm transition-all duration-200 ${
              tampak ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {mintaKonfirmasi && def.peringatan ? (
        <div className="mt-3 rounded-2xl border border-ng/40 bg-ng/5 p-4">
          <p className="flex items-start gap-2 text-[13.5px] leading-relaxed">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-ng" strokeWidth={2} aria-hidden />
            <span>{def.peringatan}</span>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => kirim(true)}
              className="h-9 rounded-full bg-ink px-4 text-[13.5px] font-semibold text-card transition-opacity duration-200 hover:opacity-90"
            >
              Saya mengerti, nyalakan
            </button>
            <button
              type="button"
              onClick={() => setMintaKonfirmasi(false)}
              className="h-9 rounded-full border border-line px-4 text-[13.5px] font-semibold transition-colors duration-200 hover:border-line-strong"
            >
              Batal
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
