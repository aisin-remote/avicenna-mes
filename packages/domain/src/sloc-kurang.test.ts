import { describe, it, expect } from 'vitest';
import { slocKurang, type BarisPerpindahan } from './sap-movement';

const baris = (v: Partial<BarisPerpindahan>): BarisPerpindahan => ({
  mutationType: 'TRANSFER_OUT',
  qty: -10,
  slocFrom: null,
  slocTo: null,
  ...v,
});

describe('slocKurang', () => {
  it('meloloskan transfer yang punya asal dan tujuan', () => {
    const hasil = slocKurang('TRANSFER', [
      baris({ slocFrom: 'PP02', slocTo: 'PP04', partNumber: 'AV-1' }),
    ]);
    expect(hasil).toEqual([]);
  });

  it('menahan transfer yang kehilangan tujuan', () => {
    // Justru ini yang paling mudah hilang: tujuan datang dari baris masuk
    // pasangannya, yang sengaja tidak ikut dikirim.
    const hasil = slocKurang('TRANSFER', [
      baris({ slocFrom: 'PP02', slocTo: null, partNumber: 'AV-1' }),
    ]);
    expect(hasil).toEqual(['TRANSFER_OUT AV-1: SLOC tujuan kosong']);
  });

  it('menahan transfer yang kehilangan asal', () => {
    const hasil = slocKurang('TRANSFER', [baris({ slocFrom: null, slocTo: 'PP04' })]);
    expect(hasil).toEqual(['TRANSFER_OUT: SLOC asal kosong']);
  });

  it('menyebut kedua sisi bila dua-duanya kosong', () => {
    const hasil = slocKurang('TRANSFER', [baris({})]);
    expect(hasil).toHaveLength(2);
  });

  it('penerimaan hanya butuh tujuan', () => {
    const masuk = baris({ mutationType: 'RECEIVING_IN', qty: 500, slocTo: 'WH00' });
    expect(slocKurang('GOODS_RECEIPT', [masuk])).toEqual([]);
  });

  it('menahan penerimaan tanpa tujuan', () => {
    const masuk = baris({ mutationType: 'RECEIVING_IN', qty: 500, slocTo: null });
    expect(slocKurang('GOODS_RECEIPT', [masuk])).toEqual(['RECEIVING_IN: SLOC tujuan kosong']);
  });

  it('pengiriman keluar hanya butuh asal', () => {
    const keluar = baris({ mutationType: 'DELIVERY_OUT', qty: -60, slocFrom: 'PP04' });
    expect(slocKurang('DELIVERY', [keluar])).toEqual([]);
  });

  it('menahan pengiriman keluar tanpa asal', () => {
    const keluar = baris({ mutationType: 'DELIVERY_OUT', qty: -60, slocFrom: null });
    expect(slocKurang('DELIVERY', [keluar])).toEqual(['DELIVERY_OUT: SLOC asal kosong']);
  });

  it('dokumen produksi memeriksa tiap sisi sesuai arahnya', () => {
    // Satu dokumen konfirmasi produksi memuat hasil jadi (masuk ke PP02) dan
    // pemakaian komponen (keluar dari WP01). Keduanya diperiksa berbeda.
    const hasil = slocKurang('PRODUCTION', [
      baris({ mutationType: 'PRODUCTION_IN', qty: 10, slocTo: 'PP02' }),
      baris({ mutationType: 'CONSUMPTION_OUT', qty: -17.34, slocFrom: 'WP01' }),
    ]);
    expect(hasil).toEqual([]);
  });

  it('menahan produksi yang komponennya tidak punya SLOC asal', () => {
    const hasil = slocKurang('PRODUCTION', [
      baris({ mutationType: 'PRODUCTION_IN', qty: 10, slocTo: 'PP02' }),
      baris({ mutationType: 'CONSUMPTION_OUT', qty: -17.34, slocFrom: null }),
    ]);
    expect(hasil).toEqual(['CONSUMPTION_OUT: SLOC asal kosong']);
  });

  it('penyesuaian mengikuti tanda qty-nya', () => {
    const turun = baris({ mutationType: 'ADJUSTMENT', qty: -1, slocFrom: 'WH00' });
    const naik = baris({ mutationType: 'ADJUSTMENT', qty: 1, slocTo: 'WH00' });
    expect(slocKurang('ADJUSTMENT', [turun])).toEqual([]);
    expect(slocKurang('ADJUSTMENT', [naik])).toEqual([]);
    expect(slocKurang('ADJUSTMENT', [baris({ mutationType: 'ADJUSTMENT', qty: -1 })])).toEqual([
      'ADJUSTMENT: SLOC asal kosong',
    ]);
  });

  it('tidak mengulang masalah yang sama dua kali', () => {
    // Satu loading list bisa memuat puluhan baris part yang sama; layar
    // pemantauan tidak berguna kalau pesannya terulang puluhan kali.
    const hasil = slocKurang('DELIVERY', [
      baris({ mutationType: 'DELIVERY_OUT', qty: -10, partNumber: 'AV-1' }),
      baris({ mutationType: 'DELIVERY_OUT', qty: -20, partNumber: 'AV-1' }),
    ]);
    expect(hasil).toEqual(['DELIVERY_OUT AV-1: SLOC asal kosong']);
  });

  it('dokumen tanpa baris dianggap lengkap', () => {
    expect(slocKurang('TRANSFER', [])).toEqual([]);
  });
});
