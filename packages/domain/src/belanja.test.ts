import { describe, it, expect } from 'vitest';
import { periksaBelanja, fgSiapBelanja, wipSiapBelanja, type KartuBelanja } from './belanja';

const FG: KartuBelanja = {
  kanbanId: 1,
  partId: 100,
  partNumber: '660A-ASSY',
  serialNumber: 'A001',
  qty: 100,
};

function wip(id: number, qty: number, partId = 200): KartuBelanja {
  return { kanbanId: id, partId, partNumber: `PAINT-${partId}`, serialNumber: `P${id}`, qty };
}

const SATU_KOMPONEN = [{ partId: 200, partNumber: 'PAINT-200', qtyPer: 1 }];

describe('periksaBelanja', () => {
  it('pas: dua box isi 50 untuk kartu FG isi 100', () => {
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 50), wip(2, 50)],
    });
    expect(h.bolehDisimpan).toBe(true);
    expect(h.galat).toEqual([]);
    expect(h.perKomponen[0]).toMatchObject({
      dibutuhkan: 100,
      dibawa: 100,
      jumlahKartu: 2,
      pas: true,
    });
  });

  it('kurang satu box: ditolak dan kekurangannya disebut angkanya', () => {
    const h = periksaBelanja({ kartuFg: FG, komponen: SATU_KOMPONEN, kartuWip: [wip(1, 50)] });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.perKomponen[0]!.selisih).toBe(-50);
    expect(h.galat[0]).toContain('kurang 50');
  });

  it('kelebihan box ditolak juga, bukan dibiarkan lolos', () => {
    /*
     * Box yang terikat tanpa terpakai hilang dari rak bagi lini lain, dan tidak
     * ada catatan yang menjelaskan ke mana — itu sebabnya "cukup" tidak dipakai
     * sebagai syarat, yang dipakai "pas".
     */
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 50), wip(2, 50), wip(3, 50)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.perKomponen[0]!.selisih).toBe(50);
    expect(h.galat[0]).toContain('lebih 50');
  });

  it('qtyPer 2 menggandakan kebutuhan', () => {
    const h = periksaBelanja({
      kartuFg: { ...FG, qty: 50 },
      komponen: [{ partId: 200, partNumber: 'PAINT-200', qtyPer: 2 }],
      kartuWip: [wip(1, 50), wip(2, 50)],
    });
    expect(h.perKomponen[0]!.dibutuhkan).toBe(100);
    expect(h.bolehDisimpan).toBe(true);
  });

  it('qtyPer desimal tidak meninggalkan sisa pembulatan', () => {
    // 100 × 0,8 = 80, bukan 79,99999999999999.
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: [{ partId: 200, partNumber: 'RAW-200', qtyPer: 0.8 }],
      kartuWip: [wip(1, 80)],
    });
    expect(h.perKomponen[0]!.dibutuhkan).toBe(80);
    expect(h.bolehDisimpan).toBe(true);
  });

  it('komponen BOM yang tidak discan sama sekali ikut menghalangi', () => {
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: [
        { partId: 200, partNumber: 'PAINT-200', qtyPer: 1 },
        { partId: 300, partNumber: 'PAINT-300', qtyPer: 1 },
      ],
      kartuWip: [wip(1, 50), wip(2, 50)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat.join(' ')).toContain('PAINT-300 belum discan');
  });

  it('kartu yang bukan komponen BOM disebut namanya, bukan hanya ditolak', () => {
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 50), wip(2, 50), wip(9, 10, 999)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.bukanKomponen).toHaveLength(1);
    expect(h.galat.join(' ')).toContain('bukan komponen');
  });

  it('BOM kosong ditolak, bukan dianggap tidak ada yang perlu diperiksa', () => {
    const h = periksaBelanja({ kartuFg: FG, komponen: [], kartuWip: [wip(1, 50)] });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat[0]).toContain('BOM');
  });

  it('kartu WIP yang sama discan dua kali ditolak', () => {
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 50), wip(1, 50)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat.join(' ')).toContain('dua kali');
  });

  it('belum ada kartu WIP: ditolak tanpa menyebut angka yang membingungkan', () => {
    const h = periksaBelanja({ kartuFg: FG, komponen: SATU_KOMPONEN, kartuWip: [] });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat[0]).toBe('Belum ada kartu WIP yang discan.');
  });

  it('isi box yang tidak habis membagi kebutuhan dinyatakan TIDAK AKAN pas', () => {
    /*
     * Butuh 100, satu box isi 30: tiga kartu 90, empat kartu 120. Tanpa
     * pemberitahuan ini operator akan menambah dan mengurangi kartu berulang
     * kali mencari angka yang sebenarnya tidak ada.
     */
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 30), wip(2, 30), wip(3, 30)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.perKomponen[0]!.tidakAkanPas).toEqual({ isiBox: 30, kurangKartu: 3, lebihKartu: 4 });
    expect(h.galat.join(' ')).toContain('satu box isinya 30');
  });

  it('isi box campur TIDAK dinyatakan mustahil — kombinasi yang pas masih mungkin', () => {
    const h = periksaBelanja({
      kartuFg: FG,
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 30), wip(2, 50)],
    });
    expect(h.perKomponen[0]!.tidakAkanPas).toBeUndefined();
    expect(h.galat.join(' ')).toContain('kurang 20');
  });

  it('kartu FG tanpa isi per box ditolak di masternya, bukan dihitung sebagai nol', () => {
    const h = periksaBelanja({
      kartuFg: { ...FG, qty: 0 },
      komponen: SATU_KOMPONEN,
      kartuWip: [wip(1, 50)],
    });
    expect(h.bolehDisimpan).toBe(false);
    expect(h.galat[0]).toContain('isi per box');
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
