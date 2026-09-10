import { describe, it, expect } from 'vitest';
import { planBackflush, remeltYield, type AvailableLot } from './backflush';
import type { BomLine } from './bom';

const ABC = 1;
const A = 2;
const B = 3;
const C = 4;
const D = 5;

const BOM: BomLine[] = [
  { parentPartId: ABC, componentPartId: A, qtyPer: 1 },
  { parentPartId: ABC, componentPartId: B, qtyPer: 2 },
  { parentPartId: ABC, componentPartId: C, qtyPer: 4 },
  { parentPartId: A, componentPartId: D, qtyPer: 0.8, uom: 'kg' },
];

const TODAY = '2026-09-10';
const lot = (lotId: number, partId: number, qty: number, day: number): AvailableLot => ({
  lotId,
  partId,
  remainingQty: qty,
  receivedAt: new Date(`2026-09-${String(day).padStart(2, '0')}T08:00:00Z`),
});

describe('planBackflush — hanya komponen langsung', () => {
  it('memproduksi ABC mengurangi A, B, C — TIDAK mengurangi D', () => {
    const plan = planBackflush({ producedPartId: ABC, qty: 1, bomLines: BOM, onDate: TODAY });
    const parts = plan.consumptions.map((c) => c.componentPartId).sort();
    expect(parts).toEqual([A, B, C].sort());
    // D sudah berkurang saat A diproduksi. Menguranginya lagi di sini akan
    // menghitung ganda dan membuat stok D terlihat jauh lebih sedikit.
    expect(parts).not.toContain(D);
  });

  it('memproduksi A mengurangi D', () => {
    const plan = planBackflush({ producedPartId: A, qty: 10, bomLines: BOM, onDate: TODAY });
    expect(plan.consumptions).toEqual([
      { componentPartId: D, qty: 8, uom: 'kg' },
    ]);
  });

  it('jumlahnya mengikuti qty produksi', () => {
    const plan = planBackflush({ producedPartId: ABC, qty: 5, bomLines: BOM, onDate: TODAY });
    const byPart = new Map(plan.consumptions.map((c) => [c.componentPartId, c.qty]));
    expect(byPart.get(A)).toBe(5);
    expect(byPart.get(B)).toBe(10);
    expect(byPart.get(C)).toBe(20);
  });

  it('part tanpa BOM ditandai, bukan dianggap gagal', () => {
    const plan = planBackflush({ producedPartId: D, qty: 100, bomLines: BOM, onDate: TODAY });
    expect(plan.noBom).toBe(true);
    expect(plan.consumptions).toEqual([]);
    expect(plan.shortages).toEqual([]);
  });

  it('susut ikut diperhitungkan', () => {
    const withScrap: BomLine[] = [
      { parentPartId: ABC, componentPartId: B, qtyPer: 2, scrapPct: 10 },
    ];
    const plan = planBackflush({ producedPartId: ABC, qty: 100, bomLines: withScrap, onDate: TODAY });
    expect(plan.consumptions[0]?.qty).toBeCloseTo(220, 6);
  });

  it('BOM yang sudah tidak berlaku diabaikan', () => {
    const expired: BomLine[] = [
      { parentPartId: ABC, componentPartId: B, qtyPer: 2, effectiveTo: '2026-01-31' },
    ];
    expect(planBackflush({ producedPartId: ABC, qty: 1, bomLines: expired, onDate: TODAY }).noBom).toBe(true);
  });
});

describe('planBackflush — alokasi lot FIFO', () => {
  it('memakai lot yang diterima lebih dulu', () => {
    const plan = planBackflush({
      producedPartId: ABC,
      qty: 10,
      bomLines: [{ parentPartId: ABC, componentPartId: B, qtyPer: 1 }],
      onDate: TODAY,
      availableLots: [lot(200, B, 50, 5), lot(100, B, 4, 1)],
    });
    // Lot 100 diterima 1 Sep, jadi dipakai lebih dulu meski jumlahnya kecil.
    expect(plan.consumptions[0]).toEqual({ componentPartId: B, lotId: 100, qty: 4, uom: 'pcs' });
    expect(plan.consumptions[1]).toEqual({ componentPartId: B, lotId: 200, qty: 6, uom: 'pcs' });
  });

  it('memecah pemakaian ke beberapa lot bila satu lot tidak cukup', () => {
    const plan = planBackflush({
      producedPartId: ABC,
      qty: 10,
      bomLines: [{ parentPartId: ABC, componentPartId: B, qtyPer: 1 }],
      onDate: TODAY,
      availableLots: [lot(1, B, 3, 1), lot(2, B, 3, 2), lot(3, B, 10, 3)],
    });
    expect(plan.consumptions.map((c) => [c.lotId, c.qty])).toEqual([[1, 3], [2, 3], [3, 4]]);
    expect(plan.shortages).toEqual([]);
  });

  it('lot kosong dilewati', () => {
    const plan = planBackflush({
      producedPartId: ABC,
      qty: 2,
      bomLines: [{ parentPartId: ABC, componentPartId: B, qtyPer: 1 }],
      onDate: TODAY,
      availableLots: [lot(1, B, 0, 1), lot(2, B, 5, 2)],
    });
    expect(plan.consumptions).toEqual([{ componentPartId: B, lotId: 2, qty: 2, uom: 'pcs' }]);
  });

  it('komponen tanpa lot dicatat tanpa merujuk lot', () => {
    const plan = planBackflush({
      producedPartId: ABC,
      qty: 3,
      bomLines: [{ parentPartId: ABC, componentPartId: A, qtyPer: 1 }],
      onDate: TODAY,
      availableLots: [],
    });
    expect(plan.consumptions[0]?.lotId).toBeUndefined();
    expect(plan.consumptions[0]?.qty).toBe(3);
  });
});

describe('planBackflush — stok kurang', () => {
  it('tetap mencatat pemakaian penuh dan melaporkan kekurangan', () => {
    const plan = planBackflush({
      producedPartId: ABC,
      qty: 10,
      bomLines: [{ parentPartId: ABC, componentPartId: B, qtyPer: 1 }],
      onDate: TODAY,
      availableLots: [lot(1, B, 4, 1)],
    });
    // Barangnya sudah jadi; menolak mencatat tidak membuatnya belum diproduksi.
    const total = plan.consumptions.reduce((s, c) => s + c.qty, 0);
    expect(total).toBe(10);
    expect(plan.shortages).toEqual([{ componentPartId: B, requiredQty: 10, availableQty: 4 }]);
  });

  it('tidak melaporkan kekurangan bila stok pas', () => {
    const plan = planBackflush({
      producedPartId: ABC,
      qty: 5,
      bomLines: [{ parentPartId: ABC, componentPartId: B, qtyPer: 1 }],
      onDate: TODAY,
      availableLots: [lot(1, B, 5, 1)],
    });
    expect(plan.shortages).toEqual([]);
  });
});

describe('remeltYield', () => {
  it('part A NG menjadi raw material D sesuai rasio', () => {
    // 10 pcs A NG, 1 pcs menghasilkan 0,75 kg D (lebih kecil dari 0,8 di BOM
    // karena ada susut pembakaran).
    expect(remeltYield(10, 0.75).convertedQty).toBeCloseTo(7.5, 6);
  });

  it('rasio nol berarti tidak ada yang bisa dipulihkan', () => {
    expect(remeltYield(10, 0).convertedQty).toBe(0);
  });

  it('menolak angka negatif', () => {
    expect(() => remeltYield(-1, 0.8)).toThrow(/tidak boleh negatif/);
    expect(() => remeltYield(1, -0.8)).toThrow(/tidak boleh negatif/);
  });
});
