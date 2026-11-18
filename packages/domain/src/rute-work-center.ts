import type { KatalogProses, LocationKind, ProcessType } from '@avicenna/contracts';

/**
 * Jenis proses sebuah baris rute, dihitung dari work center dan SLOC tujuannya.
 *
 * Line menyimpan satu jenis proses, tetapi line campuran seperti DCAA08
 * mengerjakan part WIP dan FG sekaligus. Yang membedakan keduanya adalah ke mana
 * hasilnya pergi: tujuan FG berarti langkah FG di kelompok proses yang sama.
 *
 * Kelompok Assembling punya dua proses FG (UNIT dan BODY), jadi proses milik
 * line tetap menang kalau kelasnya sudah cocok, dan kandidat yang tidak tunggal
 * tidak ditebak.
 */
export function prosesDariWorkCenter(
  katalog: KatalogProses,
  prosesLine: ProcessType,
  jenisSlocTujuan: LocationKind | null | undefined,
): ProcessType {
  const kelas =
    jenisSlocTujuan === 'FINISH_GOOD' ? 'FG' : jenisSlocTujuan === 'WIP' ? 'SFG' : null;
  if (!kelas || katalog.kelasSap(prosesLine) === kelas) return prosesLine;

  const grup = katalog.grup(prosesLine);
  const kandidat = katalog.daftar.filter((j) => j.processGroup === grup && j.sapClass === kelas);
  return kandidat.length === 1 ? kandidat[0]!.code : prosesLine;
}

/** Bagian baris rute yang menentukan apakah ia berlaku untuk sebuah scan. */
export interface BarisRuteUntukPilih {
  lineId: number | null;
  processType: string;
}

/**
 * Baris rute yang berlaku untuk scan part di sebuah line.
 *
 * Yang pertama dicari baris milik line itu. Baris tanpa line dipakai bila
 * prosesnya sama, supaya rute lama yang work center-nya belum diisi tidak
 * berubah perilakunya. Scan tanpa line (alat genggam) dicocokkan dari prosesnya.
 *
 * Kosong berarti part ini di luar rute line tersebut.
 */
export function pilihBarisRute<T extends BarisRuteUntukPilih>(
  rute: readonly T[],
  lineId: number | null | undefined,
  proses: string | null | undefined,
): T | undefined {
  if (lineId) {
    const milikLine = rute.find((r) => r.lineId === lineId);
    if (milikLine) return milikLine;
  }
  return rute.find((r) => r.lineId === null && r.processType === proses);
}

/** Bagian baris rute yang menentukan kelengkapannya. */
export interface BarisRuteUntukPeriksa {
  processType: string;
  lineId: number | null;
  lineCode: string | null;
  workCenter: string | null;
  inputLocationId: number | null;
  outputLocationId: number | null;
  scanMode: string | null;
}

/**
 * Yang masih kurang pada satu baris rute.
 *
 * Delivery tidak dikerjakan di work center dan tidak punya SLOC produksi, jadi
 * kolom-kolom itu tidak ditagih darinya. Metode scan tetap ditagih.
 */
export function masalahBarisRute(baris: BarisRuteUntukPeriksa): string[] {
  const masalah: string[] = [];
  const delivery = baris.processType === 'DELIVERY';

  if (!baris.lineId && !delivery) masalah.push('Work center belum diisi');
  if (baris.lineId && !baris.workCenter) {
    masalah.push(`Line ${baris.lineCode ?? baris.lineId} belum punya kode work center SAP`);
  }
  if (!delivery && !baris.inputLocationId) masalah.push('SLOC asal kosong');
  if (!delivery && !baris.outputLocationId) masalah.push('SLOC tujuan kosong');
  if (!baris.scanMode) masalah.push('Metode scan kosong');
  return masalah;
}

/** Turunan part keluarga QR, dengan jaraknya dari part itu (0 = part itu sendiri). */
export interface TurunanPart {
  partId: number;
  kedalaman: number;
}

/**
 * Part tahap yang dimaksud QR di sebuah line.
 *
 * QR ditatah sekali di Casting dan dibawa sampai FG, sedangkan nomor part
 * berganti di tiap tahap. Kode program di QR hanya menunjuk keluarganya (FG),
 * jadi part sebenarnya adalah anggota rantai yang dikerjakan di line ini.
 *
 * Yang terdekat ke FG yang menang. Dua part pada jarak yang sama sama-sama
 * dikerjakan di line ini, dan itu tidak ditebak.
 *
 * Kosong berarti tidak ada anggota rantai yang punya rute di line ini; pemanggil
 * memakai part keluarga dan scan menjadi di luar rute.
 */
export function pilihPartTahap(
  turunan: readonly TurunanPart[],
  adaRuteDiLine: (partId: number) => boolean,
): { partId: number } | { ambigu: number[] } | null {
  const cocok = turunan.filter((t) => adaRuteDiLine(t.partId));
  if (cocok.length === 0) return null;
  const terdekat = Math.min(...cocok.map((t) => t.kedalaman));
  const pilihan = [...new Set(cocok.filter((t) => t.kedalaman === terdekat).map((t) => t.partId))];
  return pilihan.length === 1 ? { partId: pilihan[0]! } : { ambigu: pilihan };
}
