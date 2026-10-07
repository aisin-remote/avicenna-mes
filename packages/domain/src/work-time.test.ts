import { describe, it, expect } from 'vitest';
import {
  keMenit,
  menyeberangHari,
  panjangMenit,
  menitKerja,
  istirahatDiDalam,
  awalHariProduksi,
  shiftPada,
  menitTumpangTindih,
  emberJam,
  hitungEfisiensi,
  statusLini,
} from './work-time';

const SHIFT_1 = { code: '1', startTime: '06:00', endTime: '14:00', startsProductionDay: true };
const SHIFT_2 = { code: '2', startTime: '14:00', endTime: '22:00' };
const SHIFT_3 = { code: '3', startTime: '22:00', endTime: '06:00' };

describe('membaca jam', () => {
  it('menerima HH:MM maupun HH:MM:SS', () => {
    expect(keMenit('06:00')).toBe(360);
    expect(keMenit('06:00:00')).toBe(360);
    expect(keMenit('23:45')).toBe(1425);
  });

  it('jam yang tidak terbaca MELEMPAR, bukan menjadi nol', () => {
    /*
     * Nol adalah nilai yang paling sulit dikenali sebagai salah: laporan tetap
     * keluar, angkanya saja yang meleset sepanjang hari.
     */
    expect(() => keMenit('')).toThrow();
    expect(() => keMenit('6 pagi')).toThrow();
    expect(() => keMenit('25:00')).toThrow();
  });
});

describe('shift yang menyeberang tengah malam', () => {
  it('dikenali sebagai menyeberang', () => {
    expect(menyeberangHari(SHIFT_3)).toBe(true);
    expect(menyeberangHari(SHIFT_1)).toBe(false);
  });

  it('panjangnya dihitung memutar, bukan negatif', () => {
    expect(panjangMenit(SHIFT_3)).toBe(8 * 60);
    expect(panjangMenit(SHIFT_1)).toBe(8 * 60);
  });
});

describe('menit kerja setelah istirahat', () => {
  it('istirahat di dalam shift dipotong', () => {
    const hasil = menitKerja(SHIFT_1, [
      { startTime: '09:00', endTime: '09:15' },
      { startTime: '12:00', endTime: '12:45' },
    ]);
    expect(hasil).toBe(8 * 60 - 15 - 45);
  });

  it('istirahat milik shift lain TIDAK dipotong', () => {
    /*
     * Memotong waktu kerja yang tidak pernah ada membuat efisiensi terlihat
     * lebih baik daripada sebenarnya — arah kesalahan yang paling berbahaya.
     */
    expect(menitKerja(SHIFT_1, [{ startTime: '20:00', endTime: '20:30' }])).toBe(8 * 60);
  });

  it('istirahat pada shift malam yang menyeberang tetap terhitung', () => {
    expect(istirahatDiDalam(SHIFT_3, { startTime: '01:00', endTime: '01:30' })).toBe(true);
    expect(menitKerja(SHIFT_3, [{ startTime: '01:00', endTime: '01:30' }])).toBe(8 * 60 - 30);
  });
});

describe('awal hari produksi dari master', () => {
  it('memakai shift yang ditandai', () => {
    expect(awalHariProduksi([SHIFT_2, SHIFT_3, SHIFT_1])).toBe(360);
  });

  it('tanpa penanda, jatuh ke shift paling pagi', () => {
    expect(awalHariProduksi([SHIFT_2, SHIFT_3])).toBe(14 * 60);
  });

  it('tanpa master sama sekali, null — bukan menebak angka', () => {
    expect(awalHariProduksi([])).toBeNull();
  });
});

describe('shift yang berlaku pada sebuah jam', () => {
  const semua = [SHIFT_1, SHIFT_2, SHIFT_3];
  const pada = (jam: number, menit = 0) => new Date(2026, 9, 6, jam, menit);

  it('jam biasa', () => {
    expect(shiftPada(pada(7), semua)?.code).toBe('1');
    expect(shiftPada(pada(15), semua)?.code).toBe('2');
  });

  it('dini hari masih milik shift malam', () => {
    expect(shiftPada(pada(2), semua)?.code).toBe('3');
  });

  it('tepat di batas masuk shift berikutnya', () => {
    expect(shiftPada(pada(14), semua)?.code).toBe('2');
    expect(shiftPada(pada(6), semua)?.code).toBe('1');
  });
});

