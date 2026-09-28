import { describe, expect, it } from 'vitest';
import { bolehKirimDokumenRute } from './sap-movement';
import { rencanaMutasiScanProduksi } from './stock';

describe('kebijakan SAP per langkah rute', () => {
  it('Machining WIP tetap mencatat stok tanpa membuat dokumen produksi atau transfer SAP', () => {
    const rencana = rencanaMutasiScanProduksi(2, 10, 20);
    expect(rencana).toEqual([
      { type: 'PRODUCTION_IN', locationId: 10, qty: 2 },
      { type: 'TRANSFER_OUT', locationId: 10, qty: -2 },
      { type: 'TRANSFER_IN', locationId: 20, qty: 2 },
    ]);
    expect(bolehKirimDokumenRute('TT_HISTORY_SCAN', 'PRODUCTION', {
      productionEnabled: false, transferEnabled: false,
    })).toBe(false);
    expect(bolehKirimDokumenRute('TT_HISTORY_SCAN', 'TRANSFER', {
      productionEnabled: false, transferEnabled: false,
    })).toBe(false);
  });

  it('Casting yang diaktifkan mengizinkan kedua dokumen dari scan yang sama', () => {
    const aturan = { productionEnabled: true, transferEnabled: true };
    expect(bolehKirimDokumenRute('TT_HISTORY_SCAN', 'PRODUCTION', aturan)).toBe(true);
    expect(bolehKirimDokumenRute('TT_HISTORY_SCAN', 'TRANSFER', aturan)).toBe(true);
  });

  it('scan lama tanpa kebijakan tidak tiba-tiba didorong setelah fitur dipasang', () => {
    expect(bolehKirimDokumenRute('TT_HISTORY_SCAN', 'PRODUCTION')).toBe(false);
    expect(bolehKirimDokumenRute('TT_HISTORY_SCAN', 'TRANSFER')).toBe(false);
    expect(bolehKirimDokumenRute('TT_GOODS_MOVEMENT_H', 'TRANSFER')).toBe(true);
  });

  it('transfer membutuhkan SLOC asal dan tujuan yang berbeda', () => {
    expect(() => rencanaMutasiScanProduksi(1, null, 20)).toThrow();
    expect(() => rencanaMutasiScanProduksi(1, 20, 20)).toThrow();
    expect(rencanaMutasiScanProduksi(1, 20, null)).toEqual([
      { type: 'PRODUCTION_IN', locationId: 20, qty: 1 },
    ]);
  });
});
