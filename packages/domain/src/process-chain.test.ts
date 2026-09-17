import { describe, it, expect } from 'vitest';
import {
  prosesSebelumnya,
  periksaRute,
  menghasilkanFinishGood,
  prosesAdaDiRute,
  ruteTerurut,
  programCodeOf,
  REJECT_MESSAGES,
  type LangkahRute,
} from './process-chain';

/**
 * Rute nyata dari tabel part AIIA. Dipakai apa adanya sebagai bahan test,
 * supaya perubahan aturan langsung teruji terhadap kenyataan di pabrik — bukan
 * terhadap contoh yang dikarang.
 */
const rute = (...p: LangkahRute['processType'][]): LangkahRute[] =>
  p.map((processType, i) => ({ processType, seqNo: (i + 1) * 10 }));

/*
 * Perhatikan tipe WIP/FG-nya: langkah terakhir sebelum Delivery selalu lini FG.
 * OPN berakhir di MACHINING_FG, CSH di CASTING_FG, sedangkan pada TCC machining
 * masih WIP karena masih disusul assembling.
 */
const TCC_A = rute('MELTING', 'CASTING_WIP', 'MACHINING_WIP', 'ASSEMBLING_UNIT', 'DELIVERY');
const OPN_A = rute('MELTING', 'CASTING_WIP', 'MACHINING_FG', 'DELIVERY');
const CSH_A = rute('MELTING', 'CASTING_FG', 'DELIVERY');
const HANDLE = rute('INJECTION', 'PAINTING', 'ASSEMBLING_BODY', 'DELIVERY');
const GARNISH = rute('INJECTION', 'ASSEMBLING_BODY', 'DELIVERY');

describe('prosesSebelumnya', () => {
  it('proses pertama dalam rute tidak punya syarat', () => {
    expect(prosesSebelumnya(TCC_A, 'MELTING')).toBeUndefined();
    expect(prosesSebelumnya(HANDLE, 'INJECTION')).toBeUndefined();
  });

  it('machining mewajibkan casting', () => {
    expect(prosesSebelumnya(TCC_A, 'MACHINING_WIP')).toBe('CASTING_WIP');
    expect(prosesSebelumnya(OPN_A, 'MACHINING_FG')).toBe('CASTING_WIP');
  });

  it('proses sebelum Delivery BERBEDA untuk tiap part', () => {
    /*
     * Inilah yang tidak bisa dinyatakan rantai global. Ketiganya berakhir di
     * Delivery, tetapi yang mendahuluinya berlainan — dan aturan lama yang
     * hanya berupa fungsi dari jenis proses akan memberi jawaban yang sama
     * untuk ketiganya.
     */
    expect(prosesSebelumnya(TCC_A, 'DELIVERY')).toBe('ASSEMBLING_UNIT');
    expect(prosesSebelumnya(OPN_A, 'DELIVERY')).toBe('MACHINING_FG');
    expect(prosesSebelumnya(CSH_A, 'DELIVERY')).toBe('CASTING_FG');
  });

  it('dua part satu proyek bisa berbeda syaratnya', () => {
    // Proyek 660A: HANDLE melewati Painting, GARNISH tidak.
    expect(prosesSebelumnya(HANDLE, 'ASSEMBLING_BODY')).toBe('PAINTING');
    expect(prosesSebelumnya(GARNISH, 'ASSEMBLING_BODY')).toBe('INJECTION');
  });

  it('proses yang tidak ada di rute tidak menghasilkan syarat', () => {
    // CSH A tidak melewati machining sama sekali.
    expect(prosesSebelumnya(CSH_A, 'MACHINING_WIP')).toBeUndefined();
  });

  it('nomor urut boleh berlompatan', () => {
    // Nomor dibuat berjarak supaya langkah baru bisa disisipkan tanpa menomori
    // ulang seluruh rute. Yang dicari seqNo terbesar yang lebih kecil, bukan
    // "nomor sekarang dikurangi satu".
    const r: LangkahRute[] = [
      { processType: 'CASTING_WIP', seqNo: 5 },
      { processType: 'MACHINING_FG', seqNo: 900 },
    ];
    expect(prosesSebelumnya(r, 'MACHINING_FG')).toBe('CASTING_WIP');
  });

  it('urutan di dalam array tidak menentukan apa pun — seqNo yang menentukan', () => {
    const teracak: LangkahRute[] = [
      { processType: 'DELIVERY', seqNo: 40 },
      { processType: 'MELTING', seqNo: 10 },
      { processType: 'CASTING_WIP', seqNo: 20 },
      { processType: 'MACHINING_FG', seqNo: 30 },
    ];
    expect(prosesSebelumnya(teracak, 'DELIVERY')).toBe('MACHINING_FG');
    expect(prosesSebelumnya(teracak, 'CASTING_WIP')).toBe('MELTING');
  });

  it('rute kosong tidak melempar, hanya tanpa syarat', () => {
    expect(prosesSebelumnya([], 'CASTING_WIP')).toBeUndefined();
  });
});

