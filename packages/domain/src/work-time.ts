/**
 * ─── JAM KERJA, ISTIRAHAT, DAN WAKTU BERHENTI ───────────────────────────────
 *
 * Seluruh laporan produksi bertumpu pada satu pertanyaan: dari sekian jam yang
 * tersedia, berapa yang benar-benar dipakai berproduksi? Jawabannya butuh tiga
 * hal yang semuanya DATA, bukan tetapan di kode: jam kerja tiap pabrik, jam
 * istirahatnya, dan catatan berhenti di luar rencana.
 *
 * Fungsi di sini sengaja murni — bisa diuji tanpa database, dan dipakai sama
 * persis oleh layar operator, dashboard, maupun laporan. Dua salinan aturan
 * yang sedikit berbeda akan membuat angka di dashboard dan di laporan tidak
 * pernah cocok, dan tidak ada yang tahu mana yang benar.
 */

/** Jam kerja satu shift, sebagaimana tersimpan di TM_WORK_TIME. */
export interface JamKerja {
  code: string;
  /** "HH:MM" atau "HH:MM:SS". */
  startTime: string;
  endTime: string;
  /** Shift yang memulai hari produksi di pabrik ini. */
  startsProductionDay?: boolean;
}

/** Istirahat terjadwal di dalam sebuah shift. */
export interface JamIstirahat {
  startTime: string;
  endTime: string;
}

/** Satu rentang waktu nyata. `sampai` kosong berarti masih berlangsung. */
export interface Rentang {
  dari: Date;
  sampai?: Date | null;
}

/**
 * Mengubah "HH:MM" menjadi menit sejak tengah malam.
 *
 * Menerima "HH:MM:SS" juga, karena kolom TIME di MySQL dibaca dengan detik.
 * Nilai yang tidak terbaca melempar, bukan diam-diam menjadi 0 — jam kerja
 * yang salah ketik akan membuat SELURUH laporan pabrik itu meleset, dan nol
 * adalah nilai yang paling sulit dikenali sebagai salah.
 */
export function keMenit(jam: string): number {
  const cocok = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(jam.trim());
  if (!cocok) throw new Error(`Jam "${jam}" tidak terbaca. Pakai bentuk HH:MM.`);
  const h = Number(cocok[1]);
  const m = Number(cocok[2]);
  if (h > 23 || m > 59) throw new Error(`Jam "${jam}" di luar rentang.`);
  return h * 60 + m;
}

/** Apakah rentang jam ini menyeberang tengah malam (23:00 → 07:00). */
export function menyeberangHari(j: { startTime: string; endTime: string }): boolean {
  return keMenit(j.endTime) <= keMenit(j.startTime);
}

/** Panjang sebuah rentang jam dalam menit, ikut memperhitungkan penyeberangan hari. */
export function panjangMenit(j: { startTime: string; endTime: string }): number {
  const mulai = keMenit(j.startTime);
  const selesai = keMenit(j.endTime);
  return selesai > mulai ? selesai - mulai : 24 * 60 - mulai + selesai;
}

/**
 * Menit kerja bersih sebuah shift: panjang shift dikurangi istirahat.
 *
 * Istirahat yang berada di luar jam shiftnya diabaikan, bukan dikurangkan:
 * salah memasukkan istirahat ke shift yang keliru akan mengurangi waktu kerja
 * yang tidak pernah ada, dan efisiensi terlihat lebih baik daripada
 * sebenarnya — kesalahan yang arahnya paling berbahaya.
 */
export function menitKerja(shift: JamKerja, istirahat: readonly JamIstirahat[] = []): number {
  const kotor = panjangMenit(shift);
  let potong = 0;
  for (const i of istirahat) {
    if (!istirahatDiDalam(shift, i)) continue;
    potong += panjangMenit(i);
  }
  return Math.max(0, kotor - potong);
}

/** Apakah seluruh rentang istirahat berada di dalam jam shift. */
export function istirahatDiDalam(shift: JamKerja, i: JamIstirahat): boolean {
  const offMulai = selisihMaju(keMenit(shift.startTime), keMenit(i.startTime));
  const offSelesai = selisihMaju(keMenit(shift.startTime), keMenit(i.endTime));
  const panjang = panjangMenit(shift);
  return offMulai <= offSelesai && offSelesai <= panjang;
}

/** Jarak maju dari a ke b dalam menit, memutar lewat tengah malam bila perlu. */
function selisihMaju(a: number, b: number): number {
  return b >= a ? b - a : 24 * 60 - a + b;
}

/**
 * Jam mulai hari produksi sebuah pabrik, dari masternya.
 *
 * Mengembalikan menit sejak tengah malam. Bila tidak ada shift yang ditandai,
 * dipakai shift paling pagi — lebih baik daripada memaksakan satu angka di
 * kode, yang justru keadaan yang hendak kita tinggalkan.
 */
export function awalHariProduksi(jamKerja: readonly JamKerja[]): number | null {
  if (jamKerja.length === 0) return null;
  const ditandai = jamKerja.find((j) => j.startsProductionDay);
  if (ditandai) return keMenit(ditandai.startTime);
  return Math.min(...jamKerja.map((j) => keMenit(j.startTime)));
}

/** Shift yang berlaku pada sebuah jam, menurut master pabrik itu. */
export function shiftPada(at: Date, jamKerja: readonly JamKerja[]): JamKerja | null {
  const menit = at.getHours() * 60 + at.getMinutes();
  for (const j of jamKerja) {
    const mulai = keMenit(j.startTime);
    const panjang = panjangMenit(j);
    if (selisihMaju(mulai, menit) < panjang) return j;
  }
  return null;
}

