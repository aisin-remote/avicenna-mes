import clsx, { type ClassValue } from 'clsx';

/** Penggabung className. Dipisah supaya mudah diganti kalau nanti pakai tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
