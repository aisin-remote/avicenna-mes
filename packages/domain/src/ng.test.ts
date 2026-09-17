import { describe, it, expect } from 'vitest';
import {
  sumberDiizinkan,
  sumberSah,
  menggugurkanSatuKartu,
  perluMembalikProduksi,
  kunciNgAktif,
  jenisNgUntukGrup,
  bacaGrupProses,
  NgTidakSah,
  NG_ORIGINS,
  NG_SOURCES,
  NG_REJECT_MESSAGES,
  NG_ORIGIN_LABELS,
  NG_SOURCE_LABELS,
} from './ng';

describe('sumber yang sah per saat penemuan', () => {
  it('NG inline hanya lewat part code', () => {
    /*
     * Di lini WIP kanban belum ada, dan di lini FG kartu baru menempel saat
     * scan baik. Membolehkan kanban di sini berarti operator bisa menggugurkan
     * satu box penuh padahal yang rusak barang di tangannya.
     */
    expect(sumberDiizinkan('INLINE')).toEqual(['PART_CODE']);
    expect(sumberSah('INLINE', 'KANBAN')).toBe(false);
  });

  it('NG outline lewat part code maupun kanban', () => {
    expect(sumberSah('OUTLINE', 'PART_CODE')).toBe(true);
    expect(sumberSah('OUTLINE', 'KANBAN')).toBe(true);
  });

  it('setiap saat penemuan punya setidaknya satu cara pengenalan', () => {
    // Tanpa ini, menambah nilai baru akan membuat NG-nya mustahil dicatat
    // sama sekali — dan layarnya menolak semuanya tanpa sebab yang jelas.
    for (const o of NG_ORIGINS) expect(sumberDiizinkan(o).length).toBeGreaterThan(0);
  });
});

describe('menggugurkanSatuKartu', () => {
  it('hanya kanban yang menggugurkan seisi kartu', () => {
    expect(menggugurkanSatuKartu('KANBAN')).toBe(true);
    expect(menggugurkanSatuKartu('PART_CODE')).toBe(false);
  });
});

describe('perluMembalikProduksi', () => {
  it('dibalik bila barangnya memang pernah tercatat baik', () => {
    expect(perluMembalikProduksi({ adaScanProduksi: true, sudahPernahDibalik: false })).toBe(true);
  });

  it('TIDAK dibalik bila belum pernah discan baik', () => {
    /*
     * NG di lini sering ketemu sebelum barangnya sempat discan. Membalik yang
     * belum pernah masuk membuat stok minus dari barang yang tidak pernah ada.
     */
    expect(perluMembalikProduksi({ adaScanProduksi: false, sudahPernahDibalik: false })).toBe(
      false,
    );
  });

  it('TIDAK dibalik dua kali untuk satu barang', () => {
    /*
     * Satu barang bisa dicap beberapa jenis NG sekaligus — retak DAN kotor.
     * Tanpa penjagaan ini stok berkurang dua kali untuk satu barang rusak.
     */
    expect(perluMembalikProduksi({ adaScanProduksi: true, sudahPernahDibalik: true })).toBe(false);
  });
});

describe('kunciNgAktif', () => {
  it('menggabungkan barang dan jenis NG', () => {
    expect(kunciNgAktif('01ABCDEF1234567', 7)).toBe('01ABCDEF1234567|7');
  });

  it('spasi di tepi dirapikan — kartu yang sama tidak boleh berkunci dua', () => {
    expect(kunciNgAktif(' 01ABCDEF1234567 ', 7)).toBe(kunciNgAktif('01ABCDEF1234567', 7));
  });

  it('jenis NG berbeda menghasilkan kunci berbeda', () => {
    // Satu barang memang boleh punya beberapa jenis NG sekaligus.
    expect(kunciNgAktif('X', 1)).not.toBe(kunciNgAktif('X', 2));
  });

  it('barang kosong ditolak', () => {
    expect(() => kunciNgAktif('   ', 1)).toThrow(NgTidakSah);
  });

  it('barcode kelewat panjang ditolak, bukan dipotong', () => {
    /*
     * Dipotong akan membuat dua barang berbeda berbagi kunci yang sama, dan NG
     * kedua ditolak sebagai "sudah tercatat" tanpa sebab yang masuk akal.
     */
    expect(() => kunciNgAktif('A'.repeat(400), 1)).toThrow(NgTidakSah);
  });
});

describe('jenisNgUntukGrup', () => {
  const daftar = [
    { code: 'CRACK', processGroup: 'CASTING' as const },
    { code: 'BURR', processGroup: 'MACHINING' as const },
    { code: 'DLL', processGroup: null },
  ];

  it('menyaring ke grupnya', () => {
    expect(jenisNgUntukGrup(daftar, 'CASTING').map((n) => n.code)).toEqual(['CRACK', 'DLL']);
  });

  it('yang tanpa lingkup selalu ikut', () => {
    /*
     * Padanan tombol "DLL" di layar lama. Tanpa ini operator yang menemukan
     * kerusakan yang belum terdaftar tidak punya satu pilihan pun, dan barang
     * rusaknya lewat begitu saja sebagai barang baik.
     */
    for (const g of ['CASTING', 'MACHINING', 'INJECTION'] as const) {
      expect(jenisNgUntukGrup(daftar, g).some((n) => n.code === 'DLL')).toBe(true);
    }
  });

  it('tanpa grup: seluruhnya', () => {
    expect(jenisNgUntukGrup(daftar, null)).toHaveLength(3);
  });
});

describe('bacaGrupProses', () => {
  it('menerima huruf kecil dari alamat halaman', () => {
    expect(bacaGrupProses('casting')).toBe('CASTING');
    expect(bacaGrupProses(' Machining ')).toBe('MACHINING');
  });

  it('yang tidak dikenal menjadi null, bukan tebakan', () => {
    expect(bacaGrupProses('cast')).toBeNull();
    expect(bacaGrupProses(undefined)).toBeNull();
  });
});

describe('label', () => {
  it('setiap nilai punya labelnya', () => {
    for (const o of NG_ORIGINS) expect(NG_ORIGIN_LABELS[o]).toBeTruthy();
    for (const s of NG_SOURCES) expect(NG_SOURCE_LABELS[s]).toBeTruthy();
  });

  it('setiap alasan penolakan punya pesannya', () => {
    for (const [k, v] of Object.entries(NG_REJECT_MESSAGES)) {
      expect(v, k).toBeTruthy();
    }
  });
});
