'use client';

import { useEffect, useState } from 'react';

/**
 * Menghitung naik dari 0 ke `target`.
 *
 * Nilai awalnya adalah `target`, BUKAN nol — ini penting. Render di server
 * menghasilkan angka yang benar, sehingga kalau JavaScript gagal jalan
 * pengguna tetap melihat angka sesungguhnya, bukan 0. Animasi baru mengambil
 * alih setelah komponen hidup di browser.
 *
 * Menghormati prefers-reduced-motion: bila pengguna meminta gerak dikurangi,
 * angkanya langsung ditampilkan tanpa animasi.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setValue(target);
      return;
    }

    let frame = 0;
    const start = performance.now();
    setValue(0);

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
