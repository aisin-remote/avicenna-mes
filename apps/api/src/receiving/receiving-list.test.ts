import 'reflect-metadata';
import assert from 'node:assert/strict';
import { drizzle, type NodePgClient } from 'drizzle-orm/node-postgres';
import type { Database } from '@avicenna/db';
import { ReceivingService } from './receiving.service';

async function main() {
  let hasReceipt = false;
  const client = {
    async query(query: { text: string }) {
      if (query.text.startsWith('select count(*)')) {
        return { rows: [[hasReceipt ? '1' : '0']] };
      }

      assert.match(query.text, /s\."CHR_META"\s*->>\s*'result'/);
      assert.doesNotMatch(query.text, /JSON_UNQUOTE|JSON_EXTRACT/);
      return {
        rows: hasReceipt
          ? [
              [
                1,
                'RCV-TEST',
                null,
                'Supplier',
                '2026-10-23T01:00:00Z',
                'DRAFT',
                null,
                null,
                '2',
                '1',
                '24',
              ],
            ]
          : [],
      };
    },
  };
  const db = drizzle(client as unknown as NodePgClient) as unknown as Database;
  const service = new ReceivingService(db);
  const params = { page: 1, perPage: 25 };

  const empty = await service.list(params);
  assert.deepEqual(empty.data, []);
  assert.equal(empty.meta.total, 0);

  hasReceipt = true;
  const result = await service.list(params);
  assert.equal(result.meta.total, 1);
  assert.equal(result.data[0]?.boxScanned, 2, 'Postgres COUNT must remain a number');
  assert.equal(result.data[0]?.lineCount, 1);
  assert.equal(result.data[0]?.totalQty, '24');
  console.log('Receiving PostgreSQL list checks passed');
}

void main();