/**
 * Lama tumpang tindih dua rentang waktu, dalam menit.
 *
 * Inilah dasar perhitungan loss time: berhenti yang mulai sebelum shift dan
 * berakhir di tengahnya hanya boleh dihitung bagian yang masuk shift. Tanpa
 * pemotongan ini, satu berhenti panjang yang melintasi tiga shift akan
 * dibebankan penuh ke ketiganya.
 */
export function menitTumpangTindih(a: Rentang, b: Rentang, sekarang = new Date()): number {
  const aMulai = a.dari.getTime();
  const aSelesai = (a.sampai ?? sekarang).getTime();
  const bMulai = b.dari.getTime();
  const bSelesai = (b.sampai ?? sekarang).getTime();
  const mulai = Math.max(aMulai, bMulai);
  const selesai = Math.min(aSelesai, bSelesai);
  return selesai <= mulai ? 0 : (selesai - mulai) / 60000;
}

/** Satu ember satu jam pada laporan per jam. */
export interface EmberJam {
  /** Label seperti yang dibaca orang di laporan: "06-07". */
  label: string;
  dari: Date;
  sampai: Date;
}

/**
 * Deretan ember satu jam sepanjang hari produksi.
 *
 * Dimulai dari jam mulai hari produksi pabrik itu, bukan dari tengah malam —
 * di pabrik yang mulai pukul 06:00, ember pertama memang "06-07". Labelnya
 * dibuat di sini supaya layar dan berkas ekspor tidak membuat versinya sendiri.
 */
export function emberJam(mulaiHari: Date, jumlahJam = 24): EmberJam[] {
  const ember: EmberJam[] = [];
  for (let i = 0; i < jumlahJam; i += 1) {
    const dari = new Date(mulaiHari);
    dari.setHours(mulaiHari.getHours() + i, 0, 0, 0);
    const sampai = new Date(dari);
    sampai.setHours(dari.getHours() + 1);
    const dua = (n: number) => String(n).padStart(2, '0');
    ember.push({ label: `${dua(dari.getHours())}-${dua(sampai.getHours())}`, dari, sampai });
  }
  return ember;
}

/** Ringkasan kinerja sebuah lini pada satu rentang. */
export interface RingkasanEfisiensi {
  /** Menit yang tersedia menurut jam kerja, istirahat sudah dipotong. */
  menitTersedia: number;
  /** Menit berhenti di luar rencana. */
  menitBerhenti: number;
  /** Menit berhenti yang memang direncanakan (setup, QC). */
  menitBerhentiTerencana: number;
  /** Menit yang benar-benar bisa dipakai berproduksi. */
  menitOperasi: number;
  /** Menit yang seharusnya dibutuhkan untuk output sebanyak itu. */
  menitTeoretis: number;
  /** Rasio menitTeoretis / menitOperasi, atau null bila tidak bisa dihitung. */
  efisiensi: number | null;
}

/**
 * Menghitung efisiensi sebuah lini.
 *
 * Rumusnya sengaja sederhana dan bisa ditelusuri orang lapangan:
 *
 *     operasi  = tersedia − berhenti (termasuk yang terencana)
 *     teoretis = output × cycle time
 *     efisiensi = teoretis ÷ operasi
 *
 * Mengembalikan `null` — BUKAN nol — bila cycle time belum diisi atau waktu
 * operasinya nol. Angka nol akan terbaca sebagai "lini ini buruk sekali",
 * padahal yang sebenarnya terjadi adalah datanya belum ada.
 */
export function hitungEfisiensi(input: {
  menitTersedia: number;
  menitBerhenti: number;
  menitBerhentiTerencana: number;
  outputPcs: number;
  /** Detik per pcs. Kosong = belum diisi di master. */
  cycleTimeDetik?: number | null;
}): RingkasanEfisiensi {
  const menitOperasi = Math.max(
    0,
    input.menitTersedia - input.menitBerhenti - input.menitBerhentiTerencana,
  );
  const ct = input.cycleTimeDetik ?? null;
  const menitTeoretis = ct && ct > 0 ? (input.outputPcs * ct) / 60 : 0;
  return {
    menitTersedia: input.menitTersedia,
    menitBerhenti: input.menitBerhenti,
    menitBerhentiTerencana: input.menitBerhentiTerencana,
    menitOperasi,
    menitTeoretis,
    efisiensi: ct && ct > 0 && menitOperasi > 0 ? menitTeoretis / menitOperasi : null,
  };
}

/** Status sebuah lini, diturunkan — bukan disimpan. */
export type StatusLini = 'RUNNING' | 'STOP' | 'IDLE';

/**
 * Status lini untuk dashboard.
 *
 * Diturunkan dari kenyataan: ada baris berhenti yang belum ditutup berarti
 * STOP; ada scan baru-baru ini berarti RUNNING; selain itu IDLE. Kolom status
 * tersendiri pasti melenceng begitu satu proses lupa memperbaruinya, dan layar
 * monitor di lantai produksi menjadi bohong tanpa ada yang menyadarinya.
 */
export function statusLini(input: {
  adaBerhentiTerbuka: boolean;
  scanTerakhir?: Date | null;
  sekarang?: Date;
  /** Berapa lama tanpa scan sebelum lini dianggap tidak berjalan. */
  menitDiamMaksimum?: number;
}): StatusLini {
  if (input.adaBerhentiTerbuka) return 'STOP';
  if (!input.scanTerakhir) return 'IDLE';
  const sekarang = input.sekarang ?? new Date();
  const diam = (sekarang.getTime() - input.scanTerakhir.getTime()) / 60000;
  return diam <= (input.menitDiamMaksimum ?? 30) ? 'RUNNING' : 'IDLE';
}
