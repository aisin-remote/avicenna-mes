import { describe, it, expect } from 'vitest';
import { summarizeMutations, signedQty, stockVariance, type MutationRow } from './stock';

const at = (iso: string) => new Date(iso);

describe('summarizeMutations', () => {
  it('menjumlahkan masuk dan keluar terhadap saldo awal', () => {
    const rows: MutationRow[] = [
      { type: 'PRODUCTION_IN', qty: 100, occurredAt: at('2026-09-10T08:00:00Z') },
      { type: 'DELIVERY_OUT', qty: -40, occurredAt: at('2026-09-10T10:00:00Z') },
      { type: 'NG_OUT', qty: -5, occurredAt: at('2026-09-10T11:00:00Z') },
    ];
    expect(summarizeMutations(50, rows)).toEqual({
      openingQty: 50,
      inQty: 100,
      outQty: 45,
      closingQty: 105,
    });
  });

  it('STOCK_TAKE menetapkan saldo, bukan menambahkan', () => {
    const rows: MutationRow[] = [
      { type: 'PRODUCTION_IN', qty: 100, occurredAt: at('2026-09-10T08:00:00Z') },
      { type: 'STOCK_TAKE', qty: 70, occurredAt: at('2026-09-10T12:00:00Z') },
      { type: 'DELIVERY_OUT', qty: -20, occurredAt: at('2026-09-10T14:00:00Z') },
    ];
    // Setelah opname menetapkan 70, hanya mutasi sesudahnya yang dihitung.
    expect(summarizeMutations(0, rows).closingQty).toBe(50);
  });

  it('mengurutkan berdasarkan waktu, bukan urutan array', () => {
    const rows: MutationRow[] = [
      { type: 'DELIVERY_OUT', qty: -20, occurredAt: at('2026-09-10T14:00:00Z') },
      { type: 'STOCK_TAKE', qty: 70, occurredAt: at('2026-09-10T12:00:00Z') },
    ];
    expect(summarizeMutations(0, rows).closingQty).toBe(50);
  });

  it('saldo bisa minus — ini dilaporkan apa adanya, bukan dipaksa nol', () => {
    const rows: MutationRow[] = [
      { type: 'DELIVERY_OUT', qty: -30, occurredAt: at('2026-09-10T10:00:00Z') },
    ];
    expect(summarizeMutations(10, rows).closingQty).toBe(-20);
  });

  it('daftar kosong mengembalikan saldo awal', () => {
    expect(summarizeMutations(25, [])).toEqual({
      openingQty: 25,
      inQty: 0,
      outQty: 0,
      closingQty: 25,
    });
  });
});

describe('signedQty', () => {
  it('memberi tanda sesuai jenis mutasi', () => {
    expect(signedQty('PRODUCTION_IN', 100)).toBe(100);
    expect(signedQty('DELIVERY_OUT', 40)).toBe(-40);
    expect(signedQty('NG_OUT', 5)).toBe(-5);
  });

  it('menolak input negatif supaya tanda tidak dobel', () => {
    expect(() => signedQty('DELIVERY_OUT', -40)).toThrow(/harus positif/);
  });

  it('memaksa ADJUSTMENT ditulis eksplisit', () => {
    expect(() => signedQty('ADJUSTMENT', 10)).toThrow(/eksplisit/);
  });
});

describe('stockVariance', () => {
  it('positif bila fisik lebih banyak dari catatan', () => {
    expect(stockVariance(100, 105)).toBe(5);
    expect(stockVariance(100, 95)).toBe(-5);
  });
});
