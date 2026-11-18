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

/** Part master yang dikenali dari nomor BOM. */
export interface PartUntukPasangan {
  id: number;
  plantId: number;
}

/** Satu pasangan induk dan komponen hasil salinan BOM. */
export interface PasanganBom {
  plantId: number;
  indukId: number;
  komponenId: number;
  qtyPer: number;
  uom: string;
}

/** Baris BOM yang tidak bisa disalin, beserta sebabnya. */
export interface BarisBomDilewati {
  induk: string;
  komponen: string;
  sebab: string;
}

/**
 * Pasangan Part Pairing dari BOM SAP.
 *
 * Phantom tidak punya stok, jadi tidak pernah dipotong: komponennya langsung
 * dipasangkan ke induk phantom, dengan qty dikalikan. Hasilnya, Casting -04
 * langsung memakai ingot tanpa lewat Melting -02.
 *
 * Baris yang induk atau komponennya belum ada di master dilaporkan, bukan
 * ditebak, karena part beli memang belum semuanya didaftarkan.
 *
 * `indukTersalin` berisi semua induk BOM yang ada di master, termasuk yang semua
 * komponennya terlewati: pasangan lama induk itu harus ikut diakhiri.
 */
export function pasanganDariBom(
  baris: readonly BarisBomSap[],
  cariPart: (partNumber: string) => PartUntukPasangan | undefined,
): { pasangan: PasanganBom[]; dilewati: BarisBomDilewati[]; indukTersalin: number[] } {
  const anak = new Map<string, BarisBomSap[]>();
  const phantom = new Set<string>();
  for (const b of baris) {
    if (b.induk === b.komponen) continue;
    anak.set(b.induk, [...(anak.get(b.induk) ?? []), b]);
    if (b.phantom === 'X') phantom.add(b.komponen);
  }

  /** Komponen nyata sebuah baris: phantom diurai sampai bertemu part berstok. */
  const urai = (b: BarisBomSap, kali: number, jalur: readonly string[]): { b: BarisBomSap; qty: number }[] => {
    const qty = (b.qty ?? 0) * kali;
    if (!phantom.has(b.komponen)) return [{ b, qty }];
    return (anak.get(b.komponen) ?? [])
      .filter((a) => !jalur.includes(a.komponen))
      .flatMap((a) => urai(a, qty, [...jalur, a.komponen]));
  };

  const pasangan = new Map<string, PasanganBom>();
  const dilewati: BarisBomDilewati[] = [];
  const indukTersalin = new Set<number>();
  for (const [indukNo, daftar] of anak) {
    // Baris milik phantom sudah ikut dalam induknya.
    if (phantom.has(indukNo)) continue;
    const induk = cariPart(indukNo);
    if (!induk) {
      for (const b of daftar) dilewati.push({ induk: indukNo, komponen: b.komponen, sebab: 'induk belum ada di master' });
      continue;
    }
    indukTersalin.add(induk.id);
    for (const { b, qty } of daftar.flatMap((b) => urai(b, 1, [indukNo, b.komponen]))) {
      const komponen = cariPart(b.komponen);
      if (!komponen) {
        dilewati.push({ induk: indukNo, komponen: b.komponen, sebab: 'komponen belum ada di master' });
        continue;
      }
      if (!(qty > 0)) {
        dilewati.push({ induk: indukNo, komponen: b.komponen, sebab: 'qty kosong' });
        continue;
      }
      const kunci = `${induk.id}>${komponen.id}`;
      const ada = pasangan.get(kunci);
      if (ada) ada.qtyPer += qty;
      else
        pasangan.set(kunci, {
          plantId: induk.plantId,
          indukId: induk.id,
          komponenId: komponen.id,
          qtyPer: qty,
          uom: (b.uom ?? 'pcs').toLowerCase(),
        });
    }
  }
  return { pasangan: [...pasangan.values()], dilewati, indukTersalin: [...indukTersalin] };
}
