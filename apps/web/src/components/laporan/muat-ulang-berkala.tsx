'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Menyegarkan halaman server tiap `detik` selama `aktif` — dashboard shift
 * yang sedang berjalan. router.refresh() menjaga posisi gulir dan isi
 * formulir; halaman tidak berkedip.
 */
export function MuatUlangBerkala({ aktif, detik = 60 }: { aktif: boolean; detik?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!aktif) return;
    const t = setInterval(() => router.refresh(), detik * 1000);
    return () => clearInterval(t);
  }, [aktif, detik, router]);
  return null;
}
