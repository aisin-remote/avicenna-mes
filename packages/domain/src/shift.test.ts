import { describe, it, expect } from 'vitest';
import {
  resolveShift,
  productionDate,
  toLocalDateKey,
  productionDateKey,
  previousDateKey,
} from './shift';

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

describe('toLocalDateKey', () => {
  it('memakai komponen waktu lokal, bukan UTC', () => {
    // Di zona UTC+ (mis. Asia/Jakarta), tengah malam lokal adalah sore hari
    // sebelumnya dalam UTC. Kunci tanggal harus tetap mengikuti kalender lokal.
    const tengahMalam = local(2026, 9, 10, 0, 0);
    expect(toLocalDateKey(tengahMalam)).toBe('2026-09-10');
  });

  it('menjaga nol di depan', () => {
    expect(toLocalDateKey(local(2026, 1, 5, 12, 0))).toBe('2026-01-05');
  });

  it('konsisten sepanjang hari', () => {
    for (const jam of [0, 6, 7, 12, 18, 23]) {
      expect(toLocalDateKey(local(2026, 9, 10, jam, 30))).toBe('2026-09-10');
    }
  });
});

describe('productionDateKey', () => {
  it('scan sore hari tetap di tanggal berjalan', () => {
    // Regresi: sebelumnya memakai toISOString().slice(0,10), sehingga scan
    // pukul 16:47 WIB tanggal 10 tercatat sebagai tanggal 9.
    expect(productionDateKey(local(2026, 9, 10, 16, 47))).toBe('2026-09-10');
  });

  it('shift 3 setelah tengah malam masuk tanggal sebelumnya', () => {
    expect(productionDateKey(local(2026, 9, 11, 2, 0))).toBe('2026-09-10');
  });

  it('tepat di batas jam 07:00 sudah masuk hari baru', () => {
    expect(productionDateKey(local(2026, 9, 11, 6, 59))).toBe('2026-09-10');
    expect(productionDateKey(local(2026, 9, 11, 7, 0))).toBe('2026-09-11');
  });

  it('cocok dengan kalender lokal apa pun zona waktunya', () => {
    const at = local(2026, 9, 10, 20, 0);
    const harapan = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    expect(productionDateKey(at)).toBe(harapan);
  });
});

describe('previousDateKey', () => {
  it('mundur satu hari', () => {
    expect(previousDateKey('2026-09-10')).toBe('2026-09-09');
  });

  it('menangani pergantian bulan', () => {
    expect(previousDateKey('2026-09-01')).toBe('2026-08-31');
  });

  it('menangani pergantian tahun', () => {
    expect(previousDateKey('2026-01-01')).toBe('2025-12-31');
  });

  it('menangani tahun kabisat', () => {
    expect(previousDateKey('2028-03-01')).toBe('2028-02-29');
  });
});
