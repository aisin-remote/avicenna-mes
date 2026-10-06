/** Format barcode yang sudah dicetak ARES; tidak mengganti kartu supplier. */
export function parseAresScanCode(
  raw: string,
):
  | { kind: 'ORDER'; orderNumber: string; revision: number }
  | { kind: 'KANBAN'; id: string }
  | null {
  const value = raw.trim().toUpperCase();
  const kanban = /^ARES:K:([0-9A-Z]{26})$/.exec(value);
  if (kanban) return { kind: 'KANBAN', id: kanban[1]! };
  const order = /^ARES:P:([789]\d{11})$/.exec(value);
  if (order)
    return {
      kind: 'ORDER',
      orderNumber: `${order[1]!.slice(0, -2)}00`,
      revision: Number(order[1]!.slice(-2)),
    };
  const legacy = /^ARES:P:([A-Z]+-\d{6}-\d+)-(\d+)$/.exec(value);
  if (legacy && Number.isSafeInteger(Number(legacy[2])))
    return { kind: 'ORDER', orderNumber: legacy[1]!, revision: Number(legacy[2]) };
  return null;
}

export function displayAresOrder(orderNumber: string, revision: number): string {
  return /^[789]\d{11}$/.test(orderNumber)
    ? `${orderNumber.slice(0, -2)}${String(revision).padStart(2, '0')}`
    : `${orderNumber}${revision ? ` rev ${revision}` : ''}`;
}

export function receivingVerdict(
  status: string,
  sameOrder: boolean,
  currentRevision: number,
  kanbanRevision: number,
) {
  if (!sameOrder)
    return {
      result: 'REJECTED' as const,
      message: 'Kanban bukan bagian Order Sheet ini',
      autoShipped: false,
    };
  if (
    status === 'SHIPPED' ||
    status === 'PRINTED' ||
    (status === 'MISSING' && currentRevision > kanbanRevision)
  ) {
    return {
      result: 'OK' as const,
      message: status === 'PRINTED' ? 'Diterima tanpa konfirmasi kirim supplier' : 'Diterima',
      autoShipped: status === 'PRINTED',
    };
  }
  return {
    result: 'REJECTED' as const,
    message:
      status === 'RECEIVED'
        ? 'Kanban sudah diterima sebelumnya'
        : status === 'CANCELLED'
          ? 'Kanban sudah dibatalkan'
          : 'Kanban tidak dapat diterima',
    autoShipped: false,
  };
}

export function receivingCloseTotals(
  lines: ReadonlyArray<{ boxOrdered: number; boxScanned: number; qtyPerBox: number }>,
  reason?: string,
) {
  const missing = lines.reduce(
    (sum, line) => sum + Math.max(0, line.boxOrdered - line.boxScanned),
    0,
  );
  if (missing && !reason?.trim())
    throw new Error('Alasan wajib diisi bila ada box yang belum diterima');
  return {
    missing,
    status: missing ? ('PARTIAL' as const) : ('COMPLETE' as const),
    pcs: lines.reduce((sum, line) => sum + line.boxScanned * line.qtyPerBox, 0),
  };
}
