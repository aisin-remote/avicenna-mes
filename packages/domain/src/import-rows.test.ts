import { describe, it, expect } from 'vitest';
import { parseImportRows, parseLocaleNumber, mergeByPart } from './import-rows';

describe('parseLocaleNumber', () => {
  it('membaca desimal bergaya Indonesia (koma desimal, titik ribuan)', () => {
    // "1.234,5" = seribu dua ratus tiga puluh empat koma lima.
    expect(parseLocaleNumber('1.234,5')).toBe(1234.5);
    expect(parseLocaleNumber('0,8')).toBe(0.8);
  });

  it('membaca desimal bergaya Inggris', () => {
    expect(parseLocaleNumber('1,234.5')).toBe(1234.5);
    expect(parseLocaleNumber('0.8')).toBe(0.8);
  });

  it('angka bulat dengan pemisah ribuan tidak salah dibaca sebagai desimal', () => {
    // Ini kesalahan yang paling mahal: 1.000 kg terbaca 1 kg, atau sebaliknya.
    expect(parseLocaleNumber('1.000')).toBe(1000);
    expect(parseLocaleNumber('1,000')).toBe(1000);
    expect(parseLocaleNumber('250')).toBe(250);
  });

  it('bagian depan nol berarti desimal, bukan ribuan', () => {
    // Tidak ada yang menulis "nol ribu"; 0.800 pasti 0,8 kg.
    expect(parseLocaleNumber('0.800')).toBe(0.8);
    expect(parseLocaleNumber('0,800')).toBe(0.8);
  });

  it('satu atau dua angka di belakang pemisah selalu desimal', () => {
    expect(parseLocaleNumber('1,5')).toBe(1.5);
    expect(parseLocaleNumber('12.75')).toBe(12.75);
  });

  it('mengabaikan spasi', () => {
    expect(parseLocaleNumber(' 1 234 ')).toBe(1234);
  });

  it('teks bukan angka menghasilkan NaN', () => {
    expect(Number.isNaN(parseLocaleNumber('abc'))).toBe(true);
    expect(Number.isNaN(parseLocaleNumber(''))).toBe(true);
  });
});

describe('parseImportRows', () => {
  it('membaca tempelan dari Excel (dipisah tab)', () => {
    const rows = parseImportRows('CMP-B-001\t500\tpcs\tSL-77\nRM-D-001\t250\tkg');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ partNumber: 'CMP-B-001', qty: 500, uom: 'pcs', supplierLotNumber: 'SL-77' });
    expect(rows[1]).toMatchObject({ partNumber: 'RM-D-001', qty: 250, uom: 'kg' });
  });

  it('membaca CSV dan pemisah titik koma', () => {
    expect(parseImportRows('CMP-B-001,10')[0]?.qty).toBe(10);
    expect(parseImportRows('CMP-B-001;10')[0]?.qty).toBe(10);
  });

  it('melewati baris judul, bukan melaporkannya sebagai kesalahan', () => {
    const rows = parseImportRows('Part Number\tQty\nCMP-B-001\t5');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.partNumber).toBe('CMP-B-001');
  });

  it('mengabaikan baris kosong', () => {
    expect(parseImportRows('CMP-B-001\t5\n\n\nRM-D-001\t3')).toHaveLength(2);
  });

  it('membuang tanda kutip yang ikut tersalin', () => {
    expect(parseImportRows('"CMP-B-001","500"')[0]).toMatchObject({ partNumber: 'CMP-B-001', qty: 500 });
  });

  it('menandai baris bermasalah beserta nomornya, tanpa membatalkan sisanya', () => {
    const rows = parseImportRows('CMP-B-001\t5\nRM-D-001\tabc\n\t10\nCMP-C-001\t0');
    expect(rows[0]?.error).toBeUndefined();
    expect(rows[1]?.error).toMatch(/tidak terbaca/);
    expect(rows[1]?.lineNumber).toBe(2);
    expect(rows[2]?.error).toMatch(/kosong/);
    expect(rows[3]?.error).toMatch(/lebih dari nol/);
  });

  it('tempelan kosong menghasilkan daftar kosong', () => {
    expect(parseImportRows('')).toEqual([]);
    expect(parseImportRows('   \n  ')).toEqual([]);
  });
});

describe('mergeByPart', () => {
  it('menjumlahkan part yang sama', () => {
    const merged = mergeByPart(parseImportRows('CMP-B-001\t5\nCMP-B-001\t3'));
    expect(merged).toHaveLength(1);
    expect(merged[0]?.qty).toBe(8);
  });

  it('lot yang berbeda TIDAK digabung agar telusurnya tidak hilang', () => {
    const merged = mergeByPart(parseImportRows('CMP-B-001\t5\tpcs\tLOT-A\nCMP-B-001\t3\tpcs\tLOT-B'));
    expect(merged).toHaveLength(2);
  });

  it('baris bermasalah tetap dibawa agar bisa diperbaiki pengguna', () => {
    const merged = mergeByPart(parseImportRows('CMP-B-001\t5\nRM-D-001\tabc'));
    expect(merged.some((r) => r.error)).toBe(true);
  });
});
