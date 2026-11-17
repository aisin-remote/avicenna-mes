/**
 * ─── LABEL KANBAN CUSTOMER DI LINI BODY ─────────────────────────────────────
 *
 * Di BODY, kanban customer boleh menggantikan kanban internal di lini (Handika,
 * 16–17 Nov 2026). Labelnya bukan buatan kita: MMKI hanya barcode nomor part
 * (`5716A705HC`), Suzuki QR lebar tetap 208 karakter, TMMIN 39 karakter dengan
 * seri, dan seterusnya.
 *
 * Cara membacanya disalin dari `CustomerKanbanResolver` bella — aturannya DATA
 * per customer (master Customer: panjang label, posisi part, posisi seri),
 * bukan kode per customer:
 *
 *   1. Label di-trim dan dibesarkan, lalu diukur panjangnya.
 *   2. Customer yang panjang labelnya diisi dan BERBEDA dilewati.
 *   3. Nomor part dipotong dari posisinya (mulai 0, seperti `substr` PHP);
 *      tanpa panjang part, seluruh label adalah nomor part.
 *   4. Hasilnya dibakukan (tanpa strip dan spasi) supaya cocok dengan master
 *      Part Customer yang ditulis berstrip maupun tidak.
 *   5. Bentuk hasil konversi format customer ikut dicoba, seperti bella:
 *      TMMIN 12 karakter berakhiran 00 (`11310BZ20000`) tersimpan di master
 *      sebagai `11310-BZ200`.
 *
 * Satu label bisa cocok dengan beberapa customer (MMKI, SENOPATI, FUJITRANS
 * sama-sama 10 karakter). Itu sengaja: yang memutuskan adalah pemetaan Part
 * Customer ke part yang sedang didandori, di lapisan service.
 */

import { convertCustomerPartNumber, type PartNumberFormat } from './customer-part';

export interface AturanLabelCustomer {
  customerId: number;
  /** Format nomor part customer; dipakai mengubah TMMIN `11310BZ20000` -> `11310-BZ200`. */
  partNumberFormat?: PartNumberFormat | null;
  labelLength: number | null;
  labelPartStart: number | null;
  labelPartLength: number | null;
  labelSerialStart: number | null;
  labelSerialLength: number | null;
}

export interface PotonganLabelCustomer {
  customerId: number;
  /** Nomor part customer dalam bentuk baku: huruf besar, tanpa strip/spasi. */
  nomorPart: string;
  /** Seri label bila customer-nya punya aturan seri; selain itu null. */
  seri: string | null;
}

/** Bentuk baku nomor part customer untuk dibandingkan. */
export function bakukanPartCustomer(nomor: string): string {
  return nomor.replace(/[-\s]/g, '').toUpperCase();
}

/** Semua kemungkinan bacaan label menurut aturan tiap customer. */
export function potongLabelCustomer(
  raw: string,
  aturan: readonly AturanLabelCustomer[],
): PotonganLabelCustomer[] {
  const label = raw.trim().toUpperCase();
  const panjang = label.length;
  if (panjang === 0) return [];

  const hasil: PotonganLabelCustomer[] = [];
  for (const a of aturan) {
    const total = a.labelLength ?? 0;
    // Panjang 0/kosong = customer itu tidak memakai penjagaan panjang.
    if (total > 0 && total !== panjang) continue;

    const mulai = a.labelPartStart ?? 0;
    const lebar = a.labelPartLength ?? 0;
    const potong = lebar > 0 && panjang >= mulai + lebar ? label.substr(mulai, lebar) : label;
    const nomorPart = bakukanPartCustomer(potong);
    if (!nomorPart) continue;

    const seri = seriLabel(label, a);
    hasil.push({ customerId: a.customerId, nomorPart, seri });
    const konversi = bakukanPartCustomer(
      convertCustomerPartNumber(potong.trim(), a.partNumberFormat ?? 'NONE'),
    );
    if (konversi && konversi !== nomorPart) {
      hasil.push({ customerId: a.customerId, nomorPart: konversi, seri });
    }
  }
  return hasil;
}

function seriLabel(label: string, a: AturanLabelCustomer): string | null {
  const mulai = a.labelSerialStart;
  const lebar = a.labelSerialLength ?? 0;
  if (mulai === null || mulai === undefined || lebar <= 0) return null;
  if (label.length < mulai + lebar) return null;
  const seri = label.substr(mulai, lebar).trim();
  return seri || null;
}
