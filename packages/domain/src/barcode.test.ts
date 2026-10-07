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
      expect(bacaBarcode('INJ-777', { processType: 'MACHINING_WIP' }).aturan).toBe('SERIAL_SAJA');
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
    // Di proses per barang, aturan nomor-part polos TIDAK berlaku — hanya itu
    // yang tersaring; sisanya berlaku di mana saja.
    const diCasting = aturanBerlaku({ processType: 'CASTING_WIP', scanMode: 'PART_SAJA' });
    expect(diCasting.length).toBe(DAFTAR_ATURAN.length - 1);
    expect(diCasting.map((a) => a.nama)).not.toContain('NOMOR_PART');
    expect(aturanBerlaku({ scanMode: 'KANBAN_BOX' }).map((a) => a.nama)).toContain('NOMOR_PART');
    // Nilai lama tetap diterima: snapshot scan yang sudah ada memakainya.
    expect(aturanBerlaku({ scanMode: 'PER_KANBAN' }).map((a) => a.nama)).toContain('NOMOR_PART');
  });
});

describe('master sample (nomor part polos) — hanya di mode per-kanban', () => {
  it('di KANBAN_BOX, nomor part polos terbaca sebagai PART', () => {
    const r = bacaBarcode('BL-98765-002', { scanMode: 'KANBAN_BOX' });
    expect(r.aturan).toBe('NOMOR_PART');
    expect(r.partNumber).toBe('BL-98765-002');
    expect(r.serialNumber).toBeUndefined();
  });

  it('di metode per barang, string yang sama tetap dibaca sebagai SERI', () => {
    /*
     * Bentuknya tidak bisa dibedakan dari nomor seri polos. Tanpa syarat mode,
     * nomor seri UNIT yang belum dikenali ditafsirkan sebagai nomor part lalu
     * ditolak "part tidak ada" — pesan yang menyesatkan.
     */
    const r = bacaBarcode('BL-98765-002', { scanMode: 'PART_SAJA' });
    expect(r.aturan).toBe('SERIAL_SAJA');
    expect(r.partNumber).toBeUndefined();
  });

  it('yang berpemisah tetap ke aturan berpemisah walau mode per-kanban', () => {
    const r = bacaBarcode('BL-98765-002|BN-002|S1|20', { scanMode: 'KANBAN_BOX' });
    expect(r.aturan).toBe('BERPEMISAH');
  });

  it('barcode 15 digit berkode program tidak direbut aturan nomor part', () => {
    // PROGRAM_15 ada DI ATAS NOMOR_PART di daftar — urutan itu yang menjaganya.
    const r = bacaBarcode('12051421B22A276', { scanMode: 'KANBAN_BOX' });
    expect(r.aturan).toBe('PROGRAM_15');
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

describe('ATURAN_PROGRAM_15 — barcode produksi nyata', () => {
  it('membaca 2 digit pertama sebagai program number', () => {
    // Contoh nyata dari data sistem lama.
    const h = bacaBarcode('12051421B22A276');
    expect(h.aturan).toBe('PROGRAM_15');
    expect(h.programCode).toBe('12');
    expect(h.serialNumber).toBe('12051421B22A276');
  });

  it('SELURUH barcode menjadi identitas unit, bukan potongannya', () => {
    /*
     * Sistem lama menyimpan seluruh barcode sebagai kode unit dan tidak pernah
     * membaca sisanya. Memotongnya di sini akan membuat dua unit berbeda
     * terlihat sama.
     */
    const a = bacaBarcode('12051421B22A276');
    const b = bacaBarcode('12051421B22A463');
    expect(a.serialNumber).not.toBe(b.serialNumber);
    expect(a.programCode).toBe(b.programCode);
  });

  it('tidak memuat nomor part — part diterjemahkan dari program number', () => {
    const h = bacaBarcode('17041521B24A121');
    expect(h.partNumber).toBeUndefined();
    expect(h.backNumber).toBeUndefined();
    expect(h.programCode).toBe('17');
  });

  it('panjang selain 15 tidak dipakai aturan ini', () => {
    expect(bacaBarcode('12051421B22A27').aturan).toBe('SERIAL_SAJA');
    expect(bacaBarcode('12051421B22A2765').aturan).toBe('SERIAL_SAJA');
  });

  it('dua karakter pertama harus angka', () => {
    expect(bacaBarcode('AB051421B22A276').aturan).toBe('SERIAL_SAJA');
  });

  it('format berpemisah tetap menang', () => {
    // Barcode ber-"|" 15 karakter tidak boleh direbut aturan program.
    expect(bacaBarcode('12|B1|S1|3456').aturan).toBe('BERPEMISAH');
  });
});
