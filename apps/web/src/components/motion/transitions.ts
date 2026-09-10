import type { Transition } from 'motion/react';

/**
 * Kosakata gerak bersama.
 *
 * Semua animasi berbasis JavaScript memakai kurva dan durasi dari sini, supaya
 * terasa berasal dari satu sistem — bukan kumpulan efek yang berbeda-beda.
 *
 * Catatan pembagian tugas:
 *   - Kemunculan konten (halaman, kartu, baris) memakai animasi CSS di
 *     globals.css, agar tetap terlihat walau JavaScript gagal dimuat.
 *   - Berkas ini hanya untuk gerak yang mustahil tanpa JavaScript: pil
 *     navigasi yang meluncur, umpan balik sentuh, dropdown, dan baris
 *     realtime yang masuk-keluar.
 *
 * Prinsipnya: gerak harus terasa selesai sebelum mata sempat menunggu. Di atas
 * ~400ms mulai terasa lambat pada layar yang dipakai bekerja seharian.
 */

/** Kurva utama: cepat di awal, mendarat halus. */
export const easeSoft = [0.22, 1, 0.36, 1] as const;

export const springSoft: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.8,
};

/** Untuk indikator yang berpindah posisi (pil nav aktif). */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 460,
  damping: 38,
  mass: 0.7,
};

export const durations = {
  fast: 0.16,
  base: 0.26,
  slow: 0.38,
} as const;
