export const PIS_DANDORY_DOCKS: readonly string[] = [
  'TMMIN SPD',
  'TMMIN-PBOD',
  'HINO-SPD',
  'SIM-SPD',
  'TAM-SPD',
  'MMKI-SPD',
  'ADM',
  'TTI',
];

export function isPisDandoryDock(dock: string): boolean {
  return PIS_DANDORY_DOCKS.includes(dock.trim().toUpperCase());
}

export function cleanPisBarcode(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim()
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/^[zZ]+(?=C|\d)/i, '')
    .replace(/^(C[A-Za-z0-9]{10})[zZ]+$/i, '$1');
}

export function extractPisLoadingListNumber(raw: string): string | null {
  const number = cleanPisBarcode(raw).slice(0, 11);
  return /^C[A-Z0-9]{10}$/i.test(number) ? number.toUpperCase() : null;
}

export function samePisPds(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  return (first ?? '').trim().toUpperCase() === (second ?? '').trim().toUpperCase();
}

export interface PisTtiKanban {
  unique: string;
  partNumber: string;
  partNumberNoDash: string;
  raw: string;
}

export function parsePisTtiKanban(raw: string): PisTtiKanban | null {
  const barcode = raw.replace(/[\x00-\x1F\x7F]/g, '').trim();
  const fields = barcode.split('|').map((field) => field.trim().toUpperCase());
  if (fields.length < 4) return null;
  // Keyboard scanners can strip the opening '<' from the WDT prefix.
  const unique = fields[0]!.replace(/^(?:<WDT>|WDT>)/i, '');
  const partNumber = fields[3]!;
  if (!/^[A-Z0-9]{4,12}$/.test(unique) || !/^[A-Z0-9][A-Z0-9-]*$/.test(partNumber)) {
    return null;
  }
  return { unique, partNumber, partNumberNoDash: partNumber.replace(/-/g, ''), raw: barcode };
}

function normalizePart(part: string): string {
  return part.trim().toUpperCase();
}

export function isPisLabelPartMatch(label: string, part: string, dock: string): boolean {
  const scan = normalizePart(cleanPisBarcode(label).split(/\s{2,}/)[0] ?? '');
  const expected = normalizePart(part);
  if (!scan || !expected) return false;
  if (scan === expected) return true;
  if (dock.trim().toUpperCase() === 'MMKI-SPD' && scan.replace(/-\d+$/, '') === expected) {
    return true;
  }
  if (/^[A-Z]/.test(expected) && expected.slice(1) === scan) return true;
  if (/^[A-Z]/.test(scan) && scan.slice(1) === expected) return true;
  if (scan.startsWith(expected))
    return /^(?:\d{1,6}|[A-Z]{1,2})$/.test(scan.slice(expected.length));
  if (expected.startsWith(scan)) return /^\d{1,6}$/.test(expected.slice(scan.length));
  return false;
}

export interface PisMatchItem {
  partNumber: string;
  customerPartNumber: string | null;
  remainingQty: number;
  documentNumber?: string;
}

export function findPisLabelItem<T extends PisMatchItem>(
  raw: string,
  items: readonly T[],
  dock: string,
): T | null {
  const scan = normalizePart(cleanPisBarcode(raw).split(/\s{2,}/)[0] ?? '');
  const candidates = items.map((item) => ({
    item,
    score: Math.max(
      0,
      ...[item.partNumber, item.customerPartNumber ?? ''].map((part) => {
        const expected = normalizePart(part);
        if (!isPisLabelPartMatch(raw, expected, dock)) return 0;
        return expected === scan ? Number.MAX_SAFE_INTEGER : expected.length;
      }),
    ),
  }));
  // A known longer part must never be counted as a scanner suffix on a shorter part.
  const best = Math.max(0, ...candidates.map(({ score }) => score));
  return (
    candidates.find(({ item, score }) => best > 0 && score === best && item.remainingQty > 0)
      ?.item ?? null
  );
}

type PisKanbanError =
  | 'INVALID_FORMAT'
  | 'LABEL_ONLY'
  | 'LOADING_LIST_MISMATCH'
  | 'PART_NOT_FOUND'
  | 'TARGET_REACHED';

export type PisKanbanMatch<T extends PisMatchItem> =
  | { ok: true; item: T; unique: string | null; raw: string }
  | { ok: false; code: PisKanbanError };

function containsLoadingList(barcode: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, 'i').test(barcode);
}

export function matchPisCustomerKanban<T extends PisMatchItem>(
  raw: string,
  items: readonly T[],
  loadingListNumbers: readonly string[],
  dock: string,
): PisKanbanMatch<T> {
  const barcode = cleanPisBarcode(raw);
  if (!barcode) return { ok: false, code: 'INVALID_FORMAT' };
  let matched: T[];
  let unique: string | null = null;
  if (dock.trim().toUpperCase() === 'TTI') {
    const parsed = parsePisTtiKanban(raw);
    if (!parsed) return { ok: false, code: 'INVALID_FORMAT' };
    unique = parsed.unique;
    matched = items.filter((item) =>
      [item.partNumber, item.customerPartNumber ?? ''].some(
        (part) => normalizePart(part).replace(/-/g, '') === parsed.partNumberNoDash,
      ),
    );
  } else {
    const hasLoadingList = loadingListNumbers.some(
      (number) => number.trim() !== '' && containsLoadingList(barcode, number.trim()),
    );
    const tokens = barcode.toUpperCase().split(/\s+/);
    if (!hasLoadingList) {
      return {
        ok: false,
        code: barcode.length <= 100 && tokens.length < 4 ? 'LABEL_ONLY' : 'LOADING_LIST_MISMATCH',
      };
    }
    matched = items.filter((item) => {
      const expected = normalizePart(item.customerPartNumber ?? '');
      return (
        expected !== '' &&
        tokens.some(
          (token) =>
            token === expected ||
            (dock.trim().toUpperCase() === 'MMKI-SPD' && token.replace(/-\d+$/, '') === expected),
        )
      );
    });
  }
  if (!matched.length) return { ok: false, code: 'PART_NOT_FOUND' };
  const item = matched.find((candidate) => candidate.remainingQty > 0);
  return item ? { ok: true, item, unique, raw: barcode } : { ok: false, code: 'TARGET_REACHED' };
}