describe('tumpang tindih waktu berhenti', () => {
  const jam = (h: number, m = 0) => new Date(2026, 9, 6, h, m);

  it('hanya bagian yang masuk rentang yang dihitung', () => {
    /*
     * Berhenti 05:30-07:00 pada shift yang mulai 06:00 hanya menyumbang 60
     * menit. Tanpa pemotongan, satu berhenti panjang yang melintasi tiga shift
     * akan dibebankan penuh ke ketiganya.
     */
    const berhenti = { dari: jam(5, 30), sampai: jam(7) };
    const shift = { dari: jam(6), sampai: jam(14) };
    expect(menitTumpangTindih(berhenti, shift)).toBe(60);
  });

  it('tidak bersinggungan sama sekali = 0', () => {
    expect(
      menitTumpangTindih({ dari: jam(3), sampai: jam(4) }, { dari: jam(6), sampai: jam(14) }),
    ).toBe(0);
  });

  it('berhenti yang masih berlangsung dihitung sampai sekarang', () => {
    const hasil = menitTumpangTindih(
      { dari: jam(8), sampai: null },
      { dari: jam(6), sampai: jam(14) },
      jam(8, 30),
    );
    expect(hasil).toBe(30);
  });
});

describe('ember per jam', () => {
  it('berlabel sesuai jam mulai pabrik, bukan tengah malam', () => {
    const ember = emberJam(new Date(2026, 9, 6, 6, 0), 3);
    expect(ember.map((e) => e.label)).toEqual(['06-07', '07-08', '08-09']);
  });

  it('melewati tengah malam dengan label dua digit', () => {
    const ember = emberJam(new Date(2026, 9, 6, 23, 0), 2);
    expect(ember.map((e) => e.label)).toEqual(['23-00', '00-01']);
  });
});

describe('efisiensi', () => {
  it('menghitung dari waktu operasi dan cycle time', () => {
    const r = hitungEfisiensi({
      menitTersedia: 480,
      menitBerhenti: 30,
      menitBerhentiTerencana: 30,
      outputPcs: 400,
      cycleTimeDetik: 60,
    });
    expect(r.menitOperasi).toBe(420);
    expect(r.menitTeoretis).toBe(400);
    expect(r.efisiensi).toBeCloseTo(400 / 420);
  });

  it('cycle time kosong memberi null, BUKAN nol', () => {
    /*
     * Nol terbaca sebagai "lini ini buruk sekali", padahal yang sebenarnya
     * terjadi adalah cycle time-nya belum diisi.
     */
    const r = hitungEfisiensi({
      menitTersedia: 480,
      menitBerhenti: 0,
      menitBerhentiTerencana: 0,
      outputPcs: 100,
      cycleTimeDetik: null,
    });
    expect(r.efisiensi).toBeNull();
  });

  it('waktu operasi nol tidak membagi dengan nol', () => {
    const r = hitungEfisiensi({
      menitTersedia: 60,
      menitBerhenti: 60,
      menitBerhentiTerencana: 0,
      outputPcs: 0,
      cycleTimeDetik: 30,
    });
    expect(r.menitOperasi).toBe(0);
    expect(r.efisiensi).toBeNull();
  });
});

describe('status lini untuk dashboard', () => {
  const jam = (h: number, m = 0) => new Date(2026, 9, 6, h, m);

  it('ada berhenti terbuka = STOP, apa pun scan terakhirnya', () => {
    expect(
      statusLini({ adaBerhentiTerbuka: true, scanTerakhir: jam(8), sekarang: jam(8, 1) }),
    ).toBe('STOP');
  });

  it('scan baru = RUNNING', () => {
    expect(
      statusLini({ adaBerhentiTerbuka: false, scanTerakhir: jam(8), sekarang: jam(8, 10) }),
    ).toBe('RUNNING');
  });

  it('lama tanpa scan = IDLE, bukan RUNNING', () => {
    expect(
      statusLini({ adaBerhentiTerbuka: false, scanTerakhir: jam(8), sekarang: jam(9, 30) }),
    ).toBe('IDLE');
  });

  it('belum pernah scan = IDLE', () => {
    expect(statusLini({ adaBerhentiTerbuka: false, scanTerakhir: null })).toBe('IDLE');
  });
});
