import type { BomLine } from './bom';
import { qtyWithScrap, isEffective } from './bom';

/**
 * Perhitungan pemakaian material otomatis saat produksi.
 *
 * HANYA MENGONSUMSI KOMPONEN LANGSUNG, bukan hasil penguraian penuh.
 *
 * Ini kesalahan yang paling mudah terjadi. Saat memproduksi ABC, yang berkurang
 * adalah A, B, dan C — BUKAN D. D sudah berkurang lebih dulu ketika A
 * diproduksi. Memakai penguraian penuh akan mengurangi D dua kali dan membuat
 * stoknya terlihat jauh lebih sedikit daripada kenyataan.
 *
 * Penguraian penuh (explodeBom) tetap berguna, tapi untuk perencanaan dan
 * pembelian — bukan untuk pemakaian.
 */

export interface AvailableLot {
  lotId: number;
  partId: number;
  remainingQty: number;
  /** Dipakai mengurutkan FIFO. */
  receivedAt: Date;
}

export interface PlannedConsumption {
  componentPartId: number;
  /** Kosong untuk komponen yang tidak dilacak per lot. */
  lotId?: number;
  qty: number;
  uom: string;
}

export interface Shortage {
  componentPartId: number;
  requiredQty: number;
  availableQty: number;
}

export interface BackflushPlan {
  consumptions: PlannedConsumption[];
  /**
   * Kekurangan stok. Produksinya TIDAK dibatalkan karena barangnya memang
   * sudah jadi — menolak mencatat pemakaian tidak membuat part itu kembali
   * belum diproduksi. Kekurangan dilaporkan apa adanya supaya ketahuan bahwa
   * penerimaan barang atau data masternya tertinggal.
   */
  shortages: Shortage[];
  /** Benar bila part yang diproduksi tidak punya BOM aktif. */
  noBom: boolean;
}

/**
 * Menyusun rencana pemakaian material untuk sejumlah produksi.
 *
 * Untuk komponen ber-lot, pemakaian dialokasikan FIFO — lot yang diterima
 * lebih dulu dipakai lebih dulu. Ini bukan sekadar konvensi akuntansi: untuk
 * material yang punya masa simpan, memakai lot lama lebih dulu memang yang
 * benar secara proses.
 */
export function planBackflush(input: {
  producedPartId: number;
  qty: number;
  bomLines: readonly BomLine[];
  onDate: string;
  /** Lot tersedia per komponen. Kosongkan untuk komponen non-lot. */
  availableLots?: readonly AvailableLot[];
}): BackflushPlan {
  const { producedPartId, qty, bomLines, onDate } = input;

  const direct = bomLines.filter(
    (l) => l.parentPartId === producedPartId && isEffective(l, onDate),
  );

  if (direct.length === 0) {
    return { consumptions: [], shortages: [], noBom: true };
  }

  const consumptions: PlannedConsumption[] = [];
  const shortages: Shortage[] = [];

  // Kelompokkan lot per part, urut FIFO, sekali di awal.
  const lotsByPart = new Map<number, AvailableLot[]>();
  for (const lot of input.availableLots ?? []) {
    if (lot.remainingQty <= 0) continue;
    const list = lotsByPart.get(lot.partId);
    if (list) list.push(lot);
    else lotsByPart.set(lot.partId, [lot]);
  }
  for (const list of lotsByPart.values()) {
    list.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  for (const line of direct) {
    const required = qtyWithScrap(line.qtyPer, qty, line.scrapPct);
    const uom = line.uom ?? 'pcs';
    const lots = lotsByPart.get(line.componentPartId);

    if (!lots || lots.length === 0) {
      // Komponen tanpa lot: catat pemakaian tanpa merujuk lot mana pun.
      consumptions.push({ componentPartId: line.componentPartId, qty: required, uom });
      continue;
    }

    let remaining = required;
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.remainingQty, remaining);
      if (take <= 0) continue;
      consumptions.push({
        componentPartId: line.componentPartId,
        lotId: lot.lotId,
        qty: take,
        uom,
      });
      lot.remainingQty -= take;
      remaining -= take;
    }

    if (remaining > 1e-9) {
      // Stok tidak cukup. Sisanya tetap dicatat sebagai pemakaian tanpa lot,
      // sehingga total pemakaian tetap benar dan saldo menunjukkan minus —
      // itulah sinyal bahwa ada yang perlu dibereskan.
      consumptions.push({ componentPartId: line.componentPartId, qty: remaining, uom });
      shortages.push({
        componentPartId: line.componentPartId,
        requiredQty: required,
        availableQty: required - remaining,
      });
    }
  }

  return { consumptions, shortages, noBom: false };
}

/**
 * Hasil peleburan ulang barang NG.
 *
 * Part A yang NG kembali menjadi raw material D. Ini perubahan identitas,
 * bukan sekadar kehilangan: stok A berkurang DAN stok D bertambah.
 *
 * Rasionya diambil dari aturan scrap, bukan dari BOM. Melebur selalu
 * kehilangan sebagian material karena terbakar dan menempel di tungku, jadi
 * memakai angka BOM apa adanya akan membuat stok D terlihat lebih banyak
 * daripada kenyataan.
 */
export function remeltYield(
  ngQty: number,
  conversionQty: number,
): { convertedQty: number } {
  if (ngQty < 0) throw new Error('Jumlah NG tidak boleh negatif');
  if (conversionQty < 0) throw new Error('Rasio konversi tidak boleh negatif');
  return { convertedQty: ngQty * conversionQty };
}
