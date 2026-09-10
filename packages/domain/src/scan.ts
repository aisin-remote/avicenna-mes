import { createHash } from 'node:crypto';
import type { ScanInput } from '@avicenna/contracts';

/**
 * Kunci idempoten untuk satu scan.
 *
 * Scanner di pabrik memakai WiFi yang sering putus-nyambung; device biasanya
 * mengirim ulang antreannya saat tersambung kembali. Sistem lama menghasilkan
 * baris dobel karena itu. Kunci ini dipasang sebagai UNIQUE index di
 * scan_events, jadi pencegahan dobel dilakukan database — bukan logika app
 * yang bisa kalah balapan saat request paralel.
 *
 * Kalau device mengirim `clientRef`, itu yang dipakai (paling akurat).
 * Kalau tidak, kunci dibentuk dari isi scan + waktu yang dibulatkan ke detik,
 * sehingga kiriman ulang dalam detik yang sama tetap tertangkap.
 */
export function buildDedupeKey(input: {
  kind: string;
  rawCode: string;
  lineCode?: string | null;
  clientRef?: string | null;
  scannedAt: Date;
}): string {
  if (input.clientRef) {
    return hash(`ref:${input.kind}:${input.clientRef}`);
  }
  const bucket = Math.floor(input.scannedAt.getTime() / 1000);
  return hash(`sig:${input.kind}:${input.rawCode}:${input.lineCode ?? ''}:${bucket}`);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 64);
}

export interface ParsedBarcode {
  raw: string;
  partNumber?: string;
  backNumber?: string;
  serialNumber?: string;
  qty?: number;
}

/**
 * Pembacaan barcode.
 *
 * PENTING — ini masih placeholder. Format asli di lapangan ada di
 * TraceScanController (avicenna) dan PisController (bella), dan setiap
 * customer bisa berbeda. Ganti isi fungsi ini setelah format sebenarnya
 * didokumentasikan; strukturnya sengaja dibuat murni supaya tiap format
 * baru bisa langsung ditulis test-nya.
 *
 * Format sementara yang dikenali: `PARTNUMBER|BACKNUMBER|SERIAL|QTY`
 */
export function parseBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error('Barcode kosong');

  const parts = trimmed.split('|');
  if (parts.length === 1) {
    // Barcode polos: anggap seluruh isinya nomor seri.
    return { raw: trimmed, serialNumber: trimmed };
  }

  const [partNumber, backNumber, serialNumber, qtyRaw] = parts;
  const qty = qtyRaw ? Number.parseInt(qtyRaw, 10) : undefined;

  return {
    raw: trimmed,
    partNumber: partNumber?.trim() || undefined,
    backNumber: backNumber?.trim() || undefined,
    serialNumber: serialNumber?.trim() || undefined,
    qty: qty !== undefined && Number.isFinite(qty) && qty > 0 ? qty : undefined,
  };
}

/** Melengkapi field opsional ScanInput dengan nilai default sebelum disimpan. */
export function normalizeScan(input: ScanInput, now: Date = new Date()) {
  const scannedAt = input.scannedAt ?? now;
  return {
    ...input,
    scannedAt,
    qty: input.qty ?? 1,
    dedupeKey: buildDedupeKey({
      kind: input.kind,
      rawCode: input.rawCode,
      lineCode: input.lineCode,
      clientRef: input.clientRef,
      scannedAt,
    }),
  };
}
