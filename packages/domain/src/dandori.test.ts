import { describe, expect, it } from 'vitest';
import { bacaKodeDandori, metodeDandori, sepertiKodeDandori } from './dandori';

describe('bacaKodeDandori', () => {
  it('nomor part bergaris maupun tidak', () => {
    expect(bacaKodeDandori('DANDORI-212110-34010')).toBe('212110-34010');
    expect(bacaKodeDandori('DANDORI-21211034010')).toBe('21211034010');
  });

  it('huruf kecil dan spasi di tepi tetap terbaca', () => {
    expect(bacaKodeDandori('  dandori-2121113190004 ')).toBe('2121113190004');
  });

  it('bukan QR dandori', () => {
    expect(bacaKodeDandori('011231234567890')).toBeNull();
    expect(bacaKodeDandori('DANDORI-')).toBeNull();
    expect(bacaKodeDandori('MOLD-INJ01')).toBeNull();
    expect(sepertiKodeDandori('ARES:K:01J8Z3M5X8Q9W2Y7V6T5R4S3P2|15133-20010|200')).toBe(false);
  });
});

describe('metodeDandori', () => {
  it('mengikuti metode scan line', () => {
    expect(metodeDandori('PART_SAJA')).toBe('PART');
    expect(metodeDandori('PART_KANBAN')).toBe('PART');
    expect(metodeDandori('KANBAN_BOX')).toBe('PART_SAMPLE');
    expect(metodeDandori('KANBAN_BOX_DANDORI')).toBe('PART_SAMPLE');
    expect(metodeDandori('KANBAN_MOLD')).toBe('MOLD');
    expect(metodeDandori(null)).toBe('PART');
  });
});
