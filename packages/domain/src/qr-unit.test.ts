import { describe, expect, it } from 'vitest';
import { uraiQrUnit } from './qr-unit';

describe('uraiQrUnit', () => {
  it('mengurai semua ruas QR yang sah', () => {
    // program 01, die 02, line A1, 2026, November (B), tanggal 12, shift A, shot 045
    expect(uraiQrUnit('0102A126B12A045')).toEqual({
      program: '01',
      die: '02',
      line: 'A1',
      tahun: 2026,
      bulan: 11,
      tanggal: 12,
      tanggalProduksi: '2026-11-12',
      shift: 'A',
      shot: 45,
      ruasTidakSah: [],
    });
  });

  it('ruas yang di luar format ditandai, bukan ditolak', () => {
    // QR uji 011231234567899: tanggal 56, shift 7
    const u = uraiQrUnit('011231234567899');
    expect(u?.program).toBe('01');
    expect(u?.tanggalProduksi).toBeNull();
    expect(u?.ruasTidakSah).toEqual(['tanggal', 'shift']);
  });

  it('tanggal yang tidak ada di bulannya tidak sah', () => {
    expect(uraiQrUnit('0102A1262' + '30A001')?.ruasTidakSah).toContain('tanggal');
  });

  it('bukan QR unit', () => {
    expect(uraiQrUnit('21211034010')).toBeNull();
    expect(uraiQrUnit('AIGSYSGJ922')).toBeNull();
  });
});
