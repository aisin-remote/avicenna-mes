'use client';

import { useRef, useState } from 'react';
import { ImagePlus, X, Loader2 } from 'lucide-react';
import { unggahFotoAction } from '@/app/(app)/master/actions';
import { urlFotoPart } from '@/lib/foto-part';
import { cn } from '../ui/cn';

/**
 * Kolom gambar di formulir master: pilih berkas, lihat hasilnya, simpan.
 *
 * ── Kenapa diunggah saat dipilih, bukan saat formulir disimpan ──────────────
 *
 * Supaya orang melihat gambarnya SEBELUM menekan Simpan. Foto part dipakai
 * operator untuk mencocokkan barang di tangannya; salah unggah yang baru
 * ketahuan setelah tersimpan berarti satu lini bekerja dengan gambar yang
 * keliru sampai ada yang menyadarinya.
 *
 * Yang tersimpan di kolom tetap teks — nama berkas yang dikembalikan server.
 * Formulir mengirimnya lewat input tersembunyi, jadi seluruh jalur simpan
 * master tidak perlu tahu-menahu soal berkas.
 */
export function BidangGambar({
  name,
  label,
  hint,
  nilaiAwal,
  error,
}: {
  name: string;
  label: string;
  hint?: string;
  nilaiAwal?: string | null;
  error?: string;
}) {
  const [nilai, setNilai] = useState<string>(nilaiAwal ?? '');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const inputBerkas = useRef<HTMLInputElement>(null);

  const url = urlFotoPart(nilai);

  async function pilih(berkas: File) {
    setSibuk(true);
    setGalat(null);
    const fd = new FormData();
    fd.append('file', berkas);
    const hasil = await unggahFotoAction(fd);
    setSibuk(false);
    if ('error' in hasil) {
      setGalat(hasil.error);
      return;
    }
    setNilai(hasil.nama);
  }

  return (
    <div>
      <label className="mb-2 block text-[14px] font-semibold">{label}</label>

      {/* Nama berkas inilah yang ikut tersimpan bersama kolom lain. */}
      <input type="hidden" name={name} value={nilai} />

      <div className="flex items-start gap-4">
        <div
          className={cn(
            'grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl border',
            url ? 'border-line bg-surface' : 'border-dashed border-line bg-surface',
          )}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-7 text-ink-muted" strokeWidth={1.6} aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            ref={inputBerkas}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Nilainya dikosongkan supaya memilih berkas yang SAMA dua kali
              // tetap memicu perubahan — kejadian biasa setelah salah pilih.
              e.target.value = '';
              if (f) void pilih(f);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputBerkas.current?.click()}
              disabled={sibuk}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:bg-surface disabled:opacity-60"
            >
              {sibuk ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              ) : (
                <ImagePlus className="size-4" strokeWidth={2} aria-hidden />
              )}
              {sibuk ? 'Mengunggah' : url ? 'Ganti gambar' : 'Pilih gambar'}
            </button>
            {url ? (
              <button
                type="button"
                onClick={() => setNilai('')}
                className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-surface hover:text-ng"
              >
                <X className="size-4" strokeWidth={2} aria-hidden />
                Hapus
              </button>
            ) : null}
          </div>

          {hint ? <p className="mt-2 text-[13px] leading-snug text-ink-muted">{hint}</p> : null}
          {galat ? <p className="mt-2 text-[13px] font-semibold text-ng">{galat}</p> : null}
          {error ? <p className="mt-2 text-[13px] font-semibold text-ng">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
