import { describe, it, expect } from 'vitest';
import {
  bacaBarcode,
  punyaIdentitasPart,
  aturanBerlaku,
  BarcodeTidakDikenali,
  DAFTAR_ATURAN,
  ATURAN_SERIAL_SAJA,
  type AturanBarcode,
} from './barcode';

describe('bacaBarcode', () => {
  it('membaca format berpemisah lengkap', () => {
    expect(bacaBarcode('AV-12345-001|BN-001|SN00042|20')).toEqual({
      raw: 'AV-12345-001|BN-001|SN00042|20',
      partNumber: 'AV-12345-001',
      backNumber: 'BN-001',
      serialNumber: 'SN00042',
      qty: 20,
      aturan: 'BERPEMISAH',
    });
  });

  it('menandai aturan yang dipakai membaca', () => {
    // Inilah yang menjawab "dibaca pakai aturan mana" saat sebuah barcode
    // terbaca keliru — tanpa perlu barcode aslinya yang biasanya sudah hilang.
    expect(bacaBarcode('SN00042').aturan).toBe('SERIAL_SAJA');
    expect(bacaBarcode('P1|B1|S1|5').aturan).toBe('BERPEMISAH');
  });

  it('nomor seri polos terbaca sebagai serial, tanpa part', () => {
    expect(bacaBarcode('SN00042')).toEqual({
      raw: 'SN00042',
      serialNumber: 'SN00042',
      aturan: 'SERIAL_SAJA',
    });
  });

  it('qty yang tidak masuk akal diabaikan, bukan dipaksa jadi angka', () => {
    expect(bacaBarcode('P1|B1|S1|abc').qty).toBeUndefined();
    expect(bacaBarcode('P1|B1|S1|0').qty).toBeUndefined();
    expect(bacaBarcode('P1|B1|S1|-5').qty).toBeUndefined();
  });

  it('bagian yang kosong tidak menjadi string kosong', () => {
    const h = bacaBarcode('AV-1||SN-9|');
    expect(h.partNumber).toBe('AV-1');
    expect(h.backNumber).toBeUndefined();
    expect(h.serialNumber).toBe('SN-9');
    expect(h.qty).toBeUndefined();
  });

  it('spasi di ujung dibuang sebelum dibaca', () => {
    expect(bacaBarcode('  AV-1|B1|S1|3  ').partNumber).toBe('AV-1');
  });

  it('barcode kosong ditolak', () => {
    expect(() => bacaBarcode('   ')).toThrow(/kosong/);
  });
});

describe('pemilihan aturan', () => {
  it('aturan paling khas dipakai lebih dulu daripada yang longgar', () => {
    // SERIAL_SAJA cocok dengan apa pun. Kalau urutannya salah, ia akan menelan
    // seluruh barcode dan aturan lain tidak pernah terpakai.
    expect(DAFTAR_ATURAN[DAFTAR_ATURAN.length - 1]).toBe(ATURAN_SERIAL_SAJA);
    expect(bacaBarcode('P1|B1|S1|1').aturan).toBe('BERPEMISAH');
  });

  it('aturan berlingkup proses hanya dipakai pada prosesnya', () => {
    const khususInjection: AturanBarcode = {
      nama: 'UJI_INJECTION',
      keterangan: 'hanya untuk injection',
      berlaku: (ctx) => ctx.processType === 'INJECTION',
      cocok: (raw) => raw.startsWith('INJ'),
      baca: (raw) => ({ raw, partNumber: raw.slice(3) }),
    };
    DAFTAR_ATURAN.unshift(khususInjection);
    try {
      expect(bacaBarcode('INJ-777', { processType: 'INJECTION' }).aturan).toBe('UJI_INJECTION');
      // Proses lain tidak boleh ikut memakainya.
      expect(bacaBarcode('INJ-777', { processType: 'MACHINING' }).aturan).toBe('SERIAL_SAJA');
      // Tanpa konteks pun tidak dipakai — lingkupnya belum terpenuhi.
      expect(bacaBarcode('INJ-777').aturan).toBe('SERIAL_SAJA');
    } finally {
      DAFTAR_ATURAN.shift();
    }
  });

  it('aturan berlingkup customer hanya dipakai pada customer itu', () => {
    const khususSuzuki: AturanBarcode = {
      nama: 'UJI_SUZUKI',
      keterangan: 'hanya untuk SUZUKI',
      berlaku: (ctx) => ctx.customerFormat === 'SUZUKI',
      cocok: (raw) => raw.length === 13,
      baca: (raw) => ({ raw, partNumber: raw.slice(0, 5) }),
    };
    DAFTAR_ATURAN.unshift(khususSuzuki);
    try {
      expect(bacaBarcode('1234567890123', { customerFormat: 'SUZUKI' }).aturan).toBe('UJI_SUZUKI');
      expect(bacaBarcode('1234567890123', { customerFormat: 'MMKI' }).aturan).toBe('SERIAL_SAJA');
    } finally {
      DAFTAR_ATURAN.shift();
    }
  });

  it('melempar BarcodeTidakDikenali bila tidak ada aturan yang cocok', () => {
    // Menghapus aturan penadah harus menghasilkan penolakan yang jelas, bukan
    // undefined yang menjalar diam-diam ke penulisan mutasi.
    const simpan = DAFTAR_ATURAN.splice(0, DAFTAR_ATURAN.length);
    try {
      expect(() => bacaBarcode('APA SAJA')).toThrow(BarcodeTidakDikenali);
    } finally {
      DAFTAR_ATURAN.push(...simpan);
    }
  });

  it('aturanBerlaku menyaring menurut keadaan', () => {
    expect(aturanBerlaku().map((a) => a.nama)).toContain('SERIAL_SAJA');
    expect(aturanBerlaku({ processType: 'CASTING' }).length).toBe(DAFTAR_ATURAN.length);
  });
});

describe('punyaIdentitasPart', () => {
  it('benar bila ada nomor part', () => {
    expect(punyaIdentitasPart(bacaBarcode('AV-1|B1|S1|1'))).toBe(true);
  });

  it('benar bila hanya ada back number', () => {
    expect(punyaIdentitasPart({ raw: 'x', backNumber: 'BN-9' })).toBe(true);
  });

  it('salah bila hanya nomor seri — produksi tidak boleh lolos dengan ini', () => {
    expect(punyaIdentitasPart(bacaBarcode('SN00042'))).toBe(false);
  });
});
