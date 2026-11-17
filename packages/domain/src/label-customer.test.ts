import { describe, expect, it } from 'vitest';
import { bakukanPartCustomer, potongLabelCustomer, type AturanLabelCustomer } from './label-customer';

/* Aturan dari master `customers` bella, 17 Nov 2026. */
const MMKI: AturanLabelCustomer = {
  customerId: 6,
  labelLength: 10,
  labelPartStart: 0,
  labelPartLength: 0,
  labelSerialStart: null,
  labelSerialLength: null,
};
const SUZUKI_GA11: AturanLabelCustomer = {
  customerId: 14,
  labelLength: 208,
  labelPartStart: 51,
  labelPartLength: 17,
  labelSerialStart: null,
  labelSerialLength: null,
};
const TMMIN_KRW1: AturanLabelCustomer = {
  customerId: 18,
  labelLength: 39,
  labelPartStart: 19,
  labelPartLength: 12,
  labelSerialStart: 35,
  labelSerialLength: 4,
};
const TANPA_PANJANG: AturanLabelCustomer = {
  customerId: 99,
  labelLength: 0,
  labelPartStart: 0,
  labelPartLength: 0,
  labelSerialStart: null,
  labelSerialLength: null,
};

/* QR Suzuki contoh Handika, hasil decode apa adanya (208 karakter). */
const QR_SUZUKI =
  'APT.SIM0031  0031        G11          PT.SIM      G  82081-74U00-WC301G510    GA113750NG01846834301GA1DL10100FS1 10103   22210000025      5202611130815               YTB     00000  00001 TP331   1  83   1   5';

describe('potongLabelCustomer', () => {
  it('MMKI: barcode 10 karakter = nomor part customer seluruhnya', () => {
    const hasil = potongLabelCustomer('5716A705HC', [MMKI, SUZUKI_GA11]);
    expect(hasil).toEqual([{ customerId: 6, nomorPart: '5716A705HC', seri: null }]);
  });

  it('Suzuki GA11: QR 208 karakter, part di posisi 51 sepanjang 17', () => {
    expect(QR_SUZUKI.length).toBe(208);
    const hasil = potongLabelCustomer(QR_SUZUKI, [MMKI, SUZUKI_GA11]);
    expect(hasil).toEqual([{ customerId: 14, nomorPart: '8208174U00WC3', seri: null }]);
  });

  it('spasi di ujung dibuang sebelum panjangnya diukur, seperti bella', () => {
    expect(potongLabelCustomer(`  ${QR_SUZUKI}  `, [SUZUKI_GA11])[0]?.nomorPart).toBe('8208174U00WC3');
  });

  it('seri diambil bila customer punya aturan seri', () => {
    const label = `${'X'.repeat(19)}17501BZ090B0${'Y'.repeat(4)}0042`;
    expect(label.length).toBe(39);
    expect(potongLabelCustomer(label, [TMMIN_KRW1])).toEqual([
      { customerId: 18, nomorPart: '17501BZ090B0', seri: '0042' },
    ]);
  });

  it('panjang yang tidak cocok dilewati; customer tanpa penjagaan panjang selalu ikut', () => {
    const hasil = potongLabelCustomer('ABCDE', [MMKI, SUZUKI_GA11, TANPA_PANJANG]);
    expect(hasil).toEqual([{ customerId: 99, nomorPart: 'ABCDE', seri: null }]);
  });

  it('label kosong tidak menghasilkan apa pun', () => {
    expect(potongLabelCustomer('   ', [TANPA_PANJANG])).toEqual([]);
  });
});

describe('kanban RFID TMMIN (UNIT)', () => {
  /* Contoh Handika, 17 Nov 2026: 37 karakter, part di depan, sisanya identitas kartu. */
  const RFID: AturanLabelCustomer = {
    customerId: 1,
    partNumberFormat: 'TMMIN',
    labelLength: 37,
    labelPartStart: 0,
    labelPartLength: 12,
    labelSerialStart: 13,
    labelSerialLength: 24,
  };

  it('nomor TMMIN berakhiran 00 ikut dicoba dalam bentuk master (11310-BZ200)', () => {
    const hasil = potongLabelCustomer('11310BZ20000 10000000000D403501120066', [RFID]);
    expect(hasil.map((h) => h.nomorPart)).toEqual(['11310BZ20000', '11310BZ200']);
    expect(hasil[0]?.seri).toBe('10000000000D403501120066');
  });

  it('aturan sistem lama: back number TMMIN di posisi 24, seri 4 karakter terakhir', () => {
    const LAMA: AturanLabelCustomer = { ...RFID, labelPartStart: 24, labelPartLength: 4, labelSerialStart: 33, labelSerialLength: 4 };
    expect(potongLabelCustomer('11310BZ20000 10000000000D403501120066', [LAMA])).toEqual([
      { customerId: 1, nomorPart: 'D403', seri: '0066' },
    ]);
  });

  it('tiap kartu punya seri sendiri', () => {
    const seri = [
      '11310BZ20000 10000000000D403501120066',
      '11310BZ20000 10000000000D403501121676',
      '11310BZ20000 10000000000D403501121654',
      '11310BZ20000 10000000000D403501121814',
    ].map((l) => potongLabelCustomer(l, [RFID])[0]?.seri);
    expect(new Set(seri).size).toBe(4);
  });
});

describe('bakukanPartCustomer', () => {
  it('strip, spasi, dan huruf kecil tidak membedakan', () => {
    expect(bakukanPartCustomer('82081-74u00-wc3')).toBe('8208174U00WC3');
    expect(bakukanPartCustomer('5716A705HC ')).toBe('5716A705HC');
  });
});
