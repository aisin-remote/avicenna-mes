import { describe, it, expect } from 'vitest';
import { buildReceiptNumber, buildLotNumber, needsLot } from './receiving';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10, 0, 0);

describe('buildReceiptNumber', () => {
  it('memuat tanggal agar mudah ditelusuri', () => {
    expect(buildReceiptNumber(at(2026, 9, 10), 1)).toBe('RCV-20260910-0001');
  });

  it('urutan diberi nol di depan', () => {
    expect(buildReceiptNumber(at(2026, 9, 10), 42)).toBe('RCV-20260910-0042');
    expect(buildReceiptNumber(at(2026, 9, 10), 1234)).toBe('RCV-20260910-1234');
  });

  it('memakai tanggal lokal, bukan UTC', () => {
    // Jam 10 pagi WIB tanggal 10 tetap tanggal 10, tidak mundur ke 9.
    expect(buildReceiptNumber(at(2026, 9, 10), 1)).toContain('20260910');
  });
});

describe('buildLotNumber', () => {
  it('memakai nomor lot supplier bila ada', () => {
    expect(
      buildLotNumber({ partNumber: 'CMP-B-001', supplierLotNumber: 'SL-2026-77', at: at(2026, 9, 10), sequenceToday: 1 }),
    ).toBe('CMP-B-001-SL-2026-77');
  });

  it('memberi prefiks part agar nomor supplier yang sama antar part tidak bertabrakan', () => {
    const b = buildLotNumber({ partNumber: 'CMP-B-001', supplierLotNumber: 'L1', at: at(2026, 9, 10), sequenceToday: 1 });
    const c = buildLotNumber({ partNumber: 'CMP-C-001', supplierLotNumber: 'L1', at: at(2026, 9, 10), sequenceToday: 1 });
    expect(b).not.toBe(c);
  });

  it('membuat nomor sendiri bila supplier tidak menyertakan', () => {
    expect(
      buildLotNumber({ partNumber: 'RM-D-001', at: at(2026, 9, 10), sequenceToday: 3 }),
    ).toBe('RM-D-001-20260910-003');
  });

  it('mengabaikan nomor supplier yang hanya berisi spasi', () => {
    expect(
      buildLotNumber({ partNumber: 'RM-D-001', supplierLotNumber: '   ', at: at(2026, 9, 10), sequenceToday: 1 }),
    ).toBe('RM-D-001-20260910-001');
  });

  it('memotong pada 64 karakter agar muat di kolom', () => {
    const out = buildLotNumber({
      partNumber: 'P'.repeat(60),
      supplierLotNumber: 'S'.repeat(60),
      at: at(2026, 9, 10),
      sequenceToday: 1,
    });
    expect(out.length).toBe(64);
  });
});

describe('needsLot', () => {
  it('hanya part yang dilacak per lot', () => {
    expect(needsLot('LOT')).toBe(true);
    expect(needsLot('SERIAL')).toBe(false);
    expect(needsLot('QUANTITY')).toBe(false);
  });
});
