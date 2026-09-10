import { describe, it, expect } from 'vitest';
import { resolveShift, productionDate } from './shift';

/** Waktu lokal — resolveShift memakai jam lokal, bukan UTC. */
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe('resolveShift', () => {
  it('memetakan jam ke shift yang benar', () => {
    expect(resolveShift(local(2026, 9, 10, 7, 0))).toBe('1');
    expect(resolveShift(local(2026, 9, 10, 14, 59))).toBe('1');
    expect(resolveShift(local(2026, 9, 10, 15, 0))).toBe('2');
    expect(resolveShift(local(2026, 9, 10, 22, 59))).toBe('2');
    expect(resolveShift(local(2026, 9, 10, 23, 0))).toBe('3');
  });

  it('menangani shift 3 yang melewati tengah malam', () => {
    expect(resolveShift(local(2026, 9, 11, 0, 30))).toBe('3');
    expect(resolveShift(local(2026, 9, 11, 6, 59))).toBe('3');
  });
});

describe('productionDate', () => {
  it('menghitung jam dini hari sebagai produksi hari sebelumnya', () => {
    // Shift 3 mulai 10 Sep 23:00; jam 02:00 tanggal 11 masih produksi tanggal 10.
    const result = productionDate(local(2026, 9, 11, 2, 0));
    expect(result.getDate()).toBe(10);
    expect(result.getMonth()).toBe(8);
  });

  it('jam kerja siang tetap di tanggal berjalan', () => {
    expect(productionDate(local(2026, 9, 10, 13, 0)).getDate()).toBe(10);
  });

  it('mengembalikan tengah malam supaya aman dipakai sebagai kunci grup', () => {
    const d = productionDate(local(2026, 9, 10, 13, 45));
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });
});
