import { describe, expect, it } from 'vitest';
import { katalogProses, type JenisProses } from '@avicenna/contracts';
import { masalahBarisRute, pilihBarisRute, prosesDariWorkCenter } from './rute-work-center';

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

describe('pilihBarisRute', () => {
  const dc08 = { id: 1, lineId: 8, processType: 'CASTING_WIP' };
  const dc01 = { id: 2, lineId: 1, processType: 'CASTING_WIP' };
  const tanpaLine = { id: 3, lineId: null, processType: 'MACHINING_WIP' };

  it('memilih baris milik line, termasuk work center alternatif', () => {
    expect(pilihBarisRute([dc08, dc01], 1, 'CASTING_FG')).toBe(dc01);
    expect(pilihBarisRute([dc08, dc01], 8, 'CASTING_FG')).toBe(dc08);
  });

  it('baris tanpa line dipakai hanya bila prosesnya sama', () => {
    expect(pilihBarisRute([tanpaLine], 5, 'MACHINING_WIP')).toBe(tanpaLine);
    expect(pilihBarisRute([tanpaLine], 5, 'CASTING_WIP')).toBeUndefined();
  });

  it('baris milik line lain berarti di luar rute', () => {
    expect(pilihBarisRute([dc08], 1, 'CASTING_WIP')).toBeUndefined();
    expect(pilihBarisRute([], 1, 'CASTING_WIP')).toBeUndefined();
  });

  it('scan tanpa line tidak memakai baris yang punya line', () => {
    expect(pilihBarisRute([dc08, tanpaLine], null, 'MACHINING_WIP')).toBe(tanpaLine);
    expect(pilihBarisRute([dc08], undefined, 'CASTING_WIP')).toBeUndefined();
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
