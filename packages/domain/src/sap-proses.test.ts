import { describe, it, expect } from 'vitest';
import { PROCESS_TYPES } from '@avicenna/contracts';
import {
  kelasHasilSap,
  slocHasilWajib,
  periksaHasilProduksi,
  periksaTransferSloc,
} from './sap-proses';

describe('kelasHasilSap', () => {
  it('seluruh jenis proses punya kelas — termasuk Electric', () => {
    // Record<ProcessType, …> sudah dijaga typecheck; ini menjaga agar jenis
    // baru tidak diam-diam jatuh ke undefined saat dibaca lewat string.
    for (const p of PROCESS_TYPES) {
      expect(['SFG', 'FG', null]).toContain(kelasHasilSap(p));
    }
  });

  it('lini FG menghasilkan FG, lini WIP menghasilkan SFG', () => {
    expect(kelasHasilSap('CASTING_FG')).toBe('FG');
    expect(kelasHasilSap('CASTING_WIP')).toBe('SFG');
    expect(kelasHasilSap('MACHINING_FG')).toBe('FG');
    expect(kelasHasilSap('MACHINING_WIP')).toBe('SFG');
  });

  it('assembling kedua pabrik menghasilkan FG', () => {
    expect(kelasHasilSap('ASSEMBLING_UNIT_FG')).toBe('FG');
    expect(kelasHasilSap('ASSEMBLING_BODY_FG')).toBe('FG');
  });

  /*
   * Setiap proses yang punya dua lini mengikuti aturan yang sama, apa pun
   * pabriknya: akhiran _FG berarti menutup rute, _WIP berarti diteruskan.
   * Dinyatakan satu kali untuk SELURUH pasangannya supaya pasangan baru yang
   * lupa diklasifikasikan langsung ketahuan.
   */
  it('akhiran _WIP selalu SFG dan _FG selalu FG, untuk semua pasangan', () => {
    const pasangan = PROCESS_TYPES.filter((p) => p.endsWith('_WIP') || p.endsWith('_FG'));
    expect(pasangan.length).toBeGreaterThan(8);
    for (const p of pasangan) {
      expect([p, kelasHasilSap(p)]).toEqual([p, p.endsWith('_FG') ? 'FG' : 'SFG']);
    }
  });

  /*
   * Electric tidak menutup rute: hasilnya dirakit di Assembling Body, jadi
   * keempat langkahnya menghasilkan barang setengah jadi.
   */
  /*
   * Electric punya dua macam keluaran: lini FG-nya menutup rute, sedangkan
   * Antena diteruskan ke Assembling Body di pabrik lain.
   */
  it('lini FG Electric menghasilkan barang jadi, lini WIP-nya tidak', () => {
    expect(kelasHasilSap('INSPECTION_WIP')).toBe('SFG');
    expect(kelasHasilSap('INSPECTION_FG')).toBe('FG');
    expect(kelasHasilSap('VACUUM_WIP')).toBe('SFG');
    expect(kelasHasilSap('VACUUM_FG')).toBe('FG');
  });

  it('mounting dan antena menghasilkan setengah jadi', () => {
    expect(kelasHasilSap('MOUNTING')).toBe('SFG');
    expect(kelasHasilSap('ANTENNA')).toBe('SFG');
  });

  it('part Electric yang dikirim langsung tetap bisa jadi FG lewat posisi rute', () => {
    expect(kelasHasilSap('ANTENNA', true)).toBe('FG');
  });

  it('melting dan delivery tidak punya padanan produksi di SAP', () => {
    expect(kelasHasilSap('MELTING')).toBeNull();
    expect(kelasHasilSap('DELIVERY')).toBeNull();
  });

  /*
   * Inilah sebab argumen kedua ada: pada proyek 660A sebuah part bisa berhenti
   * di Injection dan langsung dikirim ke customer. Posisi langkah di rute
   * mengalahkan tabel.
   */
  it('langkah terakhir di rute menghasilkan FG walau tabelnya bilang SFG', () => {
    expect(kelasHasilSap('INJECTION_WIP', true)).toBe('FG');
    expect(kelasHasilSap('INJECTION_WIP', false)).toBe('SFG');
    expect(kelasHasilSap('PAINTING_WIP', true)).toBe('FG');
  });

  it('langkah terakhir tidak membuat melting jadi punya material SAP', () => {
    expect(kelasHasilSap('MELTING', true)).toBeNull();
  });

  it('kelas menentukan jenis SLOC yang wajib', () => {
    expect(slocHasilWajib('SFG')).toBe('WIP');
    expect(slocHasilWajib('FG')).toBe('FINISH_GOOD');
    expect(slocHasilWajib(null)).toBeNull();
  });
});

