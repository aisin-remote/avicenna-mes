'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Umpan balik suara untuk hasil scan.
 *
 * Di lantai produksi operator sering tidak menatap layar saat menempelkan
 * barcode — tangannya sibuk memindahkan part. Suaranya memberi tahu hasilnya
 * tanpa perlu melihat.
 *
 * Rekamannya sama dengan sistem yang sudah dikenal operator (Handika,
 * 26 Nov 2026): `ok` dan `notMatch` dari stasiun PIS, sisanya dari layar
 * produksi bella (`prdreport`) dengan arti yang sama di sana:
 *
 *   ok          scan diterima
 *   koneksi     server tidak terjangkau            errConnection.mp3
 *   kanban      kartu/label kanban salah            wrongKanban.mp3
 *   duplikat    barang/kanban sudah pernah discan  already-scan.mp3
 *   dandori     QR dandori ditolak                  dandori_error.mp3
 *   sample      master sample tidak sesuai          master_dandori_error.mp3
 *   tolak       penolakan lain                      notMatch.mp3
 *
 * Semua rekaman dimuat saat layar dibuka. Bila rekaman gagal diputar (file
 * belum termuat, autoplay diblokir), bunyi nada Web Audio menjadi cadangan:
 * satu nada tinggi untuk diterima, dua nada rendah untuk ditolak.
 */
const REKAMAN = {
  ok: '/sounds/pis/ok.mp3',
  tolak: '/sounds/pis/notMatch.mp3',
  koneksi: '/sounds/scan/errConnection.mp3',
  kanban: '/sounds/scan/wrongKanban.mp3',
  duplikat: '/sounds/scan/already-scan.mp3',
  dandori: '/sounds/scan/dandori_error.mp3',
  sample: '/sounds/scan/master_dandori_error.mp3',
} as const;

export type JenisTolak = Exclude<keyof typeof REKAMAN, 'ok'>;

/** Pesan galat server action ketika server sama sekali tidak terjangkau. */
export function galatKoneksi(pesan: string | null | undefined): boolean {
  return Boolean(pesan?.startsWith('Tidak bisa menghubungi server'));
}

/** Jenis suara penolakan dari kode alasan scan (REJECT_MESSAGES). */
export function jenisTolakDariAlasan(
  status: string | undefined,
  alasan: string | undefined,
): JenisTolak {
  if (status === 'DUPLICATE' || alasan === 'DUPLICATE' || alasan === 'KANBAN_ALREADY_PRODUCED') {
    return 'duplikat';
  }
  if (alasan === 'DANDORI_REQUIRED' || alasan === 'DANDORI_MODEL_MISMATCH') return 'dandori';
  if (
    alasan?.startsWith('KANBAN_') ||
    alasan?.startsWith('DN_') ||
    alasan?.startsWith('CUSTOMER_')
  ) {
    return 'kanban';
  }
  return 'tolak';
}

export function useScanSound(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<Partial<Record<keyof typeof REKAMAN, HTMLAudioElement>>>({});
  /** Rekaman yang sedang berbunyi — dihentikan bila hasil berikutnya datang. */
  const berbunyiRef = useRef<HTMLAudioElement | null>(null);

  // Dimuat saat layar dibuka, supaya scan pertama tidak menunggu unduhan.
  useEffect(() => {
    if (!enabled) return;
    for (const [nama, src] of Object.entries(REKAMAN)) {
      const kunci = nama as keyof typeof REKAMAN;
      if (audioRef.current[kunci]) continue;
      const audio = new Audio(src);
      audio.preload = 'auto';
      audioRef.current[kunci] = audio;
    }
  }, [enabled]);

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

  const nadaOk = useCallback(() => beep(880, 110), [beep]);
  const nadaTolak = useCallback(() => {
    beep(300, 150);
    beep(240, 200, 170);
  }, [beep]);

  const putar = useCallback(
    (nama: keyof typeof REKAMAN, cadangan: () => void) => {
      if (!enabled) return;
      try {
        let audio = audioRef.current[nama];
        if (!audio) {
          audio = new Audio(REKAMAN[nama]);
          audioRef.current[nama] = audio;
        }
        // Hasil baru menggantikan suara hasil sebelumnya; rekaman penolakan
        // yang panjang tidak boleh menimpa bunyi OK scan berikutnya.
        const lama = berbunyiRef.current;
        if (lama && lama !== audio) lama.pause();
        audio.currentTime = 0;
        berbunyiRef.current = audio;
        void audio.play().catch(cadangan);
      } catch {
        cadangan();
      }
    },
    [enabled],
  );

  const ok = useCallback(() => putar('ok', nadaOk), [putar, nadaOk]);
  const reject = useCallback(
    (jenis: JenisTolak = 'tolak') => putar(jenis, nadaTolak),
    [putar, nadaTolak],
  );

  return { ok, reject };
}
