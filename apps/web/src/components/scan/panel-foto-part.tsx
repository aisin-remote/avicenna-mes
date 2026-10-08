'use client';

import { ImageOff, ScanLine } from 'lucide-react';
import type { SampleCheck } from '@avicenna/contracts';
import { urlFotoPart } from '@/lib/foto-part';
import { cn } from '../ui/cn';

/**
 * Foto part yang sedang dikerjakan — slot tetap di layar lini per-kanban.
 *
 * ── Kenapa punya tempat sendiri, bukan menumpang panel status ───────────────
 *
 * Panel status berganti isi tiap scan (OK, SUDAH DISCAN, DITOLAK). Foto yang
 * ditaruh di sana hanya terlihat sekejap sebelum scan pertama, lalu tertutup
 * selamanya — padahal justru sepanjang shift itulah operator membutuhkannya:
 * barang di BODY tidak berseri, dan kartu baru discan setelah box penuh, jadi
 * mencocokkan barang dengan gambar adalah satu-satunya pemeriksaan sebelum
 * barang masuk box.
 *
 * Slotnya selalu ada — juga saat belum ada sample atau fotonya belum diisi —
 * supaya kekosongannya terlihat sebagai sesuatu yang harus dibereskan, bukan
 * sebagai layar yang memang tidak punya gambar.
 */
export function PanelFotoPart({
  sample,
  className,
}: {
  sample: SampleCheck | null;
  className?: string;
}) {
  const foto = urlFotoPart(sample?.photoPath);

  return (
    <section className={cn('flex flex-col rounded-card border border-line bg-card p-5', className)}>
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Foto part
        </h2>
        {sample ? (
          <span className="tabular truncate text-[13px] font-bold">
            {sample.partNumber}
            {sample.backNumber ? ` (${sample.backNumber})` : ''}
          </span>
        ) : null}
      </header>

      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-surface p-3">
        {foto ? (
          /* Sebesar yang muat: dilihat sambil tangan memegang barang. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={foto}
            alt={`Foto ${sample?.partNumber ?? 'part'}`}
            className="max-h-full w-auto rounded-xl object-contain"
          />
        ) : sample ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <ImageOff className="size-10 text-ink-muted" strokeWidth={1.5} aria-hidden />
            <p className="text-[14px] font-semibold">Foto part ini belum diisi</p>
            <p className="max-w-sm text-[13px] text-ink-muted">
              Isi di Master Data › Part, kolom Foto Part. Tanpa gambar, operator tidak punya
              pembanding sebelum barang masuk box.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <ScanLine className="size-10 text-ink-muted" strokeWidth={1.4} aria-hidden />
            <p className="text-[14px] font-semibold text-ink-muted">
              Scan master sample untuk menampilkan fotonya
            </p>
          </div>
        )}
      </div>

      {sample ? (
        <p className="mt-3 shrink-0 truncate text-[13px] text-ink-soft">
          {sample.partName}
          {sample.qtyPerKanban ? ` · ${sample.qtyPerKanban} pcs per kanban` : ''}
        </p>
      ) : null}
    </section>
  );
}
