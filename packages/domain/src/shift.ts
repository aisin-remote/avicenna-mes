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

/**
 * Mengubah Date menjadi kunci "YYYY-MM-DD" memakai komponen waktu LOKAL.
 *
 * JANGAN memakai `toISOString().slice(0, 10)` untuk ini. Fungsi itu mengubah
 * ke UTC lebih dulu, sehingga tengah malam waktu Jakarta (UTC+7) menjadi
 * pukul 17:00 hari SEBELUMNYA dalam UTC — dan setiap tanggal produksi mundur
 * satu hari. Kesalahan seperti itu tidak terlihat sampai laporan harian
 * dibandingkan dengan hitungan manual orang lapangan.
 */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Tanggal produksi langsung sebagai kunci "YYYY-MM-DD" waktu lokal. */
export function productionDateKey(at: Date, dayStartHour = 7): string {
  return toLocalDateKey(productionDate(at, dayStartHour));
}

/** Kunci tanggal sehari sebelum `date` ("YYYY-MM-DD" lokal). */
export function previousDateKey(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return toLocalDateKey(d);
}

/**
 * Rentang waktu satu HARI PRODUKSI — bukan satu hari kalender.
 *
 * Hari produksi mulai pukul `dayStartHour` dan berakhir 24 jam kemudian, jadi
 * shift malam yang melewati tengah malam tetap dihitung ke hari yang sama.
 *
 * ── Kesalahan yang dicegah fungsi ini ───────────────────────────────────────
 *
 * Menggabungkan `productionDateKey()` dengan rentang 00:00–23:59 terlihat benar
 * tetapi tidak konsisten: pada pukul 02:00, tanggal produksinya masih hari
 * kemarin, sementara rentang 00:00–23:59 hari kemarin justru TIDAK memuat scan
 * yang sedang terjadi. Akibatnya penghitung di layar operator shift malam
 * berhenti bertambah, dan tidak ada yang tahu sebabnya.
 */
export function productionDayWindow(
  at: Date,
  dayStartHour = 7,
): { start: Date; end: Date; key: string } {
  const start = productionDate(at, dayStartHour);
  start.setHours(dayStartHour, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end, key: productionDateKey(at, dayStartHour) };
}
