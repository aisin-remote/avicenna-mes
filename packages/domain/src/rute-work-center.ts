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
