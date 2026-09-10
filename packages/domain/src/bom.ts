/**
 * Penguraian BOM: dari satu part jadi, hitung seluruh kebutuhan sampai ke
 * raw material.
 *
 * Fungsi murni tanpa database, supaya bisa diuji lengkap termasuk kasus yang
 * sulit dibuat di data nyata — terutama BOM melingkar.
 */

export interface BomLine {
  parentPartId: number;
  componentPartId: number;
  /** Jumlah komponen per satu induk. Desimal karena raw material dalam kg. */
  qtyPer: number;
  /** Persentase susut yang wajar, 0-100. */
  scrapPct?: number;
  effectiveFrom?: string;
  /** null atau undefined berarti masih berlaku. */
  effectiveTo?: string | null;
}

export interface ExplodedLine {
  partId: number;
  /** Kedalaman dari part induk: 1 untuk komponen langsung. */
  level: number;
  /** Kebutuhan total termasuk susut. */
  qty: number;
  /** Jalur dari induk teratas, untuk menjelaskan asal angka. */
  path: number[];
}

/** BOM yang merujuk dirinya sendiri, langsung maupun lewat perantara. */
export class CircularBomError extends Error {
  constructor(readonly cycle: number[]) {
    super(`BOM melingkar terdeteksi: ${cycle.join(' → ')}`);
    this.name = 'CircularBomError';
  }
}

const MAX_DEPTH = 20;

/** Apakah baris BOM berlaku pada tanggal tertentu. */
export function isEffective(line: BomLine, onDate: string): boolean {
  if (line.effectiveFrom && onDate < line.effectiveFrom) return false;
  if (line.effectiveTo && onDate > line.effectiveTo) return false;
  return true;
}

/** Kebutuhan satu baris termasuk susut. */
export function qtyWithScrap(qtyPer: number, qtyParent: number, scrapPct = 0): number {
  const base = qtyPer * qtyParent;
  return base * (1 + scrapPct / 100);
}

/**
 * Menguraikan BOM secara rekursif.
 *
 * Melempar CircularBomError bila menemukan siklus. Ini disengaja dan tidak
 * boleh diperhalus: BOM melingkar berarti data masternya salah, dan
 * membiarkannya lewat akan menghasilkan kebutuhan material yang tak terhingga
 * atau — lebih buruk — angka yang terlihat wajar tapi keliru.
 */
export function explodeBom(
  rootPartId: number,
  qty: number,
  lines: readonly BomLine[],
  options: { onDate?: string; maxDepth?: number } = {},
): ExplodedLine[] {
  const onDate = options.onDate ?? new Date().toISOString().slice(0, 10);
  const maxDepth = options.maxDepth ?? MAX_DEPTH;

  // Kelompokkan sekali di awal supaya penelusuran tidak menyapu seluruh daftar
  // di setiap tingkat.
  const byParent = new Map<number, BomLine[]>();
  for (const line of lines) {
    if (!isEffective(line, onDate)) continue;
    const list = byParent.get(line.parentPartId);
    if (list) list.push(line);
    else byParent.set(line.parentPartId, [line]);
  }

  const result: ExplodedLine[] = [];

  function walk(partId: number, qtyNeeded: number, level: number, path: number[]) {
    if (level > maxDepth) {
      throw new CircularBomError([...path, partId]);
    }

    const children = byParent.get(partId);
    if (!children) return;

    for (const child of children) {
      if (path.includes(child.componentPartId)) {
        throw new CircularBomError([...path, partId, child.componentPartId]);
      }

      const need = qtyWithScrap(child.qtyPer, qtyNeeded, child.scrapPct);
      const nextPath = [...path, partId];

      result.push({
        partId: child.componentPartId,
        level,
        qty: need,
        path: nextPath,
      });

      walk(child.componentPartId, need, level + 1, nextPath);
    }
  }

  walk(rootPartId, qty, 1, []);
  return result;
}

/**
 * Menjumlahkan kebutuhan per part.
 *
 * Satu komponen bisa muncul di beberapa cabang — misalnya baut yang dipakai
 * di sub-rakitan sekaligus di perakitan akhir. Untuk pengadaan, yang dibutuhkan
 * adalah totalnya, bukan rinciannya per cabang.
 */
export function summarizeRequirements(exploded: readonly ExplodedLine[]): Map<number, number> {
  const total = new Map<number, number>();
  for (const line of exploded) {
    total.set(line.partId, (total.get(line.partId) ?? 0) + line.qty);
  }
  return total;
}

/**
 * Part yang tidak punya komponen — ujung dari penguraian.
 * Inilah yang benar-benar perlu dibeli atau disiapkan.
 */
export function leafRequirements(
  exploded: readonly ExplodedLine[],
  lines: readonly BomLine[],
): Map<number, number> {
  const hasChildren = new Set(lines.map((l) => l.parentPartId));
  const total = new Map<number, number>();
  for (const line of exploded) {
    if (hasChildren.has(line.partId)) continue;
    total.set(line.partId, (total.get(line.partId) ?? 0) + line.qty);
  }
  return total;
}
