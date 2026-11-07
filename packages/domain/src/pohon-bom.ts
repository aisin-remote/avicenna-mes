/** Satu baris BOM SAP. Kolom induknya bernama FG, tetapi berlaku untuk semua tingkat. */
export interface BarisBomSap {
  induk: string;
  komponen: string;
  qty: number | null;
  uom: string | null;
  source: string | null;
  sloc: string | null;
  phantom: string | null;
}

export interface SimpulBom {
  kunci: string;
  kedalaman: number;
  partNumber: string;
  qty: number | null;
  uom: string | null;
  source: string | null;
  sloc: string | null;
  phantom: boolean;
}

/** Part FG: yang punya baris menunjuk dirinya sendiri (level 0 di SAP). */
export function akarBom(baris: readonly BarisBomSap[]): string[] {
  return [...new Set(baris.filter((b) => b.induk === b.komponen).map((b) => b.induk))].sort();
}

/**
 * Pohon satu FG, diratakan berurutan untuk tabel.
 *
 * Disusun dari pasangan induk dan komponen, bukan dari kolom level: sub-assy yang
 * dipakai beberapa FG hanya dirinci sekali di SAP, jadi rinciannya harus ikut
 * muncul di setiap cabang yang memakainya.
 */
export function ratakanPohonBom(baris: readonly BarisBomSap[], akar: string): SimpulBom[] {
  const anak = new Map<string, BarisBomSap[]>();
  for (const b of baris) {
    if (b.induk === b.komponen) continue;
    anak.set(b.induk, [...(anak.get(b.induk) ?? []), b]);
  }

  const diriAkar = baris.find((b) => b.induk === akar && b.komponen === akar);
  if (!diriAkar && !anak.has(akar)) return [];

  const hasil: SimpulBom[] = [];
  const jalan = (b: BarisBomSap, kedalaman: number, jalur: readonly string[]) => {
    const jalurIni = [...jalur, b.komponen];
    hasil.push({
      kunci: jalurIni.join('>'),
      kedalaman,
      partNumber: b.komponen,
      qty: b.qty,
      uom: b.uom,
      source: b.source,
      sloc: b.sloc,
      phantom: b.phantom === 'X',
    });
    for (const a of anak.get(b.komponen) ?? []) {
      // Data SAP yang melingkar tidak boleh membuat bacaan ini berputar selamanya.
      if (!jalurIni.includes(a.komponen)) jalan(a, kedalaman + 1, jalurIni);
    }
  };

  jalan(
    diriAkar ?? {
      induk: akar,
      komponen: akar,
      qty: null,
      uom: null,
      source: null,
      sloc: null,
      phantom: null,
    },
    0,
    [],
  );
  return hasil;
}
