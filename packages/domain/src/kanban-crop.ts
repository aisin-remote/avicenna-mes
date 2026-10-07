export interface GarisPotongKanban {
  horizontalLines: number[];
  verticalLines: number[];
}

export interface BidangPotongKanban {
  row: number;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function normalisasiGarisPotong(lines: number[]) {
  return lines
    .filter((line) => Number.isFinite(line) && line >= 0.02 && line <= 0.98)
    .sort((a, b) => a - b)
    .filter((line, index, sorted) => index === 0 || line - (sorted[index - 1] ?? 0) >= 0.03);
}

/** Menyusun bidang di antara garis, urut dari kiri-atas. Satuan halaman bebas. */
export function susunPotonganKanbanDariGaris(
  rule: GarisPotongKanban,
  pageWidth: number,
  pageHeight: number,
) {
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    throw new Error('Ukuran halaman Kanban tidak valid.');
  }
  const horizontal = [0, ...normalisasiGarisPotong(rule.horizontalLines), 1];
  const vertical = [0, ...normalisasiGarisPotong(rule.verticalLines), 1];
  const cells: BidangPotongKanban[] = [];
  for (let row = 0; row < horizontal.length - 1; row += 1) {
    for (let column = 0; column < vertical.length - 1; column += 1) {
      const top = (horizontal[row] ?? 0) * pageHeight;
      const left = (vertical[column] ?? 0) * pageWidth;
      cells.push({
        row,
        column,
        left,
        top,
        width: (vertical[column + 1] ?? 1) * pageWidth - left,
        height: (horizontal[row + 1] ?? 1) * pageHeight - top,
      });
    }
  }
  return { cells, rows: horizontal.length - 1, columns: vertical.length - 1 };
}
