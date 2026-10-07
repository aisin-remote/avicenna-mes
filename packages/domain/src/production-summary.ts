type ProductionLine = {
  plantCode: string | null;
  processType: string;
  qtyHariIni: number;
};

/** Output dicatat per proses; menjumlahkan antarproses akan menghitung barang berulang. */
export function summarizeProductionByProcess(lines: readonly ProductionLine[]) {
  const groups = new Map<string, ProductionLine & { totalLines: number; producingLines: number }>();
  for (const line of lines) {
    if (line.processType === 'DELIVERY') continue;
    const key = JSON.stringify([line.plantCode, line.processType]);
    const group = groups.get(key) ?? {
      plantCode: line.plantCode,
      processType: line.processType,
      qtyHariIni: 0,
      totalLines: 0,
      producingLines: 0,
    };
    group.qtyHariIni += line.qtyHariIni;
    group.totalLines++;
    if (line.qtyHariIni > 0) group.producingLines++;
    groups.set(key, group);
  }
  return [...groups.values()];
}
