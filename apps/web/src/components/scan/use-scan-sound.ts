'use client';

import { useCallback, useRef } from 'react';

/**
 * Umpan balik suara untuk hasil scan.
 *
 * Di lantai produksi operator sering tidak menatap layar saat menempelkan
 * barcode — tangannya sibuk memindahkan part. Nada pendek memberi tahu hasilnya
 * tanpa perlu melihat: satu nada tinggi untuk diterima, dua nada rendah untuk
 * ditolak. Pola dua nada dipilih agar penolakan tetap terbedakan di ruangan
 * bising, bukan hanya lewat perbedaan nada.
 *
 * Memakai Web Audio API, bukan berkas audio: tidak ada aset yang perlu dimuat
 * dan bunyinya terdengar seketika.
 */
export function useScanSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  const beep = useCallback(
    (frequency: number, durationMs: number, startDelayMs = 0) => {
      if (!enabled) return;
      try {
        // AudioContext hanya boleh dibuat setelah ada interaksi pengguna;
        // pembuatannya ditunda sampai bunyi pertama benar-benar diminta.
        ctxRef.current ??= new AudioContext();
        const ctx = ctxRef.current;
        if (ctx.state === 'suspended') void ctx.resume();

        const start = ctx.currentTime + startDelayMs / 1000;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = frequency;
        // Naik-turun halus supaya tidak ada bunyi 'klik' di ujung nada.
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.01);
        gain.gain.linearRampToValueAtTime(0, start + durationMs / 1000);

        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + durationMs / 1000 + 0.02);
      } catch {
        // Audio diblokir browser bukan alasan untuk menggagalkan scan.
      }
    },
    [enabled],
  );

  const ok = useCallback(() => beep(880, 110), [beep]);
  const reject = useCallback(() => {
    beep(300, 150);
    beep(240, 200, 170);
  }, [beep]);

  return { ok, reject };
}
