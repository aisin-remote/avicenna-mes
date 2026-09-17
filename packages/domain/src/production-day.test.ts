import { describe, it, expect } from 'vitest';
import { productionDayWindow, productionDateKey } from './shift';

/** Membentuk Date waktu lokal, supaya test tidak bergantung zona waktu mesin. */
const lokal = (y: number, m: number, d: number, h: number, mi = 0) =>
  new Date(y, m - 1, d, h, mi, 0, 0);

describe('productionDayWindow', () => {
  it('siang hari: jendela mulai jam 7 pagi hari itu', () => {
    const { start, end, key } = productionDayWindow(lokal(2026, 9, 17, 14));
    expect(key).toBe('2026-09-17');
    expect(start.getDate()).toBe(17);
    expect(start.getHours()).toBe(7);
    expect(end.getDate()).toBe(18);
    expect(end.getHours()).toBe(7);
  });

  it('dini hari masih masuk hari produksi kemarin', () => {
    const { key } = productionDayWindow(lokal(2026, 9, 17, 2));
    expect(key).toBe('2026-09-16');
  });

  it('scan dini hari BERADA di dalam jendelanya sendiri', () => {
    /*
     * Inilah cacat yang diperbaiki. Sebelumnya jendelanya dibentuk dari
     * tanggal produksi ditambah rentang 00:00-23:59, sehingga scan pukul 02:00
     * jatuh DI LUAR jendelanya sendiri dan penghitung operator shift malam
     * berhenti bertambah.
     */
    const saatScan = lokal(2026, 9, 17, 2);
    const { start, end } = productionDayWindow(saatScan);
    expect(saatScan >= start).toBe(true);
    expect(saatScan < end).toBe(true);
  });

  it('cara lama memang meleset — pembanding, bukan perilaku sekarang', () => {
    const saatScan = lokal(2026, 9, 17, 2);
    const kunci = productionDateKey(saatScan);
    const mulaiLama = new Date(`${kunci}T00:00:00`);
    const akhirLama = new Date(`${kunci}T23:59:59.999`);
    expect(saatScan > akhirLama).toBe(true);
    expect(mulaiLama.getDate()).toBe(16);
  });

  it('tepat jam 7 pagi memulai hari produksi baru', () => {
    expect(productionDayWindow(lokal(2026, 9, 17, 7)).key).toBe('2026-09-17');
    expect(productionDayWindow(lokal(2026, 9, 17, 6, 59)).key).toBe('2026-09-16');
  });

  it('jam mulai bisa diubah untuk pabrik yang berbeda', () => {
    const { start, key } = productionDayWindow(lokal(2026, 9, 17, 5), 4);
    expect(key).toBe('2026-09-17');
    expect(start.getHours()).toBe(4);
  });

  it('jendelanya tepat 24 jam', () => {
    const { start, end } = productionDayWindow(lokal(2026, 9, 17, 14));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
