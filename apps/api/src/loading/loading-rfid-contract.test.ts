import assert from 'node:assert/strict';
import { loadingRfidBatchSchema } from '@avicenna/contracts';

const tag = { tagId: ' ePc-AbC-001 ', customerPart: ' PART-001 ', serialNumber: ' SERIAL-001 ' };
const valid = loadingRfidBatchSchema.parse({ deliveryId: 64, tags: [tag] });
assert.deepEqual(valid.tags[0], {
  tagId: 'ePc-AbC-001',
  customerPart: 'PART-001',
  serialNumber: 'SERIAL-001',
});
assert(
  loadingRfidBatchSchema.safeParse({
    deliveryId: 64,
    tags: [{ tagId: 'epc', customerPart: 'part' }],
  }).success,
);
assert(loadingRfidBatchSchema.safeParse({ deliveryId: 64, tags: [tag, tag] }).success);
assert(loadingRfidBatchSchema.safeParse({ deliveryId: 64, tags: Array(200).fill(tag) }).success);
for (const input of [
  { deliveryId: '64', tags: [tag] },
  { deliveryId: 0, tags: [tag] },
  { deliveryId: 64, tags: [] },
  { deliveryId: 64, tags: Array(201).fill(tag) },
  { deliveryId: 64, tags: [{ ...tag, tagId: '  ' }] },
  { deliveryId: 64, tags: [{ ...tag, tagId: 'x'.repeat(129) }] },
  { deliveryId: 64, tags: [{ ...tag, customerPart: '  ' }] },
  { deliveryId: 64, tags: [{ ...tag, customerPart: 'x'.repeat(256) }] },
  { deliveryId: 64, tags: [{ ...tag, serialNumber: '' }] },
  { deliveryId: 64, tags: [{ ...tag, serialNumber: 'x'.repeat(65) }] },
  { deliveryId: 64, tags: [tag], qty: 20 },
  { deliveryId: 64, tags: [tag], phase: 'PULLING' },
  { deliveryId: 64, tags: [tag], internalKanban: 'BACK|SERIAL' },
  { deliveryId: 64, tags: [tag], bypass: true },
  { deliveryId: 64, tags: [{ ...tag, qty: 20 }] },
  { deliveryId: 64, tags: [{ ...tag, internalKanban: 'BACK|SERIAL' }] },
  { deliveryId: 64, tags: [{ ...tag, bypass: true }] },
]) {
  assert.equal(loadingRfidBatchSchema.safeParse(input).success, false, JSON.stringify(input));
}
console.log(
  'RFID batch contract checks passed: bounds, required fields, strict payload, stable case-sensitive tag IDs.',
);
