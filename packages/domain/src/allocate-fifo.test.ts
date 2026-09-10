import { describe, it, expect } from 'vitest';
import { allocateFifo } from './allocate-fifo';

const d = (s: string) => new Date(s);

describe('allocateFifo', () => {
  it('mengambil dari lot yang paling lama diterima lebih dulu', () => {
    const res = allocateFifo(30, [
      { lotId: 2, remainingQty: 100, receivedAt: d('2026-03-02') },
      { lotId: 1, remainingQty: 100, receivedAt: d('2026-03-01') },
    ]);
    expect(res.allocations).toEqual([{ lotId: 1, qty: 30 }]);
    expect(res.unallocated).toBe(0);
  });

  it('melanjutkan ke lot berikutnya saat lot pertama habis', () => {
    const res = allocateFifo(120, [
      { lotId: 1, remainingQty: 100, receivedAt: d('2026-03-01') },
      { lotId: 2, remainingQty: 100, receivedAt: d('2026-03-02') },
    ]);
    expect(res.allocations).toEqual([
      { lotId: 1, qty: 100 },
      { lotId: 2, qty: 20 },
    ]);
    expect(res.unallocated).toBe(0);
  });

  it('melaporkan kekurangan tanpa menggagalkan pembagian', () => {
    const res = allocateFifo(150, [{ lotId: 1, remainingQty: 100, receivedAt: d('2026-03-01') }]);
    expect(res.allocations).toEqual([{ lotId: 1, qty: 100 }]);
    expect(res.unallocated).toBe(50);
  });

  it('melewati lot yang sudah kosong atau minus', () => {
    const res = allocateFifo(10, [
      { lotId: 1, remainingQty: 0, receivedAt: d('2026-03-01') },
      { lotId: 2, remainingQty: -5, receivedAt: d('2026-03-02') },
      { lotId: 3, remainingQty: 10, receivedAt: d('2026-03-03') },
    ]);
    expect(res.allocations).toEqual([{ lotId: 3, qty: 10 }]);
  });

  it('menaruh lot tanpa tanggal terima paling belakang', () => {
    const res = allocateFifo(10, [
      { lotId: 1, remainingQty: 10, receivedAt: null },
      { lotId: 2, remainingQty: 10, receivedAt: d('2026-03-05') },
    ]);
    expect(res.allocations).toEqual([{ lotId: 2, qty: 10 }]);
  });

  it('mengembalikan hasil kosong bila tidak ada lot sama sekali', () => {
    const res = allocateFifo(10, []);
    expect(res.allocations).toEqual([]);
    expect(res.unallocated).toBe(10);
  });

  it('tidak membagi apa pun untuk jumlah nol atau negatif', () => {
    expect(allocateFifo(0, [{ lotId: 1, remainingQty: 5, receivedAt: null }])).toEqual({
      allocations: [],
      unallocated: 0,
    });
    expect(allocateFifo(-3, [{ lotId: 1, remainingQty: 5, receivedAt: null }]).allocations).toEqual(
      [],
    );
  });

  it('mengurutkan stabil memakai id saat tanggalnya sama', () => {
    const res = allocateFifo(15, [
      { lotId: 9, remainingQty: 10, receivedAt: d('2026-03-01') },
      { lotId: 4, remainingQty: 10, receivedAt: d('2026-03-01') },
    ]);
    expect(res.allocations).toEqual([
      { lotId: 4, qty: 10 },
      { lotId: 9, qty: 5 },
    ]);
  });
});
