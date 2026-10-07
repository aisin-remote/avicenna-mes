import assert from 'node:assert/strict';
import { bersih, tanggalIsoAtauNull, jamIsoAtauNull } from './staging-tables';

assert.equal(bersih('  J901   '), 'J901');
for (const value of [null, undefined, 'NULL', ' null ', '']) assert.equal(bersih(value), null);
assert.equal(tanggalIsoAtauNull('20260930  '), '2026-09-30');
assert.equal(tanggalIsoAtauNull('2024-02-29'), '2024-02-29');
for (const value of ['20260229', '20260931', '00000000', 'NULL', '20261301'])
  assert.equal(tanggalIsoAtauNull(value), null);
assert.equal(jamIsoAtauNull('060000 '), '06:00:00');
assert.equal(jamIsoAtauNull('000000'), '00:00:00');
assert.equal(jamIsoAtauNull('23:59:59'), '23:59:59');
for (const value of ['240000', '056099', 'NULL', '', '0600'])
  assert.equal(jamIsoAtauNull(value), null);
console.log('SAP normalization checks passed');
