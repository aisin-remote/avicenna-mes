import { describe, expect, it } from 'vitest';
import { katalogProses, type JenisProses } from '@avicenna/contracts';
import { masalahBarisRute, prosesDariWorkCenter } from './rute-work-center';

const jenis = (code: string, processGroup: string, sapClass: string): JenisProses =>
  ({ code, label: code, processGroup, sapClass, scanMode: 'PART_SAJA', isActive: true, sortOrder: 0 }) as JenisProses;

const katalog = katalogProses([
  jenis('CASTING_WIP', 'CASTING', 'SFG'),
  jenis('CASTING_FG', 'CASTING', 'FG'),
  jenis('ASSEMBLING_UNIT_FG', 'ASSEMBLING', 'FG'),
  jenis('ASSEMBLING_BODY_FG', 'ASSEMBLING', 'FG'),
  jenis('MOUNTING', 'MOUNTING', 'SFG'),
]);

describe('prosesDariWorkCenter', () => {
  it('line campuran mengikuti SLOC tujuan', () => {
    expect(prosesDariWorkCenter(katalog, 'CASTING_FG', 'WIP')).toBe('CASTING_WIP');
    expect(prosesDariWorkCenter(katalog, 'CASTING_WIP', 'FINISH_GOOD')).toBe('CASTING_FG');
  });

  it('proses milik line tetap dipakai kalau kelasnya sudah cocok', () => {
    expect(prosesDariWorkCenter(katalog, 'CASTING_FG', 'FINISH_GOOD')).toBe('CASTING_FG');
    expect(prosesDariWorkCenter(katalog, 'ASSEMBLING_BODY_FG', 'FINISH_GOOD')).toBe(
      'ASSEMBLING_BODY_FG',
    );
  });

  it('tujuan kosong atau bukan WIP/FG tidak mengubah proses', () => {
    expect(prosesDariWorkCenter(katalog, 'CASTING_FG', null)).toBe('CASTING_FG');
    expect(prosesDariWorkCenter(katalog, 'CASTING_FG', 'WAREHOUSE')).toBe('CASTING_FG');
  });

  it('kelompok tanpa pasangan kelas tidak mengarang proses', () => {
    expect(prosesDariWorkCenter(katalog, 'MOUNTING', 'FINISH_GOOD')).toBe('MOUNTING');
  });
});

describe('masalahBarisRute', () => {
  const lengkap = {
    processType: 'CASTING_WIP',
    lineId: 1,
    lineCode: 'DCAA08',
    workCenter: 'DCAA08',
    inputLocationId: 10,
    outputLocationId: 11,
    scanMode: 'PART_SAJA',
  };

  it('baris lengkap tidak punya masalah', () => {
    expect(masalahBarisRute(lengkap)).toEqual([]);
  });

  it('menagih work center, SLOC, dan metode yang kosong', () => {
    expect(
      masalahBarisRute({
        ...lengkap,
        lineId: null,
        lineCode: null,
        workCenter: null,
        inputLocationId: null,
        outputLocationId: null,
        scanMode: null,
      }),
    ).toEqual([
      'Work center belum diisi',
      'SLOC asal kosong',
      'SLOC tujuan kosong',
      'Metode scan kosong',
    ]);
  });

  it('line tanpa kode SAP disebut namanya', () => {
    expect(masalahBarisRute({ ...lengkap, lineCode: 'INJ-01', workCenter: null })).toEqual([
      'Line INJ-01 belum punya kode work center SAP',
    ]);
  });

  it('Delivery tidak ditagih work center dan SLOC', () => {
    expect(
      masalahBarisRute({
        ...lengkap,
        processType: 'DELIVERY',
        lineId: null,
        lineCode: null,
        workCenter: null,
        inputLocationId: null,
        outputLocationId: null,
      }),
    ).toEqual([]);
  });
});
