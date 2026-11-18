/**
 * Isi QR 15 digit yang ditatah pada part casting UNIT.
 *
 * Format dari Handika (11 Nov 2026):
 *
 *   1–2    program number      menunjuk FG (TM_PROGRAM_NUMBER)
 *   3–4    nomor die
 *   5–6    line                00–ZZ
 *   7–8    tahun               dua digit, 20YY
 *   9      bulan               1–9, A (Okt), B (Nov), C (Des)
 *   10–11  tanggal
 *   12     shift               A / B / C
 *   13–15  nomor shot          1–999
 *
 * ── Kenapa hanya untuk DITAMPILKAN ─────────────────────────────────────────
 *
 * Scan tetap menyimpan seluruh 15 karakter sebagai identitas unit dan hanya
 * membaca program number (ATURAN_PROGRAM_15). Uraian ini dipakai layar
 * traceability; ruas yang tidak masuk akal ditandai, bukan ditolak — QR
 * lama atau QR uji tetap harus bisa ditelusuri.
 */
export interface UraianQrUnit {
  program: string;
  die: string;
  line: string;
  tahun: number | null;
  bulan: number | null;
  tanggal: number | null;
  /** Tanggal produksi YYYY-MM-DD bila tahun, bulan, dan tanggal sah. */
  tanggalProduksi: string | null;
  shift: string | null;
  shot: number | null;
  /** Ruas yang nilainya di luar format. */
  ruasTidakSah: string[];
}

const BULAN: Record<string, number> = { A: 10, B: 11, C: 12 };

export function uraiQrUnit(raw: string): UraianQrUnit | null {
  const q = raw.trim().toUpperCase();
  if (!/^[0-9]{2}[0-9A-Z]{13}$/.test(q)) return null;
  const tidakSah: string[] = [];

  const tahunTeks = q.slice(6, 8);
  const tahun = /^\d{2}$/.test(tahunTeks) ? 2000 + Number(tahunTeks) : null;
  if (tahun === null) tidakSah.push('tahun');

  const b = q[8]!;
  const bulan = /[1-9]/.test(b) ? Number(b) : (BULAN[b] ?? null);
  if (bulan === null) tidakSah.push('bulan');

  const tglTeks = q.slice(9, 11);
  let tanggal: number | null = /^\d{2}$/.test(tglTeks) ? Number(tglTeks) : null;
  if (tanggal !== null && tahun !== null && bulan !== null) {
    const hariDalamBulan = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
    if (tanggal < 1 || tanggal > hariDalamBulan) tanggal = null;
  } else if (tanggal !== null && (tanggal < 1 || tanggal > 31)) {
    tanggal = null;
  }
  if (tanggal === null) tidakSah.push('tanggal');

  const s = q[11]!;
  const shift = /[ABC]/.test(s) ? s : null;
  if (shift === null) tidakSah.push('shift');

  const shotTeks = q.slice(12, 15);
  const shot = /^\d{3}$/.test(shotTeks) && Number(shotTeks) >= 1 ? Number(shotTeks) : null;
  if (shot === null) tidakSah.push('shot');

  const dua = (n: number) => String(n).padStart(2, '0');
  return {
    program: q.slice(0, 2),
    die: q.slice(2, 4),
    line: q.slice(4, 6),
    tahun,
    bulan,
    tanggal,
    tanggalProduksi:
      tahun !== null && bulan !== null && tanggal !== null
        ? `${tahun}-${dua(bulan)}-${dua(tanggal)}`
        : null,
    shift,
    shot,
    ruasTidakSah: tidakSah,
  };
}
