import { describe, expect, it } from 'vitest';
import { evaluasiScanAnggotaMold } from './mold-cycle';

const MEMBERS = [1, 2, 3, 4] as const;

describe('putaran scan mold', () => {
  it('menerima anggota dalam urutan apa pun sampai anggota terakhir', () => {
    expect(evaluasiScanAnggotaMold(MEMBERS, [], 3)).toBe('ACCEPTED');
    expect(evaluasiScanAnggotaMold(MEMBERS, [3], 1)).toBe('ACCEPTED');
    expect(evaluasiScanAnggotaMold(MEMBERS, [3, 1, 4], 2)).toBe('COMPLETED');
  });

  it('menandai scan ganda sebelum set lengkap sebagai duplikat', () => {
    expect(evaluasiScanAnggotaMold(MEMBERS, [1, 2], 1)).toBe('DUPLICATE');
  });

  it('menolak part yang bukan anggota mold', () => {
    expect(evaluasiScanAnggotaMold(MEMBERS, [1], 9)).toBe('NOT_MEMBER');
  });

  it('setelah putaran direset, anggota pertama boleh dimulai lagi', () => {
    expect(evaluasiScanAnggotaMold(MEMBERS, [], 1)).toBe('ACCEPTED');
  });
});
