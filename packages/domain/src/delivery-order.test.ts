import { describe, expect, it } from 'vitest';
import {
  deliveryOrderPreview,
  deliveryOrderQr,
  deliveryOrderNumber,
  type DeliveryOrderItem,
} from './delivery-order';
const item: DeliveryOrderItem = {
  id: 1,
  partNumber: '69201-0K040',
  customerPartNumber: '69201-0K040',
  partName: 'FRAME S/A FR DOOR O/S HANDLE RH-640A',
  uom: 'PC',
  qtyPerKanban: 8,
  pickedKanban: 2,
  pickedQty: 16,
};
const doc = { status: 'PICKED', manifestNumber: 'MAN-001', pdsNumber: 'PDS-001', lines: [item] };
describe('Delivery Order after finish pulling', () => {
  it('formats annual running numbers without truncating overflow', () => {
    expect(deliveryOrderNumber(2026, 1)).toBe('SJA/26/000001');
    expect(deliveryOrderNumber(2026, 25276)).toBe('SJA/26/025276');
    expect(deliveryOrderNumber(2027, 1)).toBe('SJA/27/000001');
    expect(deliveryOrderNumber(2026, 1000000)).toBe('SJA/26/1000000');
    expect(() => deliveryOrderNumber(2026, 0)).toThrow();
  });
  it('uses the raw manifest first, preserving leading zeros', () => {
    expect(deliveryOrderQr(' 00001234 ', 'PDS-1')).toEqual({
      value: '00001234',
      source: 'MANIFEST',
    });
  });
  it('falls back to PDS, never an invented delivery or GI number', () => {
    expect(deliveryOrderQr('  ', ' PDS-002 ')).toEqual({ value: 'PDS-002', source: 'PDS' });
    expect(deliveryOrderQr(null, null)).toBeNull();
  });
  it.each(['DRAFT', 'PICKING', 'CANCELLED'])('is not available at status %s', (status) => {
    expect(deliveryOrderPreview({ ...doc, status }).available).toBe(false);
  });
  it.each(['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED'])(
    'keeps available after pulling at status %s',
    (status) => {
      expect(deliveryOrderPreview({ ...doc, status }).available).toBe(true);
    },
  );
  it('prints picked quantities and excludes unpicked items', () => {
    const result = deliveryOrderPreview({
      ...doc,
      lines: [item, { ...item, id: 2, pickedKanban: 0, pickedQty: 0 }],
    });
    expect(result.available && result.pages.flat().map((l) => l.id)).toEqual([1]);
    expect(result.available && result.totalQty).toBe(16);
  });
  it('rejects missing reference and invalid actual quantities', () => {
    expect(deliveryOrderPreview({ ...doc, manifestNumber: null, pdsNumber: null }).available).toBe(
      false,
    );
    for (const bad of [0, -1, NaN, 0.5])
      expect(deliveryOrderPreview({ ...doc, lines: [{ ...item, pickedQty: bad }] }).available).toBe(
        false,
      );
  });
  it('paginates without dropping, duplicating or regrouping SAP item rows', () => {
    const result = deliveryOrderPreview({
      ...doc,
      lines: Array.from({ length: 31 }, (_, i) => ({ ...item, id: i + 1 })),
    });
    expect(result.available && result.pages.map((p) => p.length)).toEqual([15, 15, 1]);
    expect(result.available && result.pages.flat().map((l) => l.id)).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1),
    );
  });
  it('reserves additional page space for long part descriptions', () => {
    const result = deliveryOrderPreview({
      ...doc,
      lines: Array.from({ length: 15 }, (_, i) => ({
        ...item,
        id: i + 1,
        partName: 'X'.repeat(190),
      })),
    });
    expect(result.available && result.pages.length).toBeGreaterThan(1);
  });
});
