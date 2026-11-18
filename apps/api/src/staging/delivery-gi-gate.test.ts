import assert from 'node:assert/strict';
import { checkGoodsMovementUpload, type GoodsMovementUpload } from './delivery-gi-gate';

const expected = [
  { partNumber: 'PART-A', pickedQty: 20 },
  { partNumber: 'PART-B', pickedQty: 5 },
];
const rows: GoodsMovementUpload[] = expected.map((item, i) => ({
  number: 701,
  itemNumber: 9001 + i,
  typeTrans: 'NODL',
  validate: 'X',
  upload: 'X',
  partNumber: item.partNumber,
  qty: item.pickedQty,
}));
const check = (input: GoodsMovementUpload[]) =>
  checkGoodsMovementUpload(701, expected, input).ready;
assert.equal(check(rows), true);
assert.equal(check(rows.toReversed()), true, 'Urutan query tidak menentukan kelengkapan');
assert.equal(
  check(
    rows.map((row) => ({
      ...row,
      upload: 'X ',
      typeTrans: 'NODL ',
      validate: 'X ',
      partNumber: row.partNumber + ' ',
    })),
  ),
  true,
);
for (const upload of ['0', '', ' ', 'x', '1', null]) {
  assert.equal(
    check([{ ...rows[0]!, upload }, rows[1]!]),
    false,
    `Satu item ${upload} harus menahan GI`,
  );
}
assert.equal(check([]), false, 'Tidak ada item bukan berarti seluruh item sudah X');
assert.equal(check(rows.slice(0, 1)), false, 'Item hilang');
assert.equal(check([...rows, { ...rows[0]!, itemNumber: 9003 }]), false, 'Item tambahan');
for (const change of [
  { number: 702 },
  { itemNumber: null },
  { itemNumber: 9002 },
  { typeTrans: 'NOFG' },
  { validate: '' },
  { qty: 19 },
  { partNumber: 'OTHER' },
])
  assert.equal(check([{ ...rows[0]!, ...change }, rows[1]!]), false);
assert.equal(checkGoodsMovementUpload(0, expected, rows).ready, false);
assert.equal(checkGoodsMovementUpload(701, [], []).ready, false);
assert.equal(
  checkGoodsMovementUpload(701, [{ partNumber: null, pickedQty: 20 }], [rows[0]!]).ready,
  false,
);
console.log('Finish Pulling GI gate checks passed');
