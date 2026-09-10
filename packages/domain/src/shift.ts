/**
 * Penentuan shift.
 *
 * Pola tiga shift yang dipakai di pabrik. Jam persisnya WAJIB dikonfirmasi ke
 * tim produksi sebelum dipakai di produksi — angka di bawah ini adalah
 * asumsi awal, bukan hasil verifikasi.
 *
 *   Shift 1: 07:00 - 15:00
 *   Shift 2: 15:00 - 23:00
 *   Shift 3: 23:00 - 07:00 (melewati tengah malam)
 */

export type Shift = '1' | '2' | '3';

export interface ShiftWindow {
  shift: Shift;
  startHour: number;
  endHour: number;
}

export const DEFAULT_SHIFTS: readonly ShiftWindow[] = [
  { shift: '1', startHour: 7, endHour: 15 },
  { shift: '2', startHour: 15, endHour: 23 },
  { shift: '3', startHour: 23, endHour: 7 },
];

export function resolveShift(at: Date, windows: readonly ShiftWindow[] = DEFAULT_SHIFTS): Shift {
  const hour = at.getHours();
  for (const w of windows) {
    if (w.startHour < w.endHour) {
      if (hour >= w.startHour && hour < w.endHour) return w.shift;
    } else {
      // Jendela yang melewati tengah malam.
      if (hour >= w.startHour || hour < w.endHour) return w.shift;
    }
  }
  return '1';
}

/**
 * Tanggal produksi untuk suatu waktu.
 *
 * Shift 3 yang mulai jam 23:00 masih dihitung sebagai produksi hari itu,
 * termasuk jam-jam setelah tengah malam. Tanpa aturan ini, hasil shift malam
 * terbelah ke dua tanggal dan report harian tidak pernah cocok.
 */
export function productionDate(at: Date, dayStartHour = 7): Date {
  const d = new Date(at);
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