describe('periksaHasilProduksi', () => {
  it('meloloskan SFG yang keluar ke SLOC WIP', () => {
    expect(
      periksaHasilProduksi({ proses: 'CASTING_WIP', slocKind: 'WIP', slocCode: 'WP80' }).kirim,
    ).toBe(true);
  });

  it('meloloskan FG yang keluar ke SLOC barang jadi', () => {
    expect(
      periksaHasilProduksi({ proses: 'ASSEMBLING_UNIT_FG', slocKind: 'FINISH_GOOD', slocCode: 'FG80' })
        .kirim,
    ).toBe(true);
  });

  /*
   * Inilah yang terjadi pada seluruh lini WIP sebelum perbaikan ini: seed
   * memberi SETIAP lini WIP -> FINISH_GOOD, sehingga hasil setengah jadi
   * tercatat di FG80 sedangkan SAP menaruhnya di WP80.
   */
  it('menahan SFG yang keluar ke SLOC barang jadi, dan menyebut sebabnya', () => {
    const hasil = periksaHasilProduksi({
      proses: 'MACHINING_WIP',
      slocKind: 'FINISH_GOOD',
      slocCode: 'FG80',
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).not.toBe(true);
    expect(hasil.alasan).toContain('FG80');
    expect(hasil.alasan).toContain('material master');
  });

  it('menahan FG yang keluar ke SLOC WIP', () => {
    const hasil = periksaHasilProduksi({ proses: 'CASTING_FG', slocKind: 'WIP', slocCode: 'WP80' });
    expect(hasil.kirim).toBe(false);
    expect(hasil.alasan).toContain('barang jadi');
  });

  it('melting dilewati dengan sengaja, bukan ditahan', () => {
    const hasil = periksaHasilProduksi({ proses: 'MELTING', slocKind: 'WIP' });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).toBe(true);
    expect(hasil.alasan).toContain('logam cair');
  });

  it('SLOC kosong menahan, bukan melewati', () => {
    const hasil = periksaHasilProduksi({ proses: 'CASTING_WIP', slocKind: null });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).not.toBe(true);
  });

  it('part yang berhenti di injection boleh keluar ke SLOC barang jadi', () => {
    expect(
      periksaHasilProduksi({
        proses: 'INJECTION_WIP',
        slocKind: 'FINISH_GOOD',
        slocCode: 'FG70',
        langkahTerakhir: true,
      }).kirim,
    ).toBe(true);
  });
});

