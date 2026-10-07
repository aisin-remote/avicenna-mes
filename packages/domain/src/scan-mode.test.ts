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
import { PROCESS_TYPES } from '@avicenna/contracts';

describe('metode scan bawaan per jenis proses', () => {
  it('proses BODY: satu scan = satu box', () => {
    expect(modeScanBawaan('INJECTION')).toBe('KANBAN_BOX');
    expect(modeScanBawaan('PAINTING')).toBe('KANBAN_BOX');
    expect(modeScanBawaan('ASSEMBLING_BODY')).toBe('KANBAN_BOX');
  });

  it('lini UNIT yang menghasilkan barang jadi: part + kartu', () => {
    expect(modeScanBawaan('CASTING_FG')).toBe('PART_KANBAN');
    expect(modeScanBawaan('MACHINING_FG')).toBe('PART_KANBAN');
    expect(modeScanBawaan('ASSEMBLING_UNIT')).toBe('PART_KANBAN');
  });

  it('lini WIP: part saja', () => {
    expect(modeScanBawaan('CASTING_WIP')).toBe('PART_SAJA');
    expect(modeScanBawaan('MACHINING_WIP')).toBe('PART_SAJA');
    expect(modeScanBawaan('MELTING')).toBe('PART_SAJA');
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
    expect(normalkanModeScan('PER_KANBAN', 'INJECTION')).toBe('KANBAN_BOX');
  });

  it('PER_PIECE menjadi PART_KANBAN di lini FG, PART_SAJA di lini WIP', () => {
    expect(normalkanModeScan('PER_PIECE', 'MACHINING_FG')).toBe('PART_KANBAN');
    expect(normalkanModeScan('PER_PIECE', 'MACHINING_WIP')).toBe('PART_SAJA');
  });

  it('kosong jatuh ke bawaan prosesnya', () => {
    expect(normalkanModeScan(null, 'INJECTION')).toBe('KANBAN_BOX');
    expect(normalkanModeScan(undefined, 'CASTING_WIP')).toBe('PART_SAJA');
  });

  it('nilai baru dibiarkan apa adanya', () => {
    for (const m of SCAN_MODES) expect(normalkanModeScan(m, 'CASTING_WIP')).toBe(m);
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
    const s = syaratScan('PART_SAJA');
    expect(s.kanbanWajib).toBe(false);
    expect(s.kanbanDilarang).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(false);
    expect(s.qtyDariKartu).toBe(false);
  });

  it('PART_KANBAN: kanban wajib, unit ditempel ke kartu, qty dari barcode', () => {
    const s = syaratScan('PART_KANBAN');
    expect(s.kanbanWajib).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(true);
    expect(s.qtyDariKartu).toBe(false);
    expect(s.tolakKartuTerproduksi).toBe(false);
  });

  it('KANBAN_BOX: qty dari kartu, kartu terproduksi ditolak, unit tidak ditempel', () => {
    const s = syaratScan('KANBAN_BOX');
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
    for (const p of PROCESS_TYPES) {
      expect(syaratScan('PART_SAJA', p)).toEqual(syaratScan('PART_SAJA', 'CASTING_WIP'));
      expect(syaratScan('KANBAN_BOX', p)).toEqual(syaratScan('KANBAN_BOX', 'MELTING'));
    }
  });

  it('PART_TANPA_KANBAN bersyarat sama dengan PART_SAJA — yang beda artinya di hilir', () => {
    expect(syaratScan('PART_TANPA_KANBAN')).toEqual(syaratScan('PART_SAJA'));
  });

  it('PART_PINDAH_KARTU ditandai belum tersedia supaya scan-nya ditolak', () => {
    const s = syaratScan('PART_PINDAH_KARTU');
    expect(s.belumTersedia).toBe(true);
    expect(s.pindahKartu).toBe(true);
    // Metode lain tidak boleh ikut tertandai.
    expect(syaratScan('PART_KANBAN').belumTersedia).toBe(false);
  });
});

describe('dasar pemeriksaan duplikat', () => {
  it('per barang memakai barcode; per box memakai status kartu', () => {
    expect(duplikatDariBarcode('PART_SAJA')).toBe(true);
    expect(duplikatDariBarcode('PART_KANBAN')).toBe(true);
    expect(duplikatDariBarcode('KANBAN_BOX')).toBe(false);
  });

  it('nilai lama ikut benar', () => {
    expect(duplikatDariBarcode('PER_PIECE', 'MACHINING_FG')).toBe(true);
    expect(duplikatDariBarcode('PER_KANBAN', 'INJECTION')).toBe(false);
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
      modeScanBerlaku({ modeLini: 'KANBAN_MOLD', modeProses: 'KANBAN_BOX', proses: 'INJECTION' }),
    ).toBe('KANBAN_MOLD');
  });

  it('tanpa penimpa, ikut master proses', () => {
    expect(modeScanBerlaku({ modeLini: null, modeProses: 'KANBAN_BOX', proses: 'INJECTION' })).toBe(
      'KANBAN_BOX',
    );
  });

  it('tanpa keduanya, jatuh ke bawaan jenis prosesnya', () => {
    expect(modeScanBerlaku({ proses: 'MACHINING_FG' })).toBe('PART_KANBAN');
    expect(modeScanBerlaku({ proses: 'CASTING_WIP' })).toBe('PART_SAJA');
  });

  it('nilai lama di salah satu tingkat tetap diterjemahkan', () => {
    expect(modeScanBerlaku({ modeLini: 'PER_KANBAN', proses: 'INJECTION' })).toBe('KANBAN_BOX');
    expect(modeScanBerlaku({ modeProses: 'PER_PIECE', proses: 'MACHINING_FG' })).toBe('PART_KANBAN');
  });

  it('metode mold dan dandori dihitung per box, dan ditandai belum tersedia', () => {
    expect(scanPerBox('KANBAN_MOLD')).toBe(true);
    expect(scanPerBox('KANBAN_BOX_DANDORI')).toBe(true);
    expect(syaratScan('KANBAN_MOLD').belumTersedia).toBe(true);
    expect(syaratScan('KANBAN_BOX_DANDORI').belumTersedia).toBe(true);
    expect(duplikatDariBarcode('KANBAN_MOLD')).toBe(false);
  });
});
