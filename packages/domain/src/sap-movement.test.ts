import { describe, it, expect } from 'vitest';
import { sapMovementFor, docTypeOf, siapDikirim, SAP_MOVEMENTS } from './sap-movement';

describe('sapMovementFor', () => {
  it('memetakan penerimaan ke goods receipt', () => {
    expect(sapMovementFor('RECEIVING_IN')).toMatchObject({
      docType: 'GOODS_RECEIPT',
      movementType: '101',
      kirim: true,
    });
  });

  it('tidak mengirim sisi masuk dari perpindahan', () => {
    // Perpindahan antar SLOC adalah SATU dokumen SAP. Mengirim kedua sisinya
    // membuat stok berpindah dua kali.
    const masuk = sapMovementFor('TRANSFER_IN');
    expect(masuk?.kirim).toBe(false);
    expect(masuk?.alasan).toMatch(/sudah terwakili/);
    expect(sapMovementFor('TRANSFER_OUT')?.kirim).toBe(true);
  });

  it('tidak mengirim hasil stock opname', () => {
    expect(sapMovementFor('STOCK_TAKE')?.kirim).toBe(false);
  });

  it('mengembalikan undefined untuk jenis yang tak dikenal', () => {
    expect(sapMovementFor('ENTAH_APA')).toBeUndefined();
  });
});

describe('docTypeOf', () => {
  it('produksi menang atas pemakaian komponennya', () => {
    // Satu scan produksi menghasilkan barang jadi DAN memakai komponen;
    // di SAP keduanya satu dokumen konfirmasi produksi.
    expect(docTypeOf(['CONSUMPTION_OUT', 'PRODUCTION_IN'])).toBe('PRODUCTION');
  });

  it('perpindahan dikenali dari sisi keluar maupun masuk', () => {
    expect(docTypeOf(['TRANSFER_OUT', 'TRANSFER_IN'])).toBe('TRANSFER');
  });

  it('pengiriman dikenali', () => {
    expect(docTypeOf(['DELIVERY_OUT'])).toBe('DELIVERY');
  });

  it('mengembalikan undefined bila tak ada yang dikenal', () => {
    expect(docTypeOf(['ENTAH', 'APA'])).toBeUndefined();
  });
});

describe('siapDikirim', () => {
  it('siap bila semua movement type sudah punya angka', () => {
    expect(siapDikirim(['RECEIVING_IN', 'TRANSFER_OUT'])).toEqual({ siap: true, belum: [] });
  });

  it('jenis yang tidak dikirim tidak menahan dokumen', () => {
    // STOCK_TAKE tidak punya angka, tapi juga tidak dikirim — tidak boleh
    // membuat dokumennya tertahan.
    expect(siapDikirim(['STOCK_TAKE']).siap).toBe(true);
  });

  it('menahan dan menyebutkan jenis yang belum punya angka', () => {
    const asli = SAP_MOVEMENTS.NG_OUT!.movementType;
    SAP_MOVEMENTS.NG_OUT!.movementType = null;
    try {
      const hasil = siapDikirim(['NG_OUT', 'RECEIVING_IN']);
      expect(hasil.siap).toBe(false);
      expect(hasil.belum).toEqual(['NG_OUT']);
    } finally {
      SAP_MOVEMENTS.NG_OUT!.movementType = asli;
    }
  });

  it('tidak mengulang jenis yang sama', () => {
    expect(siapDikirim(['RECEIVING_IN', 'RECEIVING_IN']).belum).toEqual([]);
  });
});
