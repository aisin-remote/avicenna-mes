import { describe, expect, it } from 'vitest';
import type { PreparationDocument, PreparationSchedule } from '@avicenna/contracts';
import {
  activePreparationScans,
  groupPreparationDocuments,
  normalizeDeliveryCycle,
  preparationClock,
  preparationStatus,
  preparationWindow,
} from './preparation';

const schedule: PreparationSchedule = {
  id: 1,
  customerId: 1,
  customerName: 'Customer',
  destination: '',
  gate: '',
  cycle: 1,
  preparationStart: '22:00:00',
  preparationEnd: '02:00:00',
  dayOffset: -1,
  truckTime: '03:00:00',
  sapPickTime: null,
  sapLoadingTime: null,
  sapDeliveryTime: null,
  syncedAt: null,
  isActive: true,
};
const document: PreparationDocument = {
  id: 1,
  plantId: 1,
  plantCode: 'BODY',
  customerId: 1,
  customerName: 'Customer',
  customerCode: 'C1',
  documentNumber: 'LL1',
  manifestNumber: 'M1',
  pdsNumber: 'PDS1',
  deliveryDate: '2026-10-23',
  cycle: 1,
  destination: 'D1',
  status: 'PICKING',
  truckStatus: 'PENDING',
  truckPickedAt: null,
  lineCount: 1,
  plannedKanban: 10,
  pickedKanban: 5,
  missingKanban: 5,
  invalidLines: 0,
  loadedKanban: 0,
  plannedQty: 100,
  pickedQty: 50,
  latestPullingAt: '2026-10-22T18:00:00.000Z',
};

describe('preparation', () => {
  it.each([
    ['1-', 1],
    ['10-', 10],
    [' 01 ', 1],
    ['Cycle 2', 2],
    ['', null],
    ['2A', null],
    ['0', null],
  ])('normalizes SAP cycle %s', (v, expected) => {
    expect(normalizeDeliveryCycle(v)).toBe(expected);
  });
  it.each([
    ['063000', '06:30:00'],
    ['06:30', '06:30:00'],
    ['06:30:59', '06:30:59'],
    ['', null],
    ['25:00', null],
    ['066100', null],
  ])('validates SAP clock %s', (v, expected) => {
    expect(preparationClock(v)).toBe(expected);
  });
  it('anchors H-1 and midnight crossing to Jakarta, independently of server timezone', () => {
    expect(preparationWindow('2026-10-23', schedule)).toEqual({
      preparationStartAt: '2026-10-22T15:00:00.000Z',
      deadlineAt: '2026-10-22T19:00:00.000Z',
      truckEtaAt: '2026-10-22T20:00:00.000Z',
    });
  });
  it('does not invent a deadline from empty clocks', () => {
    expect(preparationWindow('2026-10-23', null).deadlineAt).toBeNull();
  });
  it('places a morning truck after an overnight preparation window on H+1', () => {
    expect(preparationWindow('2026-10-23', { ...schedule, dayOffset: 0 }).truckEtaAt).toBe(
      '2026-10-23T20:00:00.000Z',
    );
  });
  it('does not call zero-target or untraceable completion on-time', () => {
    const now = new Date('2026-10-23T01:00:00Z');
    expect(preparationStatus(0, 0, null, null, now)).toBe('NO_PLAN');
    expect(preparationStatus(10, 10, null, null, now)).toBe('COMPLETE_UNTIMED');
    expect(preparationStatus(10, 5, null, null, now)).toBe('UNCONFIGURED');
    expect(preparationStatus(10, 5, '2026-10-23T00:00:00Z', null, now)).toBe('OVERDUE');
    expect(preparationStatus(10, 10, '2026-10-23T00:00:00Z', '2026-10-23T00:01:00Z', now)).toBe(
      'COMPLETE_LATE',
    );
  });
  it('keeps customer, plant, destination, date and cycle separate even when PDS is reused', () => {
    const docs = [
      document,
      { ...document, id: 2, plantId: 2 },
      { ...document, id: 3, customerId: 2 },
      { ...document, id: 4, cycle: 2 },
      { ...document, id: 5, deliveryDate: '2026-10-24' },
      { ...document, id: 6, destination: 'D2' },
    ];
    expect(groupPreparationDocuments(docs, [schedule], 'PDS')).toHaveLength(6);
  });
  it('uses a per-document fallback when PDS is absent and excludes cancellation', () => {
    expect(
      groupPreparationDocuments(
        [
          { ...document, pdsNumber: null },
          { ...document, id: 2, documentNumber: 'LL2', pdsNumber: null },
          { ...document, id: 3, status: 'CANCELLED' },
        ],
        [],
        'PDS',
      ),
    ).toHaveLength(2);
  });
  it('does not pick an arbitrary gate schedule', () => {
    const rows = groupPreparationDocuments(
      [document],
      [
        { ...schedule, gate: 'A' },
        { ...schedule, id: 2, gate: 'B' },
      ],
      'PDS',
    );
    expect(rows[0]?.deadlineAt).toBeNull();
    expect(rows[0]?.scheduleIssue).toContain('gate');
  });
  it('uses explicit PPIC defaults instead of an unconfigured SAP destination clock', () => {
    const rawSap = {
      ...schedule,
      id: 2,
      destination: 'D1',
      gate: 'A',
      preparationStart: null,
      preparationEnd: null,
      sapPickTime: '06:00:00',
    };
    expect(groupPreparationDocuments([document], [rawSap, schedule], 'PDS')[0]!.deadlineAt).toBe(
      '2026-10-22T19:00:00.000Z',
    );
  });
  it('does not claim on-time completion when one document has no scan timestamp', () => {
    const complete = { ...document, pickedKanban: 10, missingKanban: 0 };
    const group = groupPreparationDocuments(
      [complete, { ...complete, id: 2, latestPullingAt: null }],
      [schedule],
      'CYCLE',
    )[0]!;
    expect(group.completed).toBe(true);
    expect(group.status).toBe('COMPLETE_UNTIMED');
  });
  it('undo removes only the matching item and phase', () => {
    const events = [
      { id: 1, lineId: 1, phase: 'PULLING', action: null },
      { id: 2, lineId: 2, phase: 'PULLING', action: null },
      { id: 3, lineId: 1, phase: 'LOADING', action: null },
      { id: 4, lineId: 1, phase: 'PULLING', action: 'UNDO' },
      { id: 5, lineId: 2, phase: 'PULLING', action: 'REJECTED' },
    ];
    expect(activePreparationScans(events).map((e) => e.id)).toEqual([2, 3]);
    expect(events).toHaveLength(5);
  });
  it('does not hide an item shortage behind another over-scanned document', () => {
    const group = groupPreparationDocuments(
      [document, { ...document, id: 2, pickedKanban: 15, missingKanban: 0 }],
      [],
      'CYCLE',
    )[0]!;
    expect(group.progress).toBe(75);
    expect(group.completed).toBe(false);
    expect(group.status).toBe('UNCONFIGURED');
  });
});
