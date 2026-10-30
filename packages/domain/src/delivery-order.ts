export interface DeliveryOrderItem {
  id: number;
  partNumber: string | null;
  customerPartNumber: string | null;
  partName: string | null;
  uom: string | null;
  qtyPerKanban: number;
  pickedKanban: number;
  pickedQty: number;
}

export function deliveryOrderNumber(year: number, serial: number) {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2099 ||
    !Number.isSafeInteger(serial) ||
    serial < 1
  ) {
    throw new Error('Tahun atau serial Delivery Order tidak valid');
  }
  return `SJA/${String(year).slice(-2)}/${String(serial).padStart(6, '0')}`;
}

/** QR berisi identifier mentah, bukan URL/JSON atau nomor GI yang belum resmi. */
export function deliveryOrderQr(manifest: string | null, pds: string | null) {
  const manifestNumber = manifest?.trim();
  if (manifestNumber) return { value: manifestNumber, source: 'MANIFEST' as const };
  const pdsNumber = pds?.trim();
  return pdsNumber ? { value: pdsNumber, source: 'PDS' as const } : null;
}

export function deliveryOrderPreview(input: {
  status: string;
  manifestNumber: string | null;
  pdsNumber: string | null;
  lines: readonly DeliveryOrderItem[];
}) {
  if (!['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED'].includes(input.status)) {
    return { available: false as const, reason: 'Delivery Order tersedia setelah Finish Pulling.' };
  }
  const qr = deliveryOrderQr(input.manifestNumber, input.pdsNumber);
  if (!qr)
    return {
      available: false as const,
      reason:
        'Nomor manifest atau PDS belum tersedia. QR Delivery Order tidak boleh memakai nomor tebakan.',
    };
  const items = input.lines.filter((line) => line.pickedKanban > 0);
  if (!items.length)
    return { available: false as const, reason: 'Belum ada item aktual hasil pulling.' };
  if (
    items.some(
      (line) =>
        !Number.isSafeInteger(line.pickedKanban) ||
        !Number.isSafeInteger(line.pickedQty) ||
        line.pickedQty <= 0 ||
        !Number.isSafeInteger(line.qtyPerKanban) ||
        line.qtyPerKanban <= 0,
    )
  ) {
    return {
      available: false as const,
      reason: 'Qty aktual atau isi per kanban belum valid. Periksa item sebelum mencetak.',
    };
  }
  // Batas 15 baris seperti contoh; part/nama panjang menghabiskan lebih banyak ruang A4.
  const pages: DeliveryOrderItem[][] = [];
  let page: DeliveryOrderItem[] = [],
    used = 0;
  for (const line of items) {
    const units = Math.max(
      3,
      Math.ceil(((line.customerPartNumber?.length ?? 0) + 2) / 16) +
        Math.ceil((line.partNumber?.length ?? 0) / 18),
      Math.ceil((line.partName?.length ?? 0) / 28),
    );
    if (page.length && (page.length >= 15 || used + units > 48)) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(line);
    used += units;
  }
  if (page.length) pages.push(page);
  return {
    available: true as const,
    qr,
    pages,
    totalKanban: items.reduce((n, l) => n + l.pickedKanban, 0),
    totalQty: items.reduce((n, l) => n + l.pickedQty, 0),
  };
}