describe('prosesAdaDiRute', () => {
  it('menolak part yang dibawa ke lini yang bukan rutenya', () => {
    // CSH tidak pernah melewati machining. Tanpa pemeriksaan ini, part CSH yang
    // discan di lini machining akan menambah stok barang jadi yang tak pernah
    // dibuat.
    expect(prosesAdaDiRute(CSH_A, 'MACHINING_WIP')).toBe(false);
    expect(prosesAdaDiRute(GARNISH, 'PAINTING')).toBe(false);
  });

  it('menerima proses yang memang ada di rutenya', () => {
    expect(prosesAdaDiRute(CSH_A, 'CASTING_FG')).toBe(true);
    expect(prosesAdaDiRute(HANDLE, 'PAINTING')).toBe(true);
  });

  it('alur UNIT dan BODY tidak saling menerima', () => {
    expect(prosesAdaDiRute(TCC_A, 'INJECTION')).toBe(false);
    expect(prosesAdaDiRute(HANDLE, 'CASTING_WIP')).toBe(false);
    // Assembling pun tidak tertukar antar pabrik.
    expect(prosesAdaDiRute(TCC_A, 'ASSEMBLING_BODY')).toBe(false);
    expect(prosesAdaDiRute(HANDLE, 'ASSEMBLING_UNIT')).toBe(false);
  });
});

describe('ruteTerurut', () => {
  it('mengurutkan menurut seqNo, bukan urutan penyimpanan', () => {
    const teracak: LangkahRute[] = [
      { processType: 'DELIVERY', seqNo: 30 },
      { processType: 'MELTING', seqNo: 10 },
      { processType: 'CASTING_WIP', seqNo: 20 },
    ];
    expect(ruteTerurut(teracak).map((r) => r.processType)).toEqual([
      'MELTING',
      'CASTING_WIP',
      'DELIVERY',
    ]);
  });

  it('tidak mengubah array aslinya', () => {
    const asli: LangkahRute[] = [
      { processType: 'CASTING_WIP', seqNo: 20 },
      { processType: 'MELTING', seqNo: 10 },
    ];
    ruteTerurut(asli);
    expect(asli[0]?.processType).toBe('CASTING_WIP');
  });
});

describe('menghasilkanFinishGood', () => {
  it('hanya lini FG dan assembling', () => {
    expect(menghasilkanFinishGood('CASTING_FG')).toBe(true);
    expect(menghasilkanFinishGood('MACHINING_FG')).toBe(true);
    expect(menghasilkanFinishGood('ASSEMBLING_UNIT')).toBe(true);
    expect(menghasilkanFinishGood('ASSEMBLING_BODY')).toBe(true);
  });

  it('melting dan lini WIP tidak menghasilkan finish good', () => {
    // Melting keluarannya logam cair — tidak pernah jadi barang jadi.
    expect(menghasilkanFinishGood('MELTING')).toBe(false);
    expect(menghasilkanFinishGood('CASTING_WIP')).toBe(false);
    expect(menghasilkanFinishGood('MACHINING_WIP')).toBe(false);
  });
});

describe('periksaRute', () => {
  it('meloloskan rute nyata dari tabel AIIA', () => {
    for (const r of [TCC_A, OPN_A, CSH_A, HANDLE, GARNISH]) {
      expect(periksaRute(r)).toEqual([]);
    }
  });

  it('rute WIP tanpa Delivery wajar — komponen setengah jadi', () => {
    expect(periksaRute(rute('MELTING', 'CASTING_WIP'))).toEqual([]);
  });

  it('menolak rute yang berakhir di lini WIP sebelum Delivery', () => {
    /*
     * Ini kekeliruan yang paling mahal: barangnya tidak pernah mendapat kanban,
     * dan di delivery part code sudah tidak discan — barang itu tidak akan
     * pernah bisa dikirim, dan baru ketahuan saat truk sudah menunggu.
     */
    const salah = rute('MELTING', 'CASTING_WIP', 'MACHINING_WIP', 'DELIVERY');
    expect(periksaRute(salah).join(' ')).toMatch(/finish good/);
  });

  it('menolak lini FG di tengah rute', () => {
    const salah = rute('MELTING', 'CASTING_FG', 'MACHINING_FG', 'DELIVERY');
    expect(periksaRute(salah).join(' ')).toMatch(/lebih dari satu lini finish good/);
  });

  it('menolak Delivery yang bukan langkah terakhir', () => {
    const salah = rute('MELTING', 'CASTING_FG', 'DELIVERY', 'MACHINING_WIP');
    expect(periksaRute(salah).join(' ')).toMatch(/langkah terakhir/);
  });

  it('menolak lini FG pada rute yang tidak sampai Delivery', () => {
    const salah = rute('MELTING', 'CASTING_FG');
    expect(periksaRute(salah).join(' ')).toMatch(/tanpa Delivery/);
  });

  it('rute kosong tidak dipersoalkan', () => {
    expect(periksaRute([])).toEqual([]);
  });
});

describe('programCodeOf', () => {
  it('mengambil dua karakter pertama', () => {
    expect(programCodeOf('AB12345')).toBe('AB');
  });

  it('barcode terlalu pendek tidak punya kode program', () => {
    expect(programCodeOf('A')).toBeUndefined();
    expect(programCodeOf('  ')).toBeUndefined();
  });
});

describe('REJECT_MESSAGES', () => {
  it('setiap alasan punya pesan untuk operator', () => {
    const alasan = [
      'DUPLICATE',
      'UNKNOWN_PROGRAM',
      'MISSING_PREVIOUS_PROCESS',
      'LINE_NOT_FOUND',
      'PLANT_UNKNOWN',
      'BARCODE_UNREADABLE',
      'PART_NOT_RECOGNIZED',
      'PROCESS_NOT_IN_ROUTE',
    ] as const;
    for (const a of alasan) expect(REJECT_MESSAGES[a]).toBeTruthy();
  });
});
