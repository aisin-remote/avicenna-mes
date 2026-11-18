/**
 * ─── LAPORAN PRODUKSI & DASHBOARD EFISIENSI ─────────────────────────────────
 *
 * Rumus (Handika, 12 Nov 2026), lihat efisiensi-produksi.ts di domain:
 *
 *   efisiensi = Σ(OK × cycle time) ÷ (jam shift − istirahat)
 *   RIL       = NG inline  ÷ (OK + NG)
 *   ROL       = NG outline ÷ (OK + NG)
 *
 * Persen yang tidak bisa dihitung bernilai null, bukan nol: cycle time yang
 * belum diisi bukan line yang buruk.
 */

export interface ShiftPilihan {
  code: string;
  name: string;
  mulai: string;
  selesai: string;
}

export interface EfisiensiJam {
  ke: number;
  label: string;
  ok: number;
  menitBersih: number;
  efisiensi: number | null;
}

export interface EfisiensiLini {
  lineId: number;
  lineCode: string;
  lineName: string;
  processType: string | null;
  /** "TCC D98E #12" — model dari program number + nomor die dari QR; atau back number part. */
  model: string | null;
  /** Efisiensi jam yang sedang berjalan (shift berjalan) atau jam terakhir yang berisi scan. */
  efisiensiJam: number | null;
  labelJam: string | null;
  efisiensiShift: number | null;
  ok: number;
  ril: number;
  rol: number;
  rilPct: number | null;
  rolPct: number | null;
  menitBersih: number;
  /** Menit berhenti tercatat di shift ini (semua alasan). */
  menitBerhenti: number;
  /** Pcs OK yang part-nya belum punya cycle time di line ini — tidak masuk efisiensi. */
  okTanpaCt: number;
  perJam: EfisiensiJam[];
}

export interface DashboardEfisiensi {
  plant: { id: number; code: string } | null;
  plants: { id: number; code: string }[];
  tanggal: string;
  shift: ShiftPilihan | null;
  shifts: ShiftPilihan[];
  /** Ember jam yang sedang berjalan bila shift ini sedang berlangsung. */
  jamSekarang: number | null;
  jam: { ke: number; label: string }[];
  lini: EfisiensiLini[];
  /** Gabungan seluruh line yang tampil. */
  total: {
    efisiensi: number | null;
    ok: number;
    ril: number;
    rol: number;
    rilPct: number | null;
    rolPct: number | null;
    perJam: EfisiensiJam[];
  };
  /** Keterangan bila dashboard tidak bisa dihitung (mis. jam kerja belum diisi). */
  pesan: string | null;
}

/** Satu baris laporan: satu part di satu line pada satu shift. */
export interface BarisLaporanProduksi {
  tanggal: string;
  shift: string;
  lineCode: string;
  partNumber: string;
  backNumber: string | null;
  partName: string | null;
  ok: number;
  ril: number;
  rol: number;
  cycleTime: number | null;
  /** OK × cycle time, menit. */
  menitDihasilkan: number | null;
}

/** Ringkasan satu line pada satu shift — dasar efisiensinya. */
export interface RingkasLaporanProduksi {
  tanggal: string;
  shift: string;
  lineCode: string;
  lineName: string;
  ok: number;
  ril: number;
  rol: number;
  rilPct: number | null;
  rolPct: number | null;
  menitBersih: number;
  menitDihasilkan: number | null;
  efisiensi: number | null;
  menitBerhenti: number;
  baris: BarisLaporanProduksi[];
}

export interface LaporanProduksi {
  plant: { id: number; code: string } | null;
  plants: { id: number; code: string }[];
  dari: string;
  sampai: string;
  ringkas: RingkasLaporanProduksi[];
  pesan: string | null;
}