describe('periksaTransferSloc', () => {
  it('meloloskan WH -> WP, satu-satunya transfer di blueprint PP', () => {
    expect(
      periksaTransferSloc({
        dariKind: 'WAREHOUSE',
        keKind: 'WIP',
        dariCode: 'WH80',
        keCode: 'WP80',
      }).kirim,
    ).toBe(true);
  });

  /*
   * Pulling. ST80 tidak ada di SAP sama sekali — kalau dokumennya terkirim,
   * SAP menolaknya karena storage location-nya tidak dikenal, dan barisnya
   * menumpuk sebagai REJECTED yang tidak ada yang bisa memperbaiki.
   */
  it('melewati FG -> ST karena SLOC staging hanya ada di Avicenna', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'FINISH_GOOD',
      keKind: 'STAGING',
      dariCode: 'FG80',
      keCode: 'ST80',
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).toBe(true);
    expect(hasil.alasan).toContain('ST80');
  });

  it('melewati WP -> FG karena barang jadi masuk lewat goods receipt', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'WIP',
      keKind: 'FINISH_GOOD',
      dariCode: 'WP70',
      keCode: 'FG70',
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).toBe(true);
    expect(hasil.alasan).toContain('goods receipt');
  });

  it('melewati tujuan SLOC reject karena SAP yang memposting dari qty NG', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'WIP',
      keKind: 'NG',
      dariCode: 'WP70',
      keCode: 'RE70',
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).toBe(true);
    expect(hasil.alasan).toContain('qty NG');
  });

  it('melewati serah-terima antar langkah internal di dalam SLOC WIP', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'WIP',
      keKind: 'WIP',
      dariCode: 'WP80',
      keCode: 'WP80-B',
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).toBe(true);
    expect(hasil.alasan).toContain('SLOC WIP');
  });

  it('SLOC yang sama bukan perpindahan', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'WIP',
      keKind: 'WIP',
      dariCode: 'WP80',
      keCode: 'WP80',
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).toBe(true);
    expect(hasil.alasan).toContain('sama');
  });

  it('pola yang tidak dikenal DITAHAN, bukan dilewati', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'FINISH_GOOD',
      keKind: 'WAREHOUSE',
      dariCode: 'FG80',
      keCode: 'WH80',
    });
    expect(hasil.kirim).toBe(false);
    // Bukan "sengaja": ini pertanyaan untuk tim SAP, bukan keputusan kita.
    expect(hasil.sengaja).not.toBe(true);
    expect(hasil.alasan).toContain('tim SAP');
  });

  /*
   * Kasus Antena (plant 900) lanjut ke Assembling Body (plant 700). Tanpa
   * pemeriksaan pabrik, ini jatuh ke aturan "WIP -> WIP" dan DILEWATI —
   * padahal justru inilah perpindahan yang harus sampai ke SAP.
   */
  it('beda pabrik DITAHAN, bukan dilewati sebagai serah-terima internal', () => {
    const hasil = periksaTransferSloc({
      dariKind: 'WIP',
      keKind: 'WIP',
      dariCode: 'WP90',
      keCode: 'WP70',
      dariPlantId: 3,
      kePlantId: 2,
    });
    expect(hasil.kirim).toBe(false);
    expect(hasil.sengaja).not.toBe(true);
    expect(hasil.alasan).toContain('antar plant');
    expect(hasil.alasan).toContain('301');
  });

  it('beda pabrik mengalahkan pola SLOC yang biasanya sah', () => {
    // WH -> WP normalnya PP-PE-01, tetapi tidak bila menyeberang pabrik.
    const hasil = periksaTransferSloc({
      dariKind: 'WAREHOUSE',
      keKind: 'WIP',
      dariCode: 'WH90',
      keCode: 'WP70',
      dariPlantId: 3,
      kePlantId: 2,
    });
    expect(hasil.kirim).toBe(false);
  });

  it('pabrik yang sama tetap lolos seperti biasa', () => {
    expect(
      periksaTransferSloc({
        dariKind: 'WAREHOUSE',
        keKind: 'WIP',
        dariCode: 'WH80',
        keCode: 'WP80',
        dariPlantId: 1,
        kePlantId: 1,
      }).kirim,
    ).toBe(true);
  });

  it('SLOC yang belum terisi menahan', () => {
    expect(periksaTransferSloc({ dariKind: 'WAREHOUSE', keKind: null }).kirim).toBe(false);
    expect(periksaTransferSloc({ dariKind: null, keKind: 'WIP' }).kirim).toBe(false);
  });
});
