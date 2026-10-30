import { KATALOG_UJI } from './katalog-uji';
import { describe, it, expect } from 'vitest';
import {
  modeScanBawaan,
  modeScanBerlaku,
  normalkanModeScan,
  scanPerBox,
  syaratScan,
  duplikatDariBarcode,
  SCAN_MODES,
  SCAN_MODE_LABELS,
} from './scan-mode';

describe('metode scan bawaan per jenis proses', () => {
  it('proses BODY: satu scan = satu box', () => {
    expect(modeScanBawaan(KATALOG_UJI, 'INJECTION_WIP')).toBe('KANBAN_BOX');
    expect(modeScanBawaan(KATALOG_UJI, 'PAINTING_WIP')).toBe('KANBAN_BOX');
    expect(modeScanBawaan(KATALOG_UJI, 'ASSEMBLING_BODY_FG')).toBe('KANBAN_BOX');
  });

  it('lini UNIT yang menghasilkan barang jadi: part + kartu', () => {
    expect(modeScanBawaan(KATALOG_UJI, 'CASTING_FG')).toBe('PART_KANBAN');
    expect(modeScanBawaan(KATALOG_UJI, 'MACHINING_FG')).toBe('PART_KANBAN');
    expect(modeScanBawaan(KATALOG_UJI, 'ASSEMBLING_UNIT_FG')).toBe('PART_KANBAN');
  });

  it('lini WIP: part saja', () => {
    expect(modeScanBawaan(KATALOG_UJI, 'CASTING_WIP')).toBe('PART_SAJA');
    expect(modeScanBawaan(KATALOG_UJI, 'MACHINING_WIP')).toBe('PART_SAJA');
    expect(modeScanBawaan(KATALOG_UJI, 'MELTING')).toBe('PART_SAJA');
  });

  it('setiap metode punya label untuk layar', () => {
    for (const m of SCAN_MODES) expect(SCAN_MODE_LABELS[m]).toBeTruthy();
  });
});

describe('nilai metode yang lama tetap terbaca', () => {
  /*
   * 54 scan yang sudah tercatat menyimpan PER_PIECE/PER_KANBAN sebagai
   * snapshot. Kalau penerjemahannya salah, tafsir riwayat berubah tanpa ada
   * satu pun data yang disentuh.
   */
  it('PER_KANBAN menjadi KANBAN_BOX', () => {
    expect(normalkanModeScan(KATALOG_UJI, 'PER_KANBAN', 'INJECTION_WIP')).toBe('KANBAN_BOX');
  });

  it('PER_PIECE menjadi PART_KANBAN di lini FG, PART_SAJA di lini WIP', () => {
    expect(normalkanModeScan(KATALOG_UJI, 'PER_PIECE', 'MACHINING_FG')).toBe('PART_KANBAN');
    expect(normalkanModeScan(KATALOG_UJI, 'PER_PIECE', 'MACHINING_WIP')).toBe('PART_SAJA');
  });

  it('kosong jatuh ke bawaan prosesnya', () => {
    expect(normalkanModeScan(KATALOG_UJI, null, 'INJECTION_WIP')).toBe('KANBAN_BOX');
    expect(normalkanModeScan(KATALOG_UJI, undefined, 'CASTING_WIP')).toBe('PART_SAJA');
  });

  it('nilai baru dibiarkan apa adanya', () => {
    for (const m of SCAN_MODES) expect(normalkanModeScan(KATALOG_UJI, m, 'CASTING_WIP')).toBe(m);
  });

  it('scanPerBox menerima nilai lama maupun baru', () => {
    expect(scanPerBox('PER_KANBAN')).toBe(true);
    expect(scanPerBox('KANBAN_BOX')).toBe(true);
    expect(scanPerBox('PART_KANBAN')).toBe(false);
    expect(scanPerBox(null)).toBe(false);
  });
});

