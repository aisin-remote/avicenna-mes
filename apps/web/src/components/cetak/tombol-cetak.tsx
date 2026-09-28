'use client';

import { Printer } from 'lucide-react';

/** Memanggil dialog cetak browser. Disembunyikan saat mencetak (lihat CSS halaman). */
export function TombolCetak() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="tanpa-cetak inline-flex h-11 items-center gap-2 rounded-full bg-black px-5 text-[14px] font-semibold text-white"
    >
      <Printer className="size-[18px]" strokeWidth={2.2} aria-hidden />
      Cetak
    </button>
  );
}
