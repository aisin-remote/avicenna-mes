import assert from 'node:assert/strict';
import type { DeliveryOrderSnapshot } from '@avicenna/contracts';
import type { sapOutbox } from '@avicenna/db';
import type { StagingDbService } from './staging-db.service';
import { finishPullingMovement, storeFinishPullingMovement } from './finish-pulling-goods-movement';

const snapshot: DeliveryOrderSnapshot = {
  pdsNumber: 'PDS-001',
  deliveryIds: [1],
  documentNumbers: ['8000000001'],
  qr: { value: 'PDS-001', source: 'PDS' },
  customerCode: 'C1',
  customerName: 'Fixture',
  deliveryDates: [],
  deliveryLocations: [],
  purchaseOrderNumbers: [],
  planTimes: [],
  lines: [1, 2].map((id) => ({
    id,
    deliveryId: 1,
    partNumber: 'PART-A',
    customerPartNumber: null,
    partName: null,
    uom: 'PC',
    pickedQty: 20,
    pickedKanban: 1,
    qtyPerKanban: 20,
    plantId: 1,
    fgPlantCode: 'BODY',
    fgLocationKind: 'FINISH_GOOD',
    fgLocationCode: 'PP02',
    sapDeliveryNumber: '8000000001',
    sapItemNumber: String(id * 10).padStart(6, '0'),
  })),
};
assert.equal(finishPullingMovement(snapshot).plant, '700');
for (const [code, sap] of [
  ['UNIT', '800'],
  ['ELC', '900'],
])
  assert.equal(
    finishPullingMovement({
      ...snapshot,
      lines: snapshot.lines.map((l) => ({ ...l, fgPlantCode: code })),
    }).plant,
    sap,
  );
for (const change of [
  { pickedQty: 1.5 },
  { pickedQty: 0 },
  { pickedQty: 2147483648 },
  { sapItemNumber: null },
  { sapDeliveryNumber: 'INVALID-OVER-WIDTH' },
  { fgPlantCode: 'UNKNOWN' },
  { fgLocationKind: 'STAGING' },
  { fgLocationCode: null },
  { partNumber: null },
])
  assert.throws(() =>
    finishPullingMovement({ ...snapshot, lines: [{ ...snapshot.lines[0]!, ...change }] }),
  );
assert.throws(
  () => finishPullingMovement({ ...snapshot, lines: [snapshot.lines[0]!, snapshot.lines[0]!] }),
  /duplikat/,
);
assert.throws(
  () =>
    finishPullingMovement({
      ...snapshot,
      lines: [snapshot.lines[0]!, { ...snapshot.lines[1]!, fgPlantCode: 'UNIT' }],
    }),
  /lintas plant/,
);

async function main() {
  const row = {
    id: 10,
    sourceId: 1,
    sourceTable: 'TT_DELIVERY_ORDER',
    docType: 'DELIVERY_GI_AIIA',
    isSimulation: false,
    stagingNumber: null,
    occurredAt: new Date('2026-11-16T08:00:00+07:00'),
    payload: { snapshot },
  } as typeof sapOutbox.$inferSelect;
  let header: Record<string, unknown> | undefined;
  let items: Record<string, unknown>[] = [];
  let insertCount = 0;
  let failSecond = false;
  const adapter = {
    async transaksi<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
      const before = structuredClone({ header, items });
      let locked = false;
      try {
        return await run({
          request() {
            const params: Record<string, unknown> = {};
            return {
              input(name: string, value: unknown) {
                params[name] = value;
                return this;
              },
              async query(command: string) {
                if (command.includes('sp_getapplock')) {
                  assert.match(command, /@LockOwner='Transaction'/);
                  assert.match(command, /@LockMode='Exclusive'/);
                  locked = true;
                  return { recordset: [{ result: 0 }] };
                }
                assert(locked, 'Retry check dan insert wajib memegang lock SQL');
                if (command.startsWith('SELECT INT_NUMBER AS number')) {
                  assert.equal(params.reference, 'AVI-FP-10');
                  return { recordset: header ? [header] : [] };
                }
                if (command.startsWith('SELECT INT_NUMBER_ITEM')) return { recordset: items };
                if (
                  command.includes('INSERT INTO') &&
                  command.includes('OUTPUT INSERTED.INT_NUMBER AS number')
                ) {
                  assert.match(command, /'601', 'NODL', 'X'/);
                  assert.equal(params.plant, '700');
                  assert.equal(params.date, '20261116');
                  header = {
                    number: 701,
                    plant: params.plant,
                    typeTrans: 'NODL',
                    movementType: '601',
                  };
                  insertCount++;
                  return { recordset: [{ number: 701 }] };
                }
                assert.match(command, /OUTPUT INSERTED.INT_NUMBER_ITEM/);
                assert.match(command, /@sloc, NULL, @delivery, @item, @pds/);
                assert.match(command, /'601', '0', 'N', 'N'/);
                assert.equal(params.number, 701);
                assert.equal(params.sloc, 'PP02');
                if (failSecond && items.length === 1) throw new Error('fixture insert item failed');
                const id = 9001 + items.length;
                items.push({
                  id,
                  part: params.part,
                  qty: params.qty,
                  sloc: params.sloc,
                  delivery: params.delivery,
                  item: params.item,
                  pds: params.pds,
                  uom: params.uom,
                });
                insertCount++;
                return { recordset: [{ id }] };
              },
            };
          },
        });
      } catch (error) {
        header = before.header;
        items = before.items;
        throw error;
      }
    },
  } as unknown as Pick<StagingDbService, 'transaksi'>;
  failSecond = true;
  await assert.rejects(storeFinishPullingMovement(adapter, row), /fixture insert item failed/);
  assert.equal(header, undefined, 'Header dan item gagal harus rollback bersama');
  assert.equal(items.length, 0);
  failSecond = false;
  const receipt = await storeFinishPullingMovement(adapter, row);
  assert.deepEqual(receipt, { number: 701, itemNumbers: [9001, 9002] });
  const beforeRetry = insertCount;
  assert.deepEqual(
    await storeFinishPullingMovement(adapter, row),
    receipt,
    'Retry setelah commit remote memakai nomor yang sama',
  );
  assert.equal(insertCount, beforeRetry, 'Retry tidak INSERT lagi atau mereset CHR_UPLOAD');
  await assert.rejects(
    storeFinishPullingMovement(adapter, { ...row, isSimulation: true }),
    /nyata/,
  );
  await assert.rejects(
    storeFinishPullingMovement(adapter, { ...row, docType: 'DELIVERY_GI_AII' }),
    /Finish Pulling/,
  );
  items[0]!.qty = 19;
  await assert.rejects(storeFinishPullingMovement(adapter, row), /tidak cocok/);
  assert.equal(insertCount, beforeRetry, 'Ketidakcocokan tidak boleh memicu posting baru');
  console.log('Finish Pulling Goods Movement writer checks passed (SQL adapter mocked)');
}
void main();
