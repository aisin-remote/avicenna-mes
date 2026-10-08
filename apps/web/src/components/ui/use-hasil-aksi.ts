'use client';

import { useEffect, useRef } from 'react';

/**
 * Menjalankan penangan SEKALI untuk setiap hasil Server Action.
 *
 * ── Kenapa ini perlu ────────────────────────────────────────────────────────
 *
 * `useActionState` menyimpan hasil terakhirnya: sesudah simpan berhasil,
 * `state.ok` tetap bernilai true sampai aksi berikutnya dijalankan. Efek yang
 * dituliskan apa adanya —
 *
 *     useEffect(() => { if (state.ok) { onClose(); router.refresh(); } },
 *               [state, onClose, router, toast]);
 *
 * — akan berjalan lagi setiap kali SALAH SATU dependensinya berubah identitas,
 * bukan hanya saat ada hasil baru. Dan `onClose` yang ditulis sebagai arrow di
 * dalam JSX memang berubah tiap render. Akibatnya melingkar: simpan →
 * `router.refresh()` → induknya render ulang → `onClose` baru → efek jalan lagi
 * → `state.ok` MASIH true → refresh lagi, terus-menerus. Halamannya tetap
 * terlihat normal; yang terjadi hanya ratusan permintaan beruntun ke server.
 *
 * Penangan di sini dipicu oleh PERUBAHAN IDENTITAS state — dan `useActionState`
 * mengembalikan objek baru tiap kali aksi selesai. Dengan begitu satu hasil
 * ditangani tepat sekali, apa pun yang terjadi pada dependensi lain.
 *
 * Hasil awal (sebelum aksi pertama) ikut terlewat satu kali, dan itu memang
 * tidak apa-apa: isinya kosong, tidak ada yang perlu ditangani.
 */
export function useHasilAksi<T>(state: T, tangani: (hasil: T) => void): void {
  const terakhir = useRef<T | null>(null);
  /*
   * Penangan disimpan di ref, bukan dijadikan dependensi: isinya selalu
   * closure baru tiap render, dan menjadikannya dependensi mengembalikan
   * persoalan yang sama persis.
   */
  const penangan = useRef(tangani);
  penangan.current = tangani;

  useEffect(() => {
    if (terakhir.current === state) return;
    terakhir.current = state;
    penangan.current(state);
  }, [state]);
}
