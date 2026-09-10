/**
 * Penomoran dokumen dan lot untuk penerimaan barang.
 *
 * Fungsi murni supaya formatnya bisa diuji tanpa database, dan supaya kalau
 * suatu saat formatnya harus mengikuti aturan customer, perubahannya cukup
 * di satu tempat.
 */

/** Format tanggal YYYYMMDD dari komponen waktu lokal. */
function dateStamp(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Nomor dokumen logistik: PREFIX-YYYYMMDD-NNNN
 *
 * Urutan direset tiap hari. Nomor yang memuat tanggal jauh lebih mudah dicari
 * saat menelusuri kejadian tertentu daripada urutan berjalan tanpa konteks.
 */
export function buildDocumentNumber(prefix: string, at: Date, sequenceToday: number): string {
  return `${prefix}-${dateStamp(at)}-${String(sequenceToday).padStart(4, '0')}`;
}

/** Nomor dokumen penerimaan: RCV-YYYYMMDD-NNNN */
export function buildReceiptNumber(at: Date, sequenceToday: number): string {
  return buildDocumentNumber('RCV', at, sequenceToday);
}

/** Nomor dokumen transfer: TRF-YYYYMMDD-NNNN */
export function buildTransferNumber(at: Date, sequenceToday: number): string {
  return buildDocumentNumber('TRF', at, sequenceToday);
}

/**
 * Nomor lot internal.
 *
 * Kalau supplier menyertakan nomor lot, nomor ITU yang dipakai sebagai dasar —
 * karena itulah rujukan bersama saat ada masalah kualitas. Prefiks part
 * ditambahkan agar nomor supplier yang kebetulan sama antar part tidak saling
 * bertabrakan.
 *
 * Kalau tidak ada, sistem membuat nomor sendiri dari tanggal dan urutan.
 */
export function buildLotNumber(input: {
  partNumber: string;
  supplierLotNumber?: string | null;
  at: Date;
  sequenceToday: number;
}): string {
  const supplierLot = input.supplierLotNumber?.trim();
  if (supplierLot) {
    return `${input.partNumber}-${supplierLot}`.slice(0, 64);
  }
  return `${input.partNumber}-${dateStamp(input.at)}-${String(input.sequenceToday).padStart(3, '0')}`.slice(
    0,
    64,
  );
}

/**
 * Apakah part ini perlu dibuatkan lot saat diterima.
 *
 * Hanya yang dilacak per lot. Part berseri identitasnya sudah di nomor
 * serinya sendiri, dan part yang hanya dihitung jumlahnya tidak punya
 * identitas batch sama sekali.
 */
export function needsLot(trackingMode: string): boolean {
  return trackingMode === 'LOT';
}
