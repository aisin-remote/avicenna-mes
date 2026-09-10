'use client';

import { useCountUp } from './use-count-up';

/**
 * Menampilkan angka yang menghitung naik.
 *
 * Sengaja dipisah sekecil ini supaya kartu yang memuatnya tetap bisa menjadi
 * Server Component — hanya angkanya yang butuh berjalan di browser.
 */
export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}
