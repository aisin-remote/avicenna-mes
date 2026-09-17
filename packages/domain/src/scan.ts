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

/*
 * Pembacaan barcode ada di barcode.ts, bukan di sini.
 *
 * Formatnya berbeda-beda per customer dan per proses, sehingga satu fungsi
 * dengan rentetan `if` tidak lagi memadai — di sana tiap format berdiri sebagai
 * aturan tersendiri yang bisa ditest sendiri, dan hasil bacanya menyertakan
 * nama aturan yang dipakai.
 */
export { bacaBarcode, type ParsedBarcode } from './barcode';

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
