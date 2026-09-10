import { describe, it, expect } from 'vitest';
import {
  explodeBom,
  summarizeRequirements,
  leafRequirements,
  qtyWithScrap,
  isEffective,
  CircularBomError,
  type BomLine,
} from './bom';

/**
 * Contoh dari kebutuhan nyata:
 *   ABC (1) → A ×1, B ×2, C ×4
 *   A       → D ×0,8 kg
 * B, C, D dibeli dari supplier.
 */
const ABC = 1;
const A = 2;
const B = 3;
const C = 4;
const D = 5;

const BOM: BomLine[] = [
  { parentPartId: ABC, componentPartId: A, qtyPer: 1 },
  { parentPartId: ABC, componentPartId: B, qtyPer: 2 },
  { parentPartId: ABC, componentPartId: C, qtyPer: 4 },
  { parentPartId: A, componentPartId: D, qtyPer: 0.8 },
];

describe('explodeBom', () => {
  it('menguraikan sampai ke raw material', () => {
    const out = explodeBom(ABC, 1, BOM);
    expect(out.map((l) => l.partId).sort()).toEqual([A, B, C, D].sort());
  });

  it('menghitung kebutuhan berjenjang', () => {
    // 10 ABC → 10 A → 8 kg D
    const total = summarizeRequirements(explodeBom(ABC, 10, BOM));
    expect(total.get(A)).toBe(10);
    expect(total.get(B)).toBe(20);
    expect(total.get(C)).toBe(40);
    expect(total.get(D)).toBeCloseTo(8, 6);
  });

  it('mencatat tingkat kedalaman', () => {
    const out = explodeBom(ABC, 1, BOM);
    expect(out.find((l) => l.partId === A)?.level).toBe(1);
    expect(out.find((l) => l.partId === D)?.level).toBe(2);
  });

  it('mencatat jalur agar asal angka bisa dijelaskan', () => {
    const d = explodeBom(ABC, 1, BOM).find((l) => l.partId === D);
    expect(d?.path).toEqual([ABC, A]);
  });

  it('part tanpa komponen menghasilkan daftar kosong', () => {
    expect(explodeBom(D, 100, BOM)).toEqual([]);
  });

  it('qty nol tetap menghasilkan struktur dengan kebutuhan nol', () => {
    const total = summarizeRequirements(explodeBom(ABC, 0, BOM));
    expect(total.get(A)).toBe(0);
    expect(total.get(D)).toBe(0);
  });
});

describe('deteksi BOM melingkar', () => {
  it('menolak siklus langsung (A butuh A)', () => {
    const bad: BomLine[] = [{ parentPartId: A, componentPartId: A, qtyPer: 1 }];
    expect(() => explodeBom(A, 1, bad)).toThrow(CircularBomError);
  });

  it('menolak siklus lewat perantara (A → B → A)', () => {
    const bad: BomLine[] = [
      { parentPartId: A, componentPartId: B, qtyPer: 1 },
      { parentPartId: B, componentPartId: A, qtyPer: 1 },
    ];
    expect(() => explodeBom(A, 1, bad)).toThrow(CircularBomError);
  });

  it('galat menyebutkan rantai yang melingkar agar bisa diperbaiki', () => {
    const bad: BomLine[] = [
      { parentPartId: A, componentPartId: B, qtyPer: 1 },
      { parentPartId: B, componentPartId: A, qtyPer: 1 },
    ];
    try {
      explodeBom(A, 1, bad);
      expect.unreachable('seharusnya melempar');
    } catch (e) {
      expect(e).toBeInstanceOf(CircularBomError);
      expect((e as CircularBomError).cycle).toContain(A);
      expect((e as CircularBomError).cycle).toContain(B);
    }
  });

  it('komponen yang sama di dua cabang BUKAN siklus', () => {
    // Baut dipakai di sub-rakitan dan di rakitan akhir — sah.
    const shared: BomLine[] = [
      { parentPartId: ABC, componentPartId: A, qtyPer: 1 },
      { parentPartId: ABC, componentPartId: B, qtyPer: 3 },
      { parentPartId: A, componentPartId: B, qtyPer: 2 },
    ];
    const total = summarizeRequirements(explodeBom(ABC, 1, shared));
    expect(total.get(B)).toBe(5); // 3 langsung + 2 lewat A
  });
});

describe('susut (scrap)', () => {
  it('menambah kebutuhan sesuai persentase', () => {
    expect(qtyWithScrap(2, 10, 5)).toBeCloseTo(21, 6);
  });

  it('tanpa susut sama dengan perkalian biasa', () => {
    expect(qtyWithScrap(2, 10)).toBe(20);
  });

  it('ikut diperhitungkan saat penguraian berjenjang', () => {
    const withScrap: BomLine[] = [
      { parentPartId: ABC, componentPartId: A, qtyPer: 1, scrapPct: 10 },
      { parentPartId: A, componentPartId: D, qtyPer: 1 },
    ];
    // 100 ABC → 110 A (susut 10%) → 110 D
    const total = summarizeRequirements(explodeBom(ABC, 100, withScrap));
    expect(total.get(A)).toBeCloseTo(110, 6);
    expect(total.get(D)).toBeCloseTo(110, 6);
  });
});

describe('masa berlaku BOM', () => {
  const versioned: BomLine[] = [
    { parentPartId: ABC, componentPartId: A, qtyPer: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
    { parentPartId: ABC, componentPartId: B, qtyPer: 1, effectiveFrom: '2026-07-01' },
  ];

  it('memakai komposisi yang berlaku pada tanggal itu', () => {
    expect(explodeBom(ABC, 1, versioned, { onDate: '2026-03-15' }).map((l) => l.partId)).toEqual([A]);
    expect(explodeBom(ABC, 1, versioned, { onDate: '2026-08-15' }).map((l) => l.partId)).toEqual([B]);
  });

  it('menelusuri produksi lama memakai komposisi lama', () => {
    // Inilah gunanya BOM berversi: audit bulan lalu tidak ikut berubah saat
    // komposisi diubah hari ini.
    const out = explodeBom(ABC, 1, versioned, { onDate: '2026-02-01' });
    expect(out.map((l) => l.partId)).toEqual([A]);
  });

  it('effectiveTo kosong berarti masih berlaku', () => {
    expect(isEffective({ parentPartId: 1, componentPartId: 2, qtyPer: 1, effectiveFrom: '2020-01-01' }, '2099-01-01')).toBe(true);
  });
});

describe('leafRequirements', () => {
  it('hanya part yang tidak punya komponen — inilah yang perlu dibeli', () => {
    const leaves = leafRequirements(explodeBom(ABC, 10, BOM), BOM);
    expect([...leaves.keys()].sort()).toEqual([B, C, D].sort());
    // A tidak termasuk karena diproduksi sendiri dari D.
    expect(leaves.has(A)).toBe(false);
    expect(leaves.get(D)).toBeCloseTo(8, 6);
  });
});
