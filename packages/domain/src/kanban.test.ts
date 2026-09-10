import { describe, it, expect } from 'vitest';
import {
  nextKanbanStatus,
  canTransition,
  InvalidKanbanTransitionError,
  resolveQtyPerKanban,
  kanbanCountFor,
} from './kanban';

describe('nextKanbanStatus', () => {
  it('mengikuti alur normal produksi sampai kirim', () => {
    expect(nextKanbanStatus('CREATED', 'PRODUCED')).toBe('PRODUCED');
    expect(nextKanbanStatus('PRODUCED', 'STORED')).toBe('STORED');
    expect(nextKanbanStatus('STORED', 'PULLED')).toBe('PULLED');
    expect(nextKanbanStatus('PULLED', 'LOADED')).toBe('LOADED');
    expect(nextKanbanStatus('LOADED', 'DELIVERED')).toBe('DELIVERED');
  });

  it('mengizinkan direct pulling: produksi langsung ditarik tanpa masuk gudang', () => {
    expect(nextKanbanStatus('PRODUCED', 'PULLED')).toBe('PULLED');
  });

  it('menolak loncat status yang tidak masuk akal', () => {
    expect(() => nextKanbanStatus('CREATED', 'DELIVERED')).toThrow(InvalidKanbanTransitionError);
    expect(() => nextKanbanStatus('CREATED', 'LOADED')).toThrow(InvalidKanbanTransitionError);
    expect(() => nextKanbanStatus('STORED', 'DELIVERED')).toThrow(InvalidKanbanTransitionError);
  });

  it('memperlakukan DELIVERED dan CANCELLED sebagai status akhir', () => {
    expect(canTransition('DELIVERED', 'PULLED')).toBe(false);
    expect(canTransition('CANCELLED', 'PRODUCED')).toBe(false);
    // Hanya koreksi tercatat yang boleh menyentuh status akhir.
    expect(nextKanbanStatus('DELIVERED', 'ADJUSTED')).toBe('DELIVERED');
  });

  it('PAIRED tidak mengubah status, hanya mencatat pasangan', () => {
    expect(nextKanbanStatus('PRODUCED', 'PAIRED')).toBe('PRODUCED');
    expect(nextKanbanStatus('PULLED', 'PAIRED')).toBe('PULLED');
  });
});

describe('resolveQtyPerKanban', () => {
  it('mengutamakan qty milik customer di atas standar part', () => {
    expect(resolveQtyPerKanban(20, 50)).toBe(50);
  });

  it('memakai standar part bila customer tidak punya override', () => {
    expect(resolveQtyPerKanban(20, null)).toBe(20);
    expect(resolveQtyPerKanban(20, undefined)).toBe(20);
  });

  it('menolak bila dua-duanya kosong, bukan diam-diam memakai 0', () => {
    expect(() => resolveQtyPerKanban(null, null)).toThrow(/belum diset/);
  });

  it('menolak nilai tidak masuk akal', () => {
    expect(() => resolveQtyPerKanban(0)).toThrow(/tidak valid/);
    expect(() => resolveQtyPerKanban(-5)).toThrow(/tidak valid/);
    expect(() => resolveQtyPerKanban(1.5)).toThrow(/tidak valid/);
  });
});

describe('kanbanCountFor', () => {
  it('membulatkan ke atas: sisa tetap butuh satu kanban', () => {
    expect(kanbanCountFor(100, 20)).toBe(5);
    expect(kanbanCountFor(101, 20)).toBe(6);
    expect(kanbanCountFor(1, 20)).toBe(1);
    expect(kanbanCountFor(0, 20)).toBe(0);
  });
});
