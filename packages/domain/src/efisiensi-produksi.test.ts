import { describe, expect, it } from 'vitest';
import {
  hariProduksi,
  istirahatNyata,
  jamShift,
  jendelaShift,
  menitBersih,
  persenEfisiensi,
  persenNg,
  tanggalMulaiShift,
} from './efisiensi-produksi';

// Jam kerja PKB AIIA Pasal 22.
const S1 = { code: '1', startTime: '06:00', endTime: '14:15', startsProductionDay: true };
const S2 = { code: '2', startTime: '14:10', endTime: '22:15' };
const S3 = { code: '3', startTime: '22:10', endTime: '06:05' };
const IST1 = [
  { startTime: '09:20', endTime: '09:30' },
  { startTime: '12:00', endTime: '12:40' },
];
const IST3 = [
  { startTime: '00:30', endTime: '00:55' },
  { startTime: '04:45', endTime: '05:00' },
];

describe('waktu kerja bersih', () => {
  it('Shift I = 7 jam 25 menit, sama dengan PKB', () => {
    const j = jendelaShift('2026-11-12', S1);
    expect(menitBersih(j, istirahatNyata('2026-11-12', S1, IST1))).toBe(445);
  });

  it('Shift III menyeberang tengah malam, istirahatnya jatuh di hari berikut', () => {
    const j = jendelaShift('2026-11-12', S3);
    expect(j.sampai.getDate()).toBe(13);
    const ist = istirahatNyata('2026-11-12', S3, IST3);
    expect(ist[0]!.dari.getDate()).toBe(13);
    expect(menitBersih(j, ist)).toBe(435);
  });

  it('jam yang sedang berjalan dipotong pada sekarang', () => {
    const j = jendelaShift('2026-11-12', S1);
    const ist = istirahatNyata('2026-11-12', S1, IST1);
    // 06:00–09:45 = 225 menit, dikurangi break 09:20–09:30.
    expect(menitBersih(j, ist, new Date(2026, 10, 12, 9, 45))).toBe(215);
  });
});

describe('jamShift', () => {
  it('Shift I: delapan jam penuh lalu sisa 15 menit', () => {
    const jam = jamShift(jendelaShift('2026-11-12', S1));
    expect(jam).toHaveLength(9);
    expect(jam[0]!.label).toBe('06:00');
    expect(jam[8]!.label).toBe('14:00');
    expect((jam[8]!.sampai.getTime() - jam[8]!.dari.getTime()) / 60000).toBe(15);
  });

  it('jam ke-4 Shift I berisi break 09:20–09:30', () => {
    const jam = jamShift(jendelaShift('2026-11-12', S1));
    expect(menitBersih(jam[3]!, istirahatNyata('2026-11-12', S1, IST1))).toBe(50);
  });
});

describe('hari produksi', () => {
  const semua = [S1, S2, S3];
  it('pukul 02:00 masih hari kemarin', () => {
    expect(hariProduksi(new Date(2026, 10, 13, 2, 0), semua)).toBe('2026-11-12');
    expect(hariProduksi(new Date(2026, 10, 13, 6, 0), semua)).toBe('2026-11-13');
  });

  it('Shift III yang berjalan pukul 02:00 dimulai kemarin', () => {
    expect(tanggalMulaiShift(new Date(2026, 10, 13, 2, 0), S3)).toBe('2026-11-12');
    expect(tanggalMulaiShift(new Date(2026, 10, 12, 23, 0), S3)).toBe('2026-11-12');
  });
});

describe('persen', () => {
  it('efisiensi: 300 pcs × 60 detik dalam 445 menit', () => {
    expect(persenEfisiensi(300 * 60, 445)).toBeCloseTo(67.42, 2);
  });

  it('efisiensi kosong, bukan nol, bila belum ada waktu atau cycle time', () => {
    expect(persenEfisiensi(null, 445)).toBeNull();
    expect(persenEfisiensi(1000, 0)).toBeNull();
  });

  it('RIL dan ROL berbagi pembagi OK + seluruh NG', () => {
    expect(persenNg(2, 96, 4)).toBe(2);
    expect(persenNg(0, 0, 0)).toBeNull();
  });
});