describe('syarat scan diturunkan dari metode, bukan dari jenis proses', () => {
  it('PART_SAJA: kanban dilarang', () => {
    const s = syaratScan(KATALOG_UJI, 'PART_SAJA');
    expect(s.kanbanWajib).toBe(false);
    expect(s.kanbanDilarang).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(false);
    expect(s.qtyDariKartu).toBe(false);
  });

  it('PART_KANBAN: kanban wajib, unit ditempel ke kartu, qty dari barcode', () => {
    const s = syaratScan(KATALOG_UJI, 'PART_KANBAN');
    expect(s.kanbanWajib).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(true);
    expect(s.qtyDariKartu).toBe(false);
    expect(s.tolakKartuTerproduksi).toBe(false);
  });

  it('KANBAN_BOX: qty dari kartu, kartu terproduksi ditolak, unit tidak ditempel', () => {
    const s = syaratScan(KATALOG_UJI, 'KANBAN_BOX');
    expect(s.kanbanWajib).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(false);
    expect(s.qtyDariKartu).toBe(true);
    expect(s.tolakKartuTerproduksi).toBe(true);
  });

  it('metode yang sama memberi syarat yang sama di SEMUA jenis proses', () => {
    /*
     * Inti perubahan ini: jenis proses tidak lagi ikut memutuskan. Lini FG yang
     * disetel PART_SAJA memang tidak memakai kartu.
     */
    for (const p of KATALOG_UJI.kode) {
      expect(syaratScan(KATALOG_UJI, 'PART_SAJA', p)).toEqual(syaratScan(KATALOG_UJI, 'PART_SAJA', 'CASTING_WIP'));
      expect(syaratScan(KATALOG_UJI, 'KANBAN_BOX', p)).toEqual(syaratScan(KATALOG_UJI, 'KANBAN_BOX', 'MELTING'));
    }
  });

  it('PART_TANPA_KANBAN bersyarat sama dengan PART_SAJA — yang beda artinya di hilir', () => {
    expect(syaratScan(KATALOG_UJI, 'PART_TANPA_KANBAN')).toEqual(syaratScan(KATALOG_UJI, 'PART_SAJA'));
  });

  it('PART_PINDAH_KARTU ditandai belum tersedia supaya scan-nya ditolak', () => {
    const s = syaratScan(KATALOG_UJI, 'PART_PINDAH_KARTU');
    expect(s.belumTersedia).toBe(true);
    expect(s.pindahKartu).toBe(true);
    // Metode lain tidak boleh ikut tertandai.
    expect(syaratScan(KATALOG_UJI, 'PART_KANBAN').belumTersedia).toBe(false);
  });
});

describe('dasar pemeriksaan duplikat', () => {
  it('per barang memakai barcode; per box memakai status kartu', () => {
    expect(duplikatDariBarcode(KATALOG_UJI, 'PART_SAJA')).toBe(true);
    expect(duplikatDariBarcode(KATALOG_UJI, 'PART_KANBAN')).toBe(true);
    expect(duplikatDariBarcode(KATALOG_UJI, 'KANBAN_BOX')).toBe(false);
  });

  it('nilai lama ikut benar', () => {
    expect(duplikatDariBarcode(KATALOG_UJI, 'PER_PIECE', 'MACHINING_FG')).toBe(true);
    expect(duplikatDariBarcode(KATALOG_UJI, 'PER_KANBAN', 'INJECTION_WIP')).toBe(false);
  });
});

describe('metode yang berlaku di sebuah lini', () => {
  it('penimpa lini mengalahkan master proses', () => {
    /*
     * Injection dan assembling BODY berada di pabrik yang sama dengan metode
     * proses yang sama, tetapi caranya berbeda. Tanpa penimpa, salah satunya
     * pasti memakai cara yang tidak cocok.
     */
    expect(
      modeScanBerlaku(KATALOG_UJI, { modeLini: 'KANBAN_MOLD', modeProses: 'KANBAN_BOX', proses: 'INJECTION_WIP' }),
    ).toBe('KANBAN_MOLD');
  });

  it('tanpa penimpa, ikut master proses', () => {
    expect(modeScanBerlaku(KATALOG_UJI, { modeLini: null, modeProses: 'KANBAN_BOX', proses: 'INJECTION_WIP' })).toBe(
      'KANBAN_BOX',
    );
  });

  it('tanpa keduanya, jatuh ke bawaan jenis prosesnya', () => {
    expect(modeScanBerlaku(KATALOG_UJI, { proses: 'MACHINING_FG' })).toBe('PART_KANBAN');
    expect(modeScanBerlaku(KATALOG_UJI, { proses: 'CASTING_WIP' })).toBe('PART_SAJA');
  });

  it('nilai lama di salah satu tingkat tetap diterjemahkan', () => {
    expect(modeScanBerlaku(KATALOG_UJI, { modeLini: 'PER_KANBAN', proses: 'INJECTION_WIP' })).toBe('KANBAN_BOX');
    expect(modeScanBerlaku(KATALOG_UJI, { modeProses: 'PER_PIECE', proses: 'MACHINING_FG' })).toBe('PART_KANBAN');
  });

  it('metode mold dan dandori dihitung per box, dan ditandai belum tersedia', () => {
    expect(scanPerBox('KANBAN_MOLD')).toBe(true);
    expect(scanPerBox('KANBAN_BOX_DANDORI')).toBe(true);
    expect(syaratScan(KATALOG_UJI, 'KANBAN_MOLD').belumTersedia).toBe(true);
    expect(syaratScan(KATALOG_UJI, 'KANBAN_BOX_DANDORI').belumTersedia).toBe(true);
    expect(duplikatDariBarcode(KATALOG_UJI, 'KANBAN_MOLD')).toBe(false);
  });
});
