import { describe, expect, it } from 'vitest';
import { akarBom, ratakanPohonBom, type BarisBomSap } from './pohon-bom';

const b = (induk: string, komponen: string, v: Partial<BarisBomSap> = {}): BarisBomSap => ({
  induk,
  komponen,
  qty: 1,
  uom: 'PCS',
  source: null,
  sloc: null,
  phantom: null,
  ...v,
});

describe('akarBom', () => {
  it('hanya part yang menunjuk dirinya sendiri', () => {
    expect(akarBom([b('FG2', 'FG2'), b('FG1', 'FG1'), b('FG1', 'A'), b('A', 'B')])).toEqual([
      'FG1',
      'FG2',
    ]);
  });
});

describe('ratakanPohonBom', () => {
  it('sub-assy bersama dirinci di setiap FG yang memakainya', () => {
    const data = [b('F1', 'F1'), b('F2', 'F2'), b('F1', 'S'), b('F2', 'S'), b('S', 'X', { qty: 4 })];
    expect(ratakanPohonBom(data, 'F2').map((s) => [s.kunci, s.kedalaman, s.qty])).toEqual([
      ['F2', 0, 1],
      ['F2>S', 1, 1],
      ['F2>S>X', 2, 4],
    ]);
  });

  it('membaca tanda phantom', () => {
    const data = [b('F', 'F'), b('F', 'P', { phantom: 'X' }), b('F', 'Q')];
    expect(ratakanPohonBom(data, 'F').map((s) => s.phantom)).toEqual([false, true, false]);
  });

  it('data melingkar berhenti', () => {
    const data = [b('F', 'F'), b('F', 'A'), b('A', 'B'), b('B', 'A')];
    expect(ratakanPohonBom(data, 'F').map((s) => s.partNumber)).toEqual(['F', 'A', 'B']);
  });

  it('part yang tidak ada di BOM menghasilkan kosong', () => {
    expect(ratakanPohonBom([b('F', 'F')], 'Z')).toEqual([]);
  });
});
