import {
  awalHariProduksi,
  keMenit,
  panjangMenit,
  type JamIstirahat,
  type JamKerja,
} from './work-time';

/**
 * Efisiensi produksi untuk dashboard dan laporan (Handika, 12 Nov 2026).
 *
 *     efisiensi = Σ(OK × cycle time) ÷ waktu kerja bersih
 *     waktu kerja bersih = jam shift − istirahat terjadwal
 *
 * Berhenti (dandori, trouble, menunggu material) TIDAK dipotong: ia memang
 * menurunkan efisiensi, dan loss time-nya ditampilkan terpisah per alasan.
 * Sengaja berbeda dari `hitungEfisiensi` (yang memotong semua berhenti) —
 * itulah rumus yang dipakai AIIA di dashboard lamanya.
 *
 *     RIL = NG inline ÷ (OK + NG)      NG yang diinput langsung di line
 *     ROL = NG outline ÷ (OK + NG)     NG dari layar Input NG Outline
 *
 * NG di sini = RIL + ROL, supaya kedua persen berbagi pembagi yang sama dan
 * bisa dijumlahkan.
 */

export interface Jendela {
  dari: Date;
  sampai: Date;
}

const MENIT = 60_000;

/** Jam "HH:MM" pada tanggal "YYYY-MM-DD", waktu lokal server (WIB). */
function padaTanggal(tanggal: string, jam: string, tambahHari = 0): Date {
  const [y, m, d] = tanggal.split('-').map(Number) as [number, number, number];
  const menit = keMenit(jam);
  return new Date(y, m - 1, d + tambahHari, Math.floor(menit / 60), menit % 60, 0, 0);
}

/** Rentang nyata satu shift pada hari produksi `tanggal`. Shift malam menyeberang ke esok hari. */
export function jendelaShift(
  tanggal: string,
  shift: Pick<JamKerja, 'startTime' | 'endTime'>,
): Jendela {
  const dari = padaTanggal(tanggal, shift.startTime);
  return { dari, sampai: new Date(dari.getTime() + panjangMenit(shift) * MENIT) };
}

/**
 * Hari produksi `YYYY-MM-DD` tempat sebuah waktu jatuh.
 *
 * Hari produksi dimulai pada shift yang ditandai memulainya (Shift I 06:00 di
 * AIIA), jadi pukul 02:00 masih hari kemarin.
 */
export function hariProduksi(at: Date, jamKerja: readonly JamKerja[]): string {
  const awal = awalHariProduksi(jamKerja) ?? 0;
  const menit = at.getHours() * 60 + at.getMinutes();
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate() - (menit < awal ? 1 : 0));
  const dua = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

/**
 * Hari produksi tempat SHIFT ini dimulai, bila shift-nya dimulai pada `at`.
 *
 * Shift III (22:10–06:05) yang sedang berjalan pukul 02:00 dimulai kemarin.
 * Dipakai untuk membuka dashboard tepat pada shift yang sedang berjalan.
 */
export function tanggalMulaiShift(
  at: Date,
  shift: Pick<JamKerja, 'startTime' | 'endTime'>,
): string {
  const menit = at.getHours() * 60 + at.getMinutes();
  const mundur = menit < keMenit(shift.startTime) ? 1 : 0;
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate() - mundur);
  const dua = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

/**
 * Istirahat sebagai rentang nyata di dalam jendela shift.
 *
 * Istirahat 00:30 di Shift III jatuh pada hari BERIKUTNYA dari mulai shift.
 */
export function istirahatNyata(
  tanggal: string,
  shift: Pick<JamKerja, 'startTime' | 'endTime'>,
  istirahat: readonly JamIstirahat[],
): Jendela[] {
  const mulai = keMenit(shift.startTime);
  return istirahat.map((i) => {
    const hari = keMenit(i.startTime) < mulai ? 1 : 0;
    const dari = padaTanggal(tanggal, i.startTime, hari);
    return { dari, sampai: new Date(dari.getTime() + panjangMenit(i) * MENIT) };
  });
}

function tumpang(a: Jendela, b: Jendela): number {
  const dari = Math.max(a.dari.getTime(), b.dari.getTime());
  const sampai = Math.min(a.sampai.getTime(), b.sampai.getTime());
  return sampai > dari ? (sampai - dari) / MENIT : 0;
}

/**
 * Menit kerja bersih sebuah rentang: dikurangi istirahat, dipotong pada
 * `batas` (sekarang) supaya jam yang sedang berjalan tidak dihitung penuh.
 */
export function menitBersih(rentang: Jendela, istirahat: readonly Jendela[], batas?: Date): number {
  const sampai = batas && batas < rentang.sampai ? batas : rentang.sampai;
  if (sampai <= rentang.dari) return 0;
  const r = { dari: rentang.dari, sampai };
  const kotor = (sampai.getTime() - rentang.dari.getTime()) / MENIT;
  const potong = istirahat.reduce((n, i) => n + tumpang(r, i), 0);
  return Math.max(0, kotor - potong);
}

export interface JamShift extends Jendela {
  /** Jam ke-1, ke-2, … sejak shift mulai. */
  ke: number;
  /** "06:00", jam mulai ember ini. */
  label: string;
}

/**
 * Ember satu jam sejak shift mulai. Sisa di ujung yang kurang dari satu jam
 * (14:00–14:15 di Shift I) menjadi ember sendiri, tidak digabung — waktunya
 * tetap dihitung dengan menit bersihnya sendiri.
 */
export function jamShift(jendela: Jendela): JamShift[] {
  const hasil: JamShift[] = [];
  const dua = (n: number) => String(n).padStart(2, '0');
  for (
    let t = jendela.dari.getTime(), ke = 1;
    t < jendela.sampai.getTime();
    t += 60 * MENIT, ke++
  ) {
    const dari = new Date(t);
    const sampai = new Date(Math.min(t + 60 * MENIT, jendela.sampai.getTime()));
    hasil.push({ ke, label: `${dua(dari.getHours())}:${dua(dari.getMinutes())}`, dari, sampai });
  }
  return hasil;
}

/** Persen efisiensi, atau null bila belum ada waktu kerja atau cycle time. */
export function persenEfisiensi(detikDihasilkan: number | null, menit: number): number | null {
  if (detikDihasilkan === null || menit <= 0) return null;
  return (detikDihasilkan / (menit * 60)) * 100;
}

/** Persen NG terhadap seluruh yang diproduksi (OK + semua NG). */
export function persenNg(ng: number, ok: number, ngTotal: number): number | null {
  const pembagi = ok + ngTotal;
  return pembagi > 0 ? (ng / pembagi) * 100 : null;
}
