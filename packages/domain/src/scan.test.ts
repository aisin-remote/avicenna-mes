import { describe, it, expect } from 'vitest';
import { buildDedupeKey, normalizeScan } from './scan';

describe('buildDedupeKey', () => {
  it('menghasilkan kunci sama untuk clientRef sama — kiriman ulang tertangkap', () => {
    const base = { kind: 'PRODUCTION', rawCode: 'ABC', clientRef: 'uuid-1', scannedAt: new Date() };
    const a = buildDedupeKey(base);
    const b = buildDedupeKey({ ...base, scannedAt: new Date(Date.now() + 60_000) });
    // Waktu berbeda pun tetap dianggap scan yang sama selama clientRef-nya sama.
    expect(a).toBe(b);
  });

  it('membedakan clientRef yang berbeda', () => {
    const at = new Date();
    expect(buildDedupeKey({ kind: 'PRODUCTION', rawCode: 'ABC', clientRef: 'a', scannedAt: at })).not.toBe(
      buildDedupeKey({ kind: 'PRODUCTION', rawCode: 'ABC', clientRef: 'b', scannedAt: at }),
    );
  });

  it('tanpa clientRef, scan identik dalam detik yang sama dianggap dobel', () => {
    const at = new Date('2026-09-10T08:00:00.100Z');
    const at2 = new Date('2026-09-10T08:00:00.900Z');
    const k1 = buildDedupeKey({ kind: 'PRODUCTION', rawCode: 'ABC', lineCode: 'DC-01', scannedAt: at });
    const k2 = buildDedupeKey({ kind: 'PRODUCTION', rawCode: 'ABC', lineCode: 'DC-01', scannedAt: at2 });
    expect(k1).toBe(k2);
  });

  it('scan sah di detik berbeda tidak dianggap dobel', () => {
    const k1 = buildDedupeKey({
      kind: 'PRODUCTION',
      rawCode: 'ABC',
      scannedAt: new Date('2026-09-10T08:00:00Z'),
    });
    const k2 = buildDedupeKey({
      kind: 'PRODUCTION',
      rawCode: 'ABC',
      scannedAt: new Date('2026-09-10T08:00:05Z'),
    });
    expect(k1).not.toBe(k2);
  });

  it('scan di line berbeda tidak saling menutupi', () => {
    const at = new Date('2026-09-10T08:00:00Z');
    expect(buildDedupeKey({ kind: 'PRODUCTION', rawCode: 'ABC', lineCode: 'DC-01', scannedAt: at })).not.toBe(
      buildDedupeKey({ kind: 'PRODUCTION', rawCode: 'ABC', lineCode: 'MC-01', scannedAt: at }),
    );
  });
});

describe('normalizeScan', () => {
  it('mengisi waktu dan qty default, lalu menghitung dedupeKey', () => {
    const now = new Date('2026-09-10T08:00:00Z');
    const result = normalizeScan(
      { kind: 'PRODUCTION', rawCode: 'ABC', qty: 1, clientRef: 'uuid-9' },
      now,
    );
    expect(result.scannedAt).toEqual(now);
    expect(result.qty).toBe(1);
    expect(result.dedupeKey).toHaveLength(64);
  });
});
