/**
 * Pembagian jumlah ke beberapa lot, yang paling lama diterima lebih dulu.
 *
 * Dipakai saat sistem harus memilih sendiri lot mana yang keluar — pengiriman
 * ke customer, misalnya, di mana petugas men-scan kanban dan tidak memilih lot
 * satu per satu.
 *
 * Kekurangan DILAPORKAN, bukan menggagalkan pembagian. Barangnya sudah naik ke
 * truk; menolak mencatatnya hanya membuat catatan makin jauh dari kenyataan.
 * Yang dibutuhkan justru sebaliknya: catat apa adanya, lalu tampilkan
 * selisihnya supaya ada yang menelusuri.
 */

export interface FifoLot {
  lotId: number;
  remainingQty: number;
  /** Dipakai mengurutkan; lot tanpa tanggal dianggap paling baru. */
  receivedAt: Date | null;
}

export interface FifoAllocation {
  lotId: number;
  qty: number;
}

export interface FifoResult {
  allocations: FifoAllocation[];
  /** Sisa yang tidak tertampung lot mana pun. Nol bila stok mencukupi. */
  unallocated: number;
}

export function allocateFifo(qty: number, lots: FifoLot[]): FifoResult {
  if (qty <= 0) return { allocations: [], unallocated: 0 };

  const ordered = [...lots]
    .filter((l) => l.remainingQty > 0)
    .sort((a, b) => {
      // Lot tanpa tanggal terima diletakkan paling belakang: yang tidak
      // diketahui umurnya jangan dipakai mendahului yang jelas lebih tua.
      if (a.receivedAt === null && b.receivedAt === null) return a.lotId - b.lotId;
      if (a.receivedAt === null) return 1;
      if (b.receivedAt === null) return -1;
      const diff = a.receivedAt.getTime() - b.receivedAt.getTime();
      return diff !== 0 ? diff : a.lotId - b.lotId;
    });

  const allocations: FifoAllocation[] = [];
  let left = qty;

  for (const lot of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remainingQty);
    allocations.push({ lotId: lot.lotId, qty: take });
    left -= take;
  }

  return { allocations, unallocated: left };
}
