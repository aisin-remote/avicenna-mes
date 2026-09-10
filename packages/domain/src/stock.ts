/**
 * Perhitungan stok dari buku besar mutasi.
 *
 * Aturan pokoknya: saldo SELALU turunan dari mutations, tidak pernah disimpan
 * sebagai satu-satunya kebenaran. Tabel stock_balances hanya cache yang bisa
 * dibangun ulang dengan fungsi-fungsi di file ini.
 *
 * Ini menjawab masalah lama: `production_stocks` bella diperbarui lewat trigger
 * MySQL, sehingga saat angkanya melenceng tidak ada cara menelusuri sebabnya.
 */

export type MutationType =
  | 'PRODUCTION_IN'
  | 'DELIVERY_OUT'
  | 'NG_OUT'
  | 'ADJUSTMENT'
  | 'STOCK_TAKE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RECEIVING_IN';

export interface MutationRow {
  type: MutationType;
  /** Bertanda: + masuk, - keluar. */
  qty: number;
  occurredAt: Date;
}

export interface StockSummary {
  openingQty: number;
  inQty: number;
  outQty: number;
  closingQty: number;
}

/**
 * Melipat daftar mutasi menjadi ringkasan saldo.
 *
 * STOCK_TAKE diperlakukan khusus: hasil opname MENETAPKAN saldo, bukan
 * menambah/mengurangi. Semua mutasi sebelumnya dalam periode yang sama jadi
 * tidak relevan terhadap angka akhir.
 */
export function summarizeMutations(opening: number, rows: readonly MutationRow[]): StockSummary {
  const sorted = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let inQty = 0;
  let outQty = 0;
  let closing = opening;

  for (const row of sorted) {
    if (row.type === 'STOCK_TAKE') {
      closing = row.qty;
      inQty = 0;
      outQty = 0;
      continue;
    }
    if (row.qty >= 0) inQty += row.qty;
    else outQty += Math.abs(row.qty);
    closing += row.qty;
  }

  return { openingQty: opening, inQty, outQty, closingQty: closing };
}

/** Tanda qty yang benar untuk sebuah tipe mutasi. Mencegah salah tanda saat menulis. */
export function signedQty(type: MutationType, absoluteQty: number): number {
  if (absoluteQty < 0) throw new Error('absoluteQty harus positif; tandanya ditentukan oleh type');

  switch (type) {
    case 'PRODUCTION_IN':
    case 'TRANSFER_IN':
    case 'RECEIVING_IN':
      return absoluteQty;
    case 'DELIVERY_OUT':
    case 'NG_OUT':
    case 'TRANSFER_OUT':
      return -absoluteQty;
    case 'STOCK_TAKE':
      // Nilai mutlak hasil hitung fisik.
      return absoluteQty;
    case 'ADJUSTMENT':
      throw new Error('ADJUSTMENT harus menyertakan tanda secara eksplisit, jangan lewat signedQty');
  }
}

/** Selisih stok fisik terhadap catatan sistem — dipakai saat opname. */
export function stockVariance(systemQty: number, physicalQty: number): number {
  return physicalQty - systemQty;
}
