import { describe, it, expect } from 'vitest';
import {
  alokasiBelanja,
  periksaBelanja,
  fgSiapBelanja,
  wipSiapBelanja,
  type KartuBelanja,
} from './belanja';

function wip(id: number, qty: number, partId = 200): KartuBelanja {
  return { kanbanId: id, partId, partNumber: `PAINT-${partId}`, serialNumber: `P${id}`, qty };
}

// KPJ9 (induk, isi 8) dengan dua turunan berkartu: KN2N dan KO47.
function induk(id: number, qty = 8, partId = 100): KartuBelanja {
  return { kanbanId: id, partId, partNumber: '42312014170AA7', serialNumber: `I${id}`, qty };
}
const KOMPONEN_KPJ9 = [
  { partId: 200, partNumber: '42311710870AA7', qtyPer: 1 },
  { partId: 300, partNumber: '42310210290', qtyPer: 1 },
];
const limaInduk = [1, 2, 3, 4, 5].map((i) => induk(i));

describe('periksaBelanja — beberapa induk, jumlah box turunan', () => {
  it('5 induk isi 8 + 5 turunan isi 8: pas', () => {
    const h = periksaBelanja({
      kartuInduk: limaInduk,
      komponen: KOMPONEN_KPJ9,
      kartuWip: [11, 12, 13, 14, 15].map((i) => wip(i, 8)),
    });
    expect(h.unitInduk).toBe(40);
    expect(h.galat).toEqual([]);
    expect(h.perKomponen[0]).toMatchObject({ dibutuhkan: 40, kartuDibutuhkan: 5, cukup: true });
  });

  it('5 induk isi 8 + turunan isi 16: cukup 3 kartu (sisa 8 tidak masalah)', () => {
    const h = periksaBelanja({
      kartuInduk: limaInduk,
      komponen: KOMPONEN_KPJ9,
      kartuWip: [11, 12, 13].map((i) => wip(i, 16, 300)),
    });
    expect(h.bolehDisimpan).toBe(true);
    expect(h.perKomponen[1]).toMatchObject({ dibutuhkan: 40, dibawa: 48, kartuDibutuhkan: 3 });
  });

  it('kurang: menyebut sisa kartu yang harus discan', () => {
    const h = periksaBelanja({
      kartuInduk: limaInduk,
      komponen: KOMPONEN_KPJ9,
      kartuWip: [wip(11, 16, 300)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat[0]).toContain('scan 2 kartu lagi');
  });

  it('kartu turunan yang tidak dibutuhkan ditolak', () => {
    const h = periksaBelanja({
      kartuInduk: limaInduk,
      komponen: KOMPONEN_KPJ9,
      kartuWip: [11, 12, 13, 14].map((i) => wip(i, 16, 300)),
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat.join(' ')).toContain('kelebihan box');
  });

  it('turunan dicampur dua part ditolak', () => {
    const h = periksaBelanja({
      kartuInduk: [induk(1)],
      komponen: KOMPONEN_KPJ9,
      kartuWip: [wip(11, 8), wip(12, 32, 300)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat.join(' ')).toContain('jangan dicampur');
  });

  it('part di luar BOM ditolak — model atau warnanya berbeda', () => {
    const h = periksaBelanja({
      kartuInduk: [induk(1)],
      komponen: KOMPONEN_KPJ9,
      kartuWip: [wip(11, 8, 999)],
    });
    expect(h.bukanKomponen).toHaveLength(1);
    expect(h.galat.join(' ')).toContain('warnanya berbeda');
  });

  it('induk dari dua part berbeda ditolak', () => {
    const h = periksaBelanja({
      kartuInduk: [induk(1), induk(2, 8, 101)],
      komponen: KOMPONEN_KPJ9,
      kartuWip: [wip(11, 16)],
    });
    expect(h.galat.join(' ')).toContain('satu part yang sama');
  });

  it('BOM kosong ditolak, bukan dianggap tidak ada yang perlu diperiksa', () => {
    const h = periksaBelanja({ kartuInduk: [induk(1)], komponen: [], kartuWip: [wip(11, 8)] });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat.join(' ')).toContain('BOM');
  });

  it('belum ada kartu turunan: diminta scan', () => {
    const h = periksaBelanja({ kartuInduk: [induk(1)], komponen: KOMPONEN_KPJ9, kartuWip: [] });
    expect(h.galat).toContain('Scan kartu turunan.');
  });
});

describe('alokasiBelanja', () => {
  it('turunan isi 16 terbagi ke dua induk isi 8, sisa box terakhir tidak dialokasikan', () => {
    const a = alokasiBelanja(limaInduk, [11, 12, 13].map((i) => wip(i, 16, 300)), 1);
    expect(a).toEqual([
      { indukKanbanId: 1, wipKanbanId: 11, qty: 8 },
      { indukKanbanId: 2, wipKanbanId: 11, qty: 8 },
      { indukKanbanId: 3, wipKanbanId: 12, qty: 8 },
      { indukKanbanId: 4, wipKanbanId: 12, qty: 8 },
      { indukKanbanId: 5, wipKanbanId: 13, qty: 8 },
    ]);
  });

  it('induk isi 16 diisi dua turunan isi 8', () => {
    const a = alokasiBelanja([induk(1, 16)], [wip(11, 8), wip(12, 8)], 1);
    expect(a).toEqual([
      { indukKanbanId: 1, wipKanbanId: 11, qty: 8 },
      { indukKanbanId: 1, wipKanbanId: 12, qty: 8 },
    ]);
  });
});

describe('kelayakan kartu', () => {
  it('kartu FG hanya boleh belanja saat AVAILABLE', () => {
    expect(fgSiapBelanja('AVAILABLE')).toBeNull();
    expect(fgSiapBelanja('SHOPPED')).toBe('FG_SUDAH_BELANJA');
    expect(fgSiapBelanja('PRODUCED')).toBe('FG_TERISI');
    expect(fgSiapBelanja('CANCELLED')).toBe('FG_TIDAK_AKTIF');
  });

  it('kartu WIP hanya boleh dibelanjakan saat PRODUCED', () => {
    expect(wipSiapBelanja('PRODUCED')).toBeNull();
    expect(wipSiapBelanja('SHOPPED')).toBe('WIP_SUDAH_TERIKAT');
    // Kartu kosong berarti yang diambil dari rak kartunya, bukan barangnya.
    expect(wipSiapBelanja('AVAILABLE')).toBe('WIP_BELUM_TERISI');
  });
});
