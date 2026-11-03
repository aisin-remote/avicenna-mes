import { describe, it, expect } from 'vitest';
import { convertCustomerPartNumber, normalkanNomorPart, nomorPartSama } from './customer-part';

describe('convertCustomerPartNumber — 12 karakter (TMMIN)', () => {
  it('menyisipkan dua tanda hubung bila dua digit akhir bukan 00', () => {
    expect(convertCustomerPartNumber('902101234512', 'TMMIN')).toBe('90210-12345-12');
  });

  it('membuang dua digit akhir bila berakhiran 00', () => {
    expect(convertCustomerPartNumber('902101234500', 'TMMIN')).toBe('90210-12345');
  });

  it('aturan panjang berlaku tanpa memandang format customer', () => {
    // Untuk 12 karakter, bella tidak memeriksa customer sama sekali.
    expect(convertCustomerPartNumber('902101234512', 'SUZUKI')).toBe('90210-12345-12');
    expect(convertCustomerPartNumber('902101234512', 'NONE')).toBe('90210-12345-12');
  });
});

describe('convertCustomerPartNumber — 10 karakter', () => {
  it('MMKI memakai kode apa adanya', () => {
    expect(convertCustomerPartNumber('1234567890', 'MMKI')).toBe('1234567890');
  });

  it('SUZUKI menyisipkan tanda hubung setelah karakter ke-5', () => {
    expect(convertCustomerPartNumber('1234567890', 'SUZUKI')).toBe('12345-67890');
  });

  it('TBINA sama dengan SUZUKI', () => {
    expect(convertCustomerPartNumber('1234567890', 'TBINA')).toBe('12345-67890');
  });

  it('tanpa format ditentukan, perlakuannya sama dengan TBINA', () => {
    expect(convertCustomerPartNumber('1234567890', 'NONE')).toBe('12345-67890');
  });
});

describe('convertCustomerPartNumber — 13 karakter (SUZUKI)', () => {
  it('menyisipkan dua tanda hubung dengan tiga digit akhir', () => {
    expect(convertCustomerPartNumber('1234567890123', 'SUZUKI')).toBe('12345-67890-123');
  });

  it('berakhiran 000 TETAP memakai cabang yang sama — anomali bella dipertahankan', () => {
    // Di bella, dua karakter terakhir dibandingkan dengan "000" yang panjangnya
    // tiga, sehingga cabang alternatifnya tidak pernah dijalankan. Perilaku ini
    // dipertahankan agar pencocokan dengan sistem berjalan tidak berubah.
    expect(convertCustomerPartNumber('1234567890000', 'SUZUKI')).toBe('12345-67890-000');
  });
});

describe('convertCustomerPartNumber — panjang lain', () => {
  it('dikembalikan apa adanya', () => {
    expect(convertCustomerPartNumber('ABC', 'TMMIN')).toBe('ABC');
    expect(convertCustomerPartNumber('12345678901234567', 'SUZUKI')).toBe('12345678901234567');
  });

  it('spasi di tepi diabaikan', () => {
    expect(convertCustomerPartNumber('  902101234512  ', 'TMMIN')).toBe('90210-12345-12');
  });

  it('kode kosong dikembalikan kosong', () => {
    expect(convertCustomerPartNumber('   ', 'TMMIN')).toBe('');
  });
});

describe('normalkanNomorPart — bentuk SAP vs bentuk Gentani', () => {
  it('membuang tanda hubung dan membesarkan huruf', () => {
    expect(normalkanNomorPart('212110-34010')).toBe('21211034010');
    expect(normalkanNomorPart('212111-31900-04')).toBe('2121113190004');
    expect(normalkanNomorPart('219999-34300-blk')).toBe('21999934300BLK');
  });

  it('nomor yang sudah berbentuk SAP tidak berubah', () => {
    // Idempoten: tarik master SAP mengisi bentuk tanpa strip, dan menormalkan
    // ulang nilai yang sudah baku tidak boleh mengubahnya.
    expect(normalkanNomorPart('41111310110G0')).toBe('41111310110G0');
  });

  it('kartu lama dan master baru dianggap part yang sama', () => {
    /*
     * Inilah gunanya: kartu kanban tercetak membawa `212110-34010` di QR-nya,
     * sedangkan master sudah beralih ke `21211034010`. Tanpa pembandingan
     * baku, kartu sah ditolak "bukan untuk part tersebut".
     */
    expect(nomorPartSama('212110-34010', '21211034010')).toBe(true);
    expect(nomorPartSama('212110-34010', '212110-34011')).toBe(false);
  });

  it('nomor kosong TIDAK dianggap sama', () => {
    // Dua ketiadaan bukan kecocokan: itu akan membuat kartu tanpa nomor part
    // lolos pada part apa pun.
    expect(nomorPartSama(null, null)).toBe(false);
    expect(nomorPartSama('', '')).toBe(false);
  });
});
