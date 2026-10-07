import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { LoadingController } from './loading.controller';
import type { LoadingService } from './loading.service';

async function main() {
  const sync = {
    syncedAt: new Date('2026-09-30T00:00:00Z'),
    result: { dibaca: 2, baru: 1, diperbarui: 1, dilewati: 0, catatan: [] },
  };
  let current: typeof sync | null = null;
  const controller = new LoadingController({
    async syncStatus(date: string) {
      assert.equal(date, '2026-09-30');
      return current;
    },
  } as LoadingService);

  // Nest mengirim body kosong untuk null di level teratas, jadi perlu pembungkus objek.
  assert.deepEqual(await controller.syncStatus('2026-09-30'), { data: null });
  current = sync;
  assert.deepEqual(await controller.syncStatus('2026-09-30'), { data: sync });
  await assert.rejects(controller.syncStatus(), BadRequestException);
  await assert.rejects(controller.syncStatus('30/09/2026'), BadRequestException);
  console.log('Delivery sync-status checks passed');
}

void main();
