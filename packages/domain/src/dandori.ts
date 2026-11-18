import type { MetodeDandori, ScanModeTersimpan } from '@avicenna/contracts';

/**
 * Dandori — pergantian model di sebuah line.
 *
 * Sebelum scan produksi diterima, MP memasang part (atau mold) yang akan
 * diproduksi: menekan DANDORI, men-scan kode dandorinya, lalu START. Sejak itu
 * hanya part itu yang boleh discan, dan metode scannya mengikuti rute part itu
 * di work center ini. Keputusan Handika, 11 Nov 2026.
 */

/** Penanda QR dandori. Bentuknya `DANDORI-<nomor part>`, dicetak aplikasi printer QR. */
export const PENANDA_DANDORI = 'DANDORI-';

/**
 * Nomor part dari QR dandori, atau null bila teksnya bukan QR dandori.
 *
 * Nomor part ditulis bergaris maupun tidak (`DANDORI-212110-34010` dan
 * `DANDORI-21211034010` sama-sama sah); pencariannya memakai bentuk baku di
 * lapisan service, jadi di sini cukup dipotong dan dibersihkan.
 */
export function bacaKodeDandori(raw: string): string | null {
  const teks = raw.trim();
  if (teks.slice(0, PENANDA_DANDORI.length).toUpperCase() !== PENANDA_DANDORI) return null;
  const nomor = teks.slice(PENANDA_DANDORI.length).trim();
  return /^[A-Za-z0-9][A-Za-z0-9.\-_/ ]{2,63}$/.test(nomor) ? nomor : null;
}

/** Penanda label master sample BODY, mis. `MODEL-423117-10870-AA7`. */
export const PENANDA_SAMPLE = 'MODEL-';

/**
 * Nomor part dari label master sample.
 *
 * Label sample di line BODY berbentuk `MODEL-<nomor part>`; sample lama yang
 * hanya berisi nomor part polos tetap diterima. Penanda dibuang di sini supaya
 * pencarian part tidak ikut membaca "MODEL" sebagai bagian nomornya.
 */
export function bacaKodeSample(raw: string): string {
  const teks = raw.trim();
  return teks.slice(0, PENANDA_SAMPLE.length).toUpperCase() === PENANDA_SAMPLE
    ? teks.slice(PENANDA_SAMPLE.length).trim()
    : teks;
}

/** Apakah teks ini QR dandori — dipakai layar untuk memilih kotak scan. */
export function sepertiKodeDandori(raw: string): boolean {
  return bacaKodeDandori(raw) !== null;
}

/**
 * Cara dandori sebuah line, dari metode scan line-nya.
 *
 * Line per kanban (BODY) men-scan master sample sesudah QR dandori; line mold
 * memasang mold lewat tagnya, karena satu mold berisi beberapa part dan QR
 * dandori hanya menunjuk satu.
 */
export function metodeDandori(mode: ScanModeTersimpan | null | undefined): MetodeDandori {
  if (mode === 'KANBAN_MOLD') return 'MOLD';
  if (mode === 'KANBAN_BOX' || mode === 'KANBAN_BOX_DANDORI' || mode === 'PER_KANBAN') {
    return 'PART_SAMPLE';
  }
  return 'PART';
}
