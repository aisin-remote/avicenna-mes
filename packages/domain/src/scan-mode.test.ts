import { describe, it, expect } from 'vitest';
import { modeScanBawaan, syaratScan, duplikatDariBarcode, SCAN_MODES, SCAN_MODE_LABELS } from './scan-mode';
import { PROCESS_TYPES } from '@avicenna/contracts';

describe('modeScanBawaan', () => {
  it('proses BODY per kanban, proses UNIT per barang', () => {
    expect(modeScanBawaan('INJECTION')).toBe('PER_KANBAN');
    expect(modeScanBawaan('PAINTING')).toBe('PER_KANBAN');
    expect(modeScanBawaan('ASSEMBLING_BODY')).toBe('PER_KANBAN');
    expect(modeScanBawaan('CASTING_WIP')).toBe('PER_PIECE');
    expect(modeScanBawaan('MACHINING_FG')).toBe('PER_PIECE');
  });

  it('setiap jenis proses punya bawaan', () => {
    for (const p of PROCESS_TYPES) expect(SCAN_MODES).toContain(modeScanBawaan(p));
  });
});

describe('syaratScan', () => {
  it('PER_PIECE di lini WIP: kanban dilarang', () => {
    const s = syaratScan('PER_PIECE', 'CASTING_WIP');
    expect(s.kanbanWajib).toBe(false);
    expect(s.kanbanDilarang).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(false);
  });

  it('PER_PIECE di lini FG: kanban wajib, unit ditempel ke kartu', () => {
    const s = syaratScan('PER_PIECE', 'MACHINING_FG');
    expect(s.kanbanWajib).toBe(true);
    expect(s.tempelUnitKeKartu).toBe(true);
    expect(s.qtyDariKartu).toBe(false);
  });

  it('PER_KANBAN: kanban wajib di SEMUA proses, termasuk yang bukan FG', () => {
    /*
     * Di BODY injection bukan FG, tetapi tetap men-scan kanban — satu scan
     * satu box. Aturan "hanya FG yang pakai kanban" adalah aturan UNIT.
     */
    for (const p of ['INJECTION', 'PAINTING', 'ASSEMBLING_BODY'] as const) {
      const s = syaratScan('PER_KANBAN', p);
      expect(s.kanbanWajib, p).toBe(true);
      expect(s.kanbanDilarang, p).toBe(false);
      expect(s.qtyDariKartu, p).toBe(true);
      expect(s.tolakKartuTerproduksi, p).toBe(true);
      // Tidak ada seri per barang, jadi tidak ada yang bisa ditempel.
      expect(s.tempelUnitKeKartu, p).toBe(false);
    }
  });

  it('kanban tidak pernah sekaligus wajib dan dilarang', () => {
    for (const m of SCAN_MODES) {
      for (const p of PROCESS_TYPES) {
        const s = syaratScan(m, p);
        expect(s.kanbanWajib && s.kanbanDilarang, `${m}/${p}`).toBe(false);
      }
    }
  });
});

describe('duplikatDariBarcode', () => {
  it('per barang: ya; per kanban: tidak', () => {
    /*
     * Di PER_KANBAN barcode = master sample yang sama sepanjang shift.
     * Memeriksanya akan menolak scan kedua sebagai duplikat.
     */
    expect(duplikatDariBarcode('PER_PIECE')).toBe(true);
    expect(duplikatDariBarcode('PER_KANBAN')).toBe(false);
  });
});

describe('label', () => {
  it('setiap mode punya label', () => {
    for (const m of SCAN_MODES) expect(SCAN_MODE_LABELS[m]).toBeTruthy();
  });
});
