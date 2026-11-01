import 'reflect-metadata';
import assert from 'node:assert/strict';
import { drizzle, type NodePgClient } from 'drizzle-orm/node-postgres';
import type { Database } from '@avicenna/db';
import { LoadingService } from './loading.service';
import {loadingScanSchema} from '@avicenna/contracts';

async function main() {
  assert.equal(loadingScanSchema.parse({deliveryId:1,customerPart:'CUSTOMER-KANBAN'}).phase,'PULLING');
  const client = {
    async query(query: { text: string }, values: unknown[]) {
      assert.match(query.text, /"CHR_PDS_NO" = \$/);
      assert.deepEqual(values.slice(0, 3), ['PDS-00001', 'PDS-00001', 'PDS-00001']);
      return {
        rows: [
          [11, 'DN-001', null, 'Customer', '2026-10-27', 1, 'PICKED'],
          [12, 'DN-002', null, 'Customer', '2026-10-27', 1, 'PICKED'],
        ],
      };
    },
  };
  const service = new LoadingService(
    drizzle(client as unknown as NodePgClient) as unknown as Database,
  );
  const result = await service.resolveDocument(' PDS-00001 ');
  assert.equal(
    result.matches.length,
    2,
    'PDS bersama tidak boleh memilih loading list secara acak',
  );
  console.log('Delivery Order PDS resolver checks passed');
}
void main();
