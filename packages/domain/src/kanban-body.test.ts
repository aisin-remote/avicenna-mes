import { describe, it, expect } from 'vitest';
import { bacaKanban, KanbanTidakTerbaca, ATURAN_KANBAN_BODY, ATURAN_KANBAN_AIGSYS } from './barcode';

/**
 * Membangun label posisi-tetap dengan panjang tertentu: isi kolom yang
 * dibaca, sisanya dipadatkan. Posisinya persis milik prdreport bella.
 */
function label(panjang: 230 | 220 | 241 | 218, isi: { part: string; seri: string; back: string; pcs: string }) {
  const posisi = { 230: [41, 19, 123], 220: [35, 12, 130], 241: [35, 12, 127], 218: [41, 16, 123] }[panjang]!;
  const buf = Array<string>(panjang).fill('X');
  const tulis = (at: number, teks: string) => {
    for (let i = 0; i < teks.length; i += 1) buf[at + i] = teks[i]!;
  };
  tulis(posisi[0]!, isi.part.padEnd(posisi[1]!, ' '));
  tulis(100, isi.back);
  tulis(posisi[2]!, isi.seri);
  tulis(196, isi.pcs);
  return buf.join('');
}

const BODY = { scanMode: 'PER_KANBAN' as const };
const UNIT = { scanMode: 'PER_PIECE' as const };

describe('kanban BODY posisi tetap', () => {
  it.each([
    { panjang: 230, jenis: 'biasa' },
    { panjang: 220, jenis: 'buffer' },
    { panjang: 241, jenis: 'passthrough' },
    { panjang: 218, jenis: 'suzuki' },
  ] as const)('panjang $panjang ($jenis) terbaca di posisi yang benar', ({ panjang }) => {
    const raw = label(panjang, { part: '55810-BZ010', seri: '0042', back: 'BN02', pcs: '5' });
    const r = bacaKanban(raw, BODY);
    expect(r.aturan).toBe('KANBAN_BODY');
    expect(r.partNumber).toBe('55810-BZ010');
    expect(r.serialNumber).toBe('0042');
    expect(r.backNumber).toBe('BN02');
    expect(r.qty).toBe(5);
  });

  it('panjang lain TIDAK diklaim aturan ini', () => {
    expect(ATURAN_KANBAN_BODY.cocok('X'.repeat(231))).toBe(false);
    expect(ATURAN_KANBAN_BODY.cocok('X'.repeat(100))).toBe(false);
  });

  it('di UNIT (per barang) aturan ini mati', () => {
    /*
     * Label 230 karakter tidak pernah ada di UNIT. Membiarkannya menyala di
     * sana hanya menambah peluang salah baca pada barcode yang kebetulan
     * sepanjang itu.
     */
    const raw = label(230, { part: '55810-BZ010', seri: '0042', back: 'BN02', pcs: '5' });
    expect(() => bacaKanban(raw, UNIT)).toThrow(KanbanTidakTerbaca);
  });
});

describe('kanban AIGSYS bertoken', () => {
  const raw = 'AIGSYS-KBN  0554321-AB1-C2  BN07  20250918000000000000001234  5  END';

  it('membaca part (nol depan dibuang), seri 4 terakhir, back sebelum seri, pcs', () => {
    const r = bacaKanban(raw, BODY);
    expect(r.aturan).toBe('KANBAN_AIGSYS');
    expect(r.partNumber).toBe('554321-AB1-C2');
    expect(r.serialNumber).toBe('1234');
    expect(r.backNumber).toBe('BN07');
    expect(r.qty).toBe(5);
  });

  it('padding spasi ganda tidak mengubah hasil', () => {
    expect(bacaKanban(raw.replace(/ {2}/g, '     '), BODY).serialNumber).toBe('1234');
  });

  it('AIGSYS sepanjang 230 karakter tetap dibaca sebagai AIGSYS, bukan posisi tetap', () => {
    // Urutan daftar aturan yang menjaganya — kalau tertukar, seri yang dibaca
    // adalah 4 karakter di posisi 123, sembarang isi label, tanpa galat.
    const panjang = raw.padEnd(230, ' ');
    expect(panjang.length).toBe(230);
    expect(bacaKanban(panjang, BODY).aturan).toBe('KANBAN_AIGSYS');
  });

  it('AIGSYS tanpa token seri tidak diklaim', () => {
    expect(ATURAN_KANBAN_AIGSYS.baca('AIGSYS 0554321-AB1 BN07 12 END').serialNumber).toBeUndefined();
    expect(() => bacaKanban('AIGSYS 0554321-AB1 BN07 12 END', BODY)).toThrow(KanbanTidakTerbaca);
  });
});

describe('aturan UNIT tidak terganggu', () => {
  it('BACKNUMBER|SERIAL masih terbaca di kedua mode', () => {
    expect(bacaKanban('BN-001|1001', UNIT).serialNumber).toBe('1001');
    expect(bacaKanban('BN-001|1001', BODY).serialNumber).toBe('1001');
  });
});
