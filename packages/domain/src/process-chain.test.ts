import { describe, it, expect } from 'vitest';
import {
  PROCESS_ORDER,
  requiredPreviousProcess,
  programCodeOf,
  strainerApplies,
  REJECT_MESSAGES,
} from './process-chain';

describe('requiredPreviousProcess', () => {
  it('machining mewajibkan casting sudah discan', () => {
    expect(requiredPreviousProcess('MACHINING')).toBe('CASTING');
  });

  it('casting adalah proses pertama, tanpa syarat', () => {
    expect(requiredPreviousProcess('CASTING')).toBeUndefined();
  });

  it('assembling tanpa syarat — mengikuti sistem lama, belum dikonfirmasi tim', () => {
    expect(requiredPreviousProcess('ASSEMBLING')).toBeUndefined();
  });

  it('injection berdiri sendiri di pabrik Bella', () => {
    expect(requiredPreviousProcess('INJECTION')).toBeUndefined();
  });
});

describe('programCodeOf', () => {
  it('mengambil dua karakter pertama', () => {
    expect(programCodeOf('14ABCDEF')).toBe('14');
    expect(programCodeOf('889F0001')).toBe('88');
  });

  it('mengabaikan spasi di tepi', () => {
    expect(programCodeOf('  14ABC  ')).toBe('14');
  });

  it('menolak barcode yang terlalu pendek', () => {
    expect(programCodeOf('1')).toBeUndefined();
    expect(programCodeOf('')).toBeUndefined();
    expect(programCodeOf('   ')).toBeUndefined();
  });
});

describe('strainerApplies', () => {
  it('hanya berlaku untuk kode program 14', () => {
    expect(strainerApplies('14ABCDEF')).toBe(true);
    expect(strainerApplies('15ABCDEF')).toBe(false);
  });

  it('kode pembanding bisa diganti bila nanti dipindah ke master', () => {
    expect(strainerApplies('22XYZ', '22')).toBe(true);
  });
});

describe('REJECT_MESSAGES', () => {
  it('setiap alasan punya pesan yang memberi tahu operator harus apa', () => {
    for (const [reason, msg] of Object.entries(REJECT_MESSAGES)) {
      expect(msg.length, reason).toBeGreaterThan(10);
      // Pesan harus berisi instruksi, bukan sekadar menyatakan keadaan.
      expect(/\.$/.test(msg), reason).toBe(true);
    }
  });

  it('urutan proses avicenna terdefinisi', () => {
    expect(PROCESS_ORDER).toEqual(['CASTING', 'MACHINING', 'ASSEMBLING']);
  });
});
