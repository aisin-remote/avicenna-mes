import { describe, it, expect } from 'vitest';
import { bacaKanban, susunKanbanAigsys, PANJANG_KANBAN_AIGSYS } from './barcode';

const BODY = { scanMode: 'KANBAN_BOX' as const };
const UNIT = { scanMode: 'PART_KANBAN' as const };

/**
 * Tiga kartu sungguhan dari sistem lama, disalin dari hasil scan. Spasi di
 * belakang ikut — kartunya 230 karakter, dan posisi 123 hanya benar kalau
 * tidak ada satu spasi pun yang hilang di depannya.
 */
const KARTU_LAMA = [
  {
    raw: 'AIGSYSGJ922   JE10  JEAS0547   JE       0423106-12440          SE1C000  JE       XXX        0       MPJ8 0000008000000000000091                                0                              0000008                  PCS            ',
    kartu: { workCenter: 'AS0547', partNumber: '423106-12440', sloc: 'SE1C', backNumber: 'MPJ8', serialNumber: '0091', qtyPerBox: 8 },
  },
  {
    raw: 'AIGSYSGJ922   JE10  JEPC002F   JE       0423121-11600          SE14000  JE       XXX        0       KM04 0000006000000000000043                                0                              0000006                  PCS            ',
    kartu: { workCenter: 'PC002F', partNumber: '423121-11600', sloc: 'SE14', backNumber: 'KM04', serialNumber: '0043', qtyPerBox: 6 },
  },
  {
    raw: 'AIGSYSGJ922   JE10  JEPC002F   JE       0423122-10600          SE14000  JE       XXX        0       KM05 0000006000000000000032                                0                              0000006                  PCS            ',
    kartu: { workCenter: 'PC002F', partNumber: '423122-10600', sloc: 'SE14', backNumber: 'KM05', serialNumber: '0032', qtyPerBox: 6 },
  },
];

describe('susunKanbanAigsys — kartu format sistem lama', () => {
  it.each(KARTU_LAMA)('sama persis dengan kartu lama $kartu.backNumber', ({ raw, kartu }) => {
    expect(raw).toHaveLength(PANJANG_KANBAN_AIGSYS);
    expect(susunKanbanAigsys(kartu)).toBe(raw);
  });

  it.each(KARTU_LAMA)('seri di posisi 123, tempat sistem lama membacanya', ({ kartu }) => {
    expect(susunKanbanAigsys(kartu).substr(123, 4)).toBe(kartu.serialNumber);
  });

  it.each(KARTU_LAMA)('terbaca kembali di stasiun scan per box', ({ kartu }) => {
    const baca = bacaKanban(susunKanbanAigsys(kartu), BODY);
    expect(baca.aturan).toBe('KANBAN_AIGSYS');
    expect(baca.partNumber).toBe(kartu.partNumber);
    expect(baca.backNumber).toBe(kartu.backNumber);
    expect(baca.serialNumber).toBe(kartu.serialNumber);
    expect(baca.qty).toBe(kartu.qtyPerBox);
  });

  it.each(KARTU_LAMA)('terbaca kembali di stasiun lain dan tanpa konteks', ({ kartu }) => {
    for (const ctx of [UNIT, {}]) {
      const baca = bacaKanban(susunKanbanAigsys(kartu), ctx);
      expect(baca.backNumber).toBe(kartu.backNumber);
      expect(baca.serialNumber).toBe(kartu.serialNumber);
    }
  });

  it('spasi di belakang yang terpotong pemindai tidak mengubah hasil baca', () => {
    const { kartu } = KARTU_LAMA[0]!;
    const terpotong = susunKanbanAigsys(kartu).trimEnd();
    expect(bacaKanban(terpotong, BODY).serialNumber).toBe('0091');
    expect(bacaKanban(terpotong, UNIT).serialNumber).toBe('0091');
  });

  it('qty dua digit tetap terbaca utuh', () => {
    const kartu = { ...KARTU_LAMA[0]!.kartu, qtyPerBox: 60 };
    expect(bacaKanban(susunKanbanAigsys(kartu), BODY).qty).toBe(60);
  });

  it('menolak kolom kosong — pembaca berspasi menghitung kolom', () => {
    const { kartu } = KARTU_LAMA[0]!;
    expect(() => susunKanbanAigsys({ ...kartu, workCenter: ' ' })).toThrow(/kode line/);
    expect(() => susunKanbanAigsys({ ...kartu, sloc: '' })).toThrow(/SLOC/);
    expect(() => susunKanbanAigsys({ ...kartu, backNumber: '' })).toThrow(/back number/);
    expect(() => susunKanbanAigsys({ ...kartu, partNumber: '' })).toThrow(/nomor part/);
    expect(() => susunKanbanAigsys({ ...kartu, qtyPerBox: 0 })).toThrow(/isi box/);
  });

  it('menolak yang tidak muat, bukan menggeser kolom sesudahnya', () => {
    const { kartu } = KARTU_LAMA[0]!;
    expect(() => susunKanbanAigsys({ ...kartu, backNumber: 'MPJ8X' })).toThrow(/Back number/);
    expect(() => susunKanbanAigsys({ ...kartu, sloc: 'SE1CX' })).toThrow(/SLOC/);
    expect(() => susunKanbanAigsys({ ...kartu, workCenter: 'AS0547XYZ' })).toThrow(/Kode line/);
    expect(() => susunKanbanAigsys({ ...kartu, partNumber: '423106-12440-ABCDEFG' })).toThrow(/Nomor part/);
    expect(() => susunKanbanAigsys({ ...kartu, serialNumber: '10001' })).toThrow(/empat digit/);
    expect(() => susunKanbanAigsys({ ...kartu, serialNumber: '91' })).toThrow(/empat digit/);
  });
});
