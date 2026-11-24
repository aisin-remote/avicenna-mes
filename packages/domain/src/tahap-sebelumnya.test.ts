import { describe, expect, it } from 'vitest';
import { tahapSebelumnyaDiscan } from './rute-work-center';

/* Rantai sungguhan di master UNIT, 24 Nov 2026 (hanya komponen dibuat sendiri, per seri). */
const KOMPONEN: Record<number, number[]> = {
  // OPN 889F: EI11 → 24321210980 (phantom) → EG11; melting -02 per qty, tidak ikut.
  1094: [1097],
  1097: [1099],
  1099: [],
  // TCC D98E: CH11 → BIX1 (tanpa rute) dan CG11.
  21: [22, 25],
  22: [],
  25: [],
};
const BER_RUTE = new Set([1094, 1099, 21, 25]); // MA0006, DCAA04, MA0001, DCAA01
const anak = (id: number) => KOMPONEN[id] ?? [];
const rute = (id: number) => BER_RUTE.has(id);

describe('tahapSebelumnyaDiscan', () => {
  it('OPN: menembus phantom tanpa rute sampai EG11 di DCAA04', () => {
    expect(tahapSebelumnyaDiscan(KOMPONEN[1094]!, anak, rute).sort()).toEqual([1097, 1099]);
  });

  it('TCC: komponen ber-rute (CG11) berhenti di situ, tidak ditembus', () => {
    const hasil = tahapSebelumnyaDiscan(KOMPONEN[21]!, anak, rute);
    expect(hasil).toContain(25);
    expect(hasil).toContain(22);
    expect(hasil).toHaveLength(2);
  });

  it('data melingkar tidak membuat macet', () => {
    const lingkar = (id: number) => (id === 1 ? [2] : [1]);
    expect(tahapSebelumnyaDiscan([1], lingkar, () => false).sort()).toEqual([1, 2]);
  });

  it('tanpa komponen: kosong (tahap pertama, tidak diperiksa)', () => {
    expect(tahapSebelumnyaDiscan([], anak, rute)).toEqual([]);
  });
});
