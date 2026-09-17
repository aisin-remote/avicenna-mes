import { describe, it, expect } from 'vitest';
import {
  prosesSebelumnya,
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

const TCC_A = rute('MELTING', 'CASTING', 'MACHINING', 'ASSEMBLING_UNIT', 'DELIVERY');
const OPN_A = rute('MELTING', 'CASTING', 'MACHINING', 'DELIVERY');
const CSH_A = rute('MELTING', 'CASTING', 'DELIVERY');
const HANDLE = rute('INJECTION', 'PAINTING', 'ASSEMBLING_BODY', 'DELIVERY');
const GARNISH = rute('INJECTION', 'ASSEMBLING_BODY', 'DELIVERY');

describe('prosesSebelumnya', () => {
  it('proses pertama dalam rute tidak punya syarat', () => {
    expect(prosesSebelumnya(TCC_A, 'MELTING')).toBeUndefined();
    expect(prosesSebelumnya(HANDLE, 'INJECTION')).toBeUndefined();
  });

  it('machining mewajibkan casting', () => {
    expect(prosesSebelumnya(TCC_A, 'MACHINING')).toBe('CASTING');
    expect(prosesSebelumnya(OPN_A, 'MACHINING')).toBe('CASTING');
  });

  it('proses sebelum Delivery BERBEDA untuk tiap part', () => {
    /*
     * Inilah yang tidak bisa dinyatakan rantai global. Ketiganya berakhir di
     * Delivery, tetapi yang mendahuluinya berlainan — dan aturan lama yang
     * hanya berupa fungsi dari jenis proses akan memberi jawaban yang sama
     * untuk ketiganya.
     */
    expect(prosesSebelumnya(TCC_A, 'DELIVERY')).toBe('ASSEMBLING_UNIT');
    expect(prosesSebelumnya(OPN_A, 'DELIVERY')).toBe('MACHINING');
    expect(prosesSebelumnya(CSH_A, 'DELIVERY')).toBe('CASTING');
  });

  it('dua part satu proyek bisa berbeda syaratnya', () => {
    // Proyek 660A: HANDLE melewati Painting, GARNISH tidak.
    expect(prosesSebelumnya(HANDLE, 'ASSEMBLING_BODY')).toBe('PAINTING');
    expect(prosesSebelumnya(GARNISH, 'ASSEMBLING_BODY')).toBe('INJECTION');
  });

  it('proses yang tidak ada di rute tidak menghasilkan syarat', () => {
    // CSH A tidak melewati machining sama sekali.
    expect(prosesSebelumnya(CSH_A, 'MACHINING')).toBeUndefined();
  });

  it('nomor urut boleh berlompatan', () => {
    // Nomor dibuat berjarak supaya langkah baru bisa disisipkan tanpa menomori
    // ulang seluruh rute. Yang dicari seqNo terbesar yang lebih kecil, bukan
    // "nomor sekarang dikurangi satu".
    const r: LangkahRute[] = [
      { processType: 'CASTING', seqNo: 5 },
      { processType: 'MACHINING', seqNo: 900 },
    ];
    expect(prosesSebelumnya(r, 'MACHINING')).toBe('CASTING');
  });

  it('urutan di dalam array tidak menentukan apa pun — seqNo yang menentukan', () => {
    const teracak: LangkahRute[] = [
      { processType: 'DELIVERY', seqNo: 40 },
      { processType: 'MELTING', seqNo: 10 },
      { processType: 'CASTING', seqNo: 20 },
      { processType: 'MACHINING', seqNo: 30 },
    ];
    expect(prosesSebelumnya(teracak, 'DELIVERY')).toBe('MACHINING');
    expect(prosesSebelumnya(teracak, 'CASTING')).toBe('MELTING');
  });

  it('rute kosong tidak melempar, hanya tanpa syarat', () => {
    expect(prosesSebelumnya([], 'CASTING')).toBeUndefined();
  });
});

describe('prosesAdaDiRute', () => {
  it('menolak part yang dibawa ke lini yang bukan rutenya', () => {
    // CSH tidak pernah melewati machining. Tanpa pemeriksaan ini, part CSH yang
    // discan di lini machining akan menambah stok barang jadi yang tak pernah
    // dibuat.
    expect(prosesAdaDiRute(CSH_A, 'MACHINING')).toBe(false);
    expect(prosesAdaDiRute(GARNISH, 'PAINTING')).toBe(false);
  });

  it('menerima proses yang memang ada di rutenya', () => {
    expect(prosesAdaDiRute(CSH_A, 'CASTING')).toBe(true);
    expect(prosesAdaDiRute(HANDLE, 'PAINTING')).toBe(true);
  });

  it('alur UNIT dan BODY tidak saling menerima', () => {
    expect(prosesAdaDiRute(TCC_A, 'INJECTION')).toBe(false);
    expect(prosesAdaDiRute(HANDLE, 'CASTING')).toBe(false);
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
      { processType: 'CASTING', seqNo: 20 },
    ];
    expect(ruteTerurut(teracak).map((r) => r.processType)).toEqual([
      'MELTING',
      'CASTING',
      'DELIVERY',
    ]);
  });

  it('tidak mengubah array aslinya', () => {
    const asli: LangkahRute[] = [
      { processType: 'CASTING', seqNo: 20 },
      { processType: 'MELTING', seqNo: 10 },
    ];
    ruteTerurut(asli);
    expect(asli[0]?.processType).toBe('CASTING');
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
