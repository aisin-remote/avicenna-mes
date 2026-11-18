import { describe, expect, it } from 'vitest';
import { akarBom, pasanganDariBom, ratakanPohonBom, type BarisBomSap } from './pohon-bom';

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
    const data = [
      b('F1', 'F1'),
      b('F2', 'F2'),
      b('F1', 'S'),
      b('F2', 'S'),
      b('S', 'X', { qty: 4 }),
    ];
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

describe('pasanganDariBom', () => {
  const master: Record<string, number> = { FG: 1, MA: 2, DC: 3, ING: 4, SUB: 5 };
  const cari = (pn: string) => (master[pn] ? { id: master[pn]!, plantId: 9 } : undefined);

  it('phantom diurai: komponennya dipasangkan langsung ke induk phantom, qty dikalikan', () => {
    const data = [
      b('FG', 'FG'),
      b('FG', 'MA'),
      b('MA', 'DC'),
      b('DC', 'MELT', { phantom: 'X', qty: 2 }),
      b('MELT', 'ING', { qty: 2178, uom: 'g' }),
    ];
    const { pasangan, dilewati, indukTersalin } = pasanganDariBom(data, cari);
    expect(pasangan).toEqual([
      { plantId: 9, indukId: 1, komponenId: 2, qtyPer: 1, uom: 'pcs' },
      { plantId: 9, indukId: 2, komponenId: 3, qtyPer: 1, uom: 'pcs' },
      { plantId: 9, indukId: 3, komponenId: 4, qtyPer: 4356, uom: 'g' },
    ]);
    expect(dilewati).toEqual([]);
    // Baris milik phantom tidak ikut sebagai induk sendiri.
    expect(indukTersalin.sort()).toEqual([1, 2, 3]);
  });

  it('phantom yang ada di master tetap jadi tahap, rantai QR tidak putus', () => {
    // Bentuk BOM J922: CH11 (MA) dan CG11 (DC) phantom, tetapi di-scan di lantai.
    const data = [
      b('FG', 'FG'),
      b('FG', 'MA', { phantom: 'X' }),
      b('MA', 'DC', { phantom: 'X' }),
      b('DC', 'MELT', { phantom: 'X', qty: 2 }),
      b('MELT', 'ING', { qty: 2178, uom: 'g' }),
    ];
    const { pasangan, dilewati, indukTersalin } = pasanganDariBom(data, cari);
    expect(pasangan).toEqual([
      { plantId: 9, indukId: 1, komponenId: 2, qtyPer: 1, uom: 'pcs' },
      { plantId: 9, indukId: 2, komponenId: 3, qtyPer: 1, uom: 'pcs' },
      // MELT tidak di master: tetap diurai.
      { plantId: 9, indukId: 3, komponenId: 4, qtyPer: 4356, uom: 'g' },
    ]);
    expect(dilewati).toEqual([]);
    expect(indukTersalin.sort()).toEqual([1, 2, 3]);
  });

  it('part yang belum di master dilaporkan, induknya tetap tersalin', () => {
    const data = [b('FG', 'SUB'), b('FG', 'BELI'), b('X', 'SUB')];
    const { pasangan, dilewati, indukTersalin } = pasanganDariBom(data, cari);
    expect(pasangan.map((p) => p.komponenId)).toEqual([5]);
    expect(dilewati).toEqual([
      { induk: 'FG', komponen: 'BELI', sebab: 'komponen belum ada di master' },
      { induk: 'X', komponen: 'SUB', sebab: 'induk belum ada di master' },
    ]);
    expect(indukTersalin).toEqual([1]);
  });

  it('komponen yang sama dari dua cabang phantom dijumlahkan', () => {
    const data = [
      b('FG', 'P1', { phantom: 'X' }),
      b('FG', 'P2', { phantom: 'X' }),
      b('P1', 'SUB', { qty: 2 }),
      b('P2', 'SUB', { qty: 3 }),
    ];
    expect(pasanganDariBom(data, cari).pasangan).toEqual([
      { plantId: 9, indukId: 1, komponenId: 5, qtyPer: 5, uom: 'pcs' },
    ]);
  });
});
