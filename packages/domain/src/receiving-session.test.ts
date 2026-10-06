import { describe, expect, it } from 'vitest';
import {
  displayAresOrder,
  parseAresScanCode,
  receivingCloseTotals,
  receivingVerdict,
} from './receiving-session';

describe('receiving ARES di MES', () => {
  it('membaca barcode Order Sheet baru, revisi, legacy, dan kanban', () => {
    expect(parseAresScanCode('ARES:P:826100500101')).toEqual({
      kind: 'ORDER',
      orderNumber: '826100500100',
      revision: 1,
    });
    expect(parseAresScanCode('ARES:P:PL-260917-0042-2')).toEqual({
      kind: 'ORDER',
      orderNumber: 'PL-260917-0042',
      revision: 2,
    });
    expect(displayAresOrder('826100500100', 2)).toBe('826100500102');
    expect(parseAresScanCode('ARES:K:01K5Z7P2X3A4B5C6D7E8F9G0H1')?.kind).toBe('KANBAN');
    expect(parseAresScanCode('OTHER:K:abc')).toBeNull();
  });
  it('menolak salah dokumen, cancelled, dan penerimaan ARES lama', () => {
    expect(receivingVerdict('SHIPPED', false, 0, 0).result).toBe('REJECTED');
    expect(receivingVerdict('RECEIVED', true, 0, 0).result).toBe('REJECTED');
    expect(receivingVerdict('CANCELLED', true, 0, 0).result).toBe('REJECTED');
    expect(receivingVerdict('PRINTED', true, 0, 0).autoShipped).toBe(true);
    expect(receivingVerdict('MISSING', true, 1, 0).result).toBe('OK');
    expect(receivingVerdict('MISSING', true, 0, 0).result).toBe('REJECTED');
  });
  it('menghitung actual pcs dan meminta alasan untuk partial', () => {
    const lines = [{ boxOrdered: 3, boxScanned: 2, qtyPerBox: 20 }];
    expect(() => receivingCloseTotals(lines)).toThrow('Alasan');
    expect(receivingCloseTotals(lines, 'Supplier kurang')).toEqual({
      missing: 1,
      status: 'PARTIAL',
      pcs: 40,
    });
    expect(receivingCloseTotals([{ ...lines[0]!, boxScanned: 3 }])).toEqual({
      missing: 0,
      status: 'COMPLETE',
      pcs: 60,
    });
  });
});
