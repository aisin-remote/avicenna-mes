import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb, plants, sapOutbox, deliveryOrders, eq, and, type Database } from '@avicenna/db';
import { queueFinishPullingGi } from '../loading/finish-pulling-gi';
import { queueDeliveryStage } from '../loading/delivery-flow';
import { DeliveryGiService } from './delivery-gi.service';
import { FINISH_PULLING_GI, type GoodsMovementUpload } from './delivery-gi-gate';
import type { StagingDbService } from './staging-db.service';

async function main() {
  if (process.env.DELIVERY_GI_CHECK !== 'true')
    throw new Error('Set DELIVERY_GI_CHECK=true untuk fixture lokal.');
  const db = getDb();
  const rollback = new Error('ROLLBACK_GI_CHECK');
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        const [plant] = await tx.select({ id: plants.id }).from(plants).limit(1);
        assert(plant, 'Fixture membutuhkan satu plant lokal');
        const key = randomUUID();
        const [parent] = await tx
          .insert(sapOutbox)
          .values({
            plantId: plant.id,
            sourceTable: 'TT_DELIVERY_ORDER',
            sourceId: -Date.now(),
            docType: 'DELIVERY_GI_AIIA',
            idempotencyKey: `qa-gi:${key}`,
            status: 'HELD',
            occurredAt: new Date(),
            payload: {
              snapshot: {
                lines: [
                  { partNumber: 'QA-PART-A', pickedQty: 20 },
                  { partNumber: 'QA-PART-B', pickedQty: 5 },
                ],
              },
            },
          })
          .returning();
        assert(parent);
        const getJobs = () =>
          tx
            .select()
            .from(sapOutbox)
            .where(
              and(
                eq(sapOutbox.sourceTable, 'TT_SAP_OUTBOX'),
                eq(sapOutbox.sourceId, parent.id),
                eq(sapOutbox.docType, FINISH_PULLING_GI),
              ),
            );
        await queueFinishPullingGi(tx, parent.id);
        await queueFinishPullingGi(tx, parent.id);
        const [job] = await getJobs();
        assert(job);
        assert.equal((await getJobs()).length, 1, 'Event ulang tidak menggandakan antrean GI');

      const eventOrder = {
        id: parent.sourceId - 1,
        snapshot: {
          pdsNumber: 'PDS-QA', deliveryIds: [1], documentNumbers: ['8000000001'],
          lines: [{
            plantId: plant.id, partNumber: 'QA-PART-A', pickedQty: 20, uom: 'PC',
            fgPlantCode: 'BODY', fgLocationCode: 'PP02', fgLocationKind: 'FINISH_GOOD',
            sapDeliveryNumber: '8000000001', sapItemNumber: '000010',
          }],
        },
      } as typeof deliveryOrders.$inferSelect;
      await queueDeliveryStage(tx, eventOrder, 'DELIVERY_GI_AIIA', new Date());
      await queueDeliveryStage(tx, eventOrder, 'DELIVERY_GI_AIIA', new Date());
      const [eventRequest] = await tx.select().from(sapOutbox).where(eq(
        sapOutbox.idempotencyKey, `delivery-order:${eventOrder.id}:DELIVERY_GI_AIIA`,
      ));
      assert(eventRequest);
      assert.equal(eventRequest.status, 'PENDING', 'Finish Pulling lengkap mengantrekan Goods Movement');
      assert.equal(eventRequest.movementType, '601');
      const eventGi = await tx.select().from(sapOutbox).where(and(
        eq(sapOutbox.sourceTable, 'TT_SAP_OUTBOX'), eq(sapOutbox.sourceId, eventRequest.id),
      ));
      assert.equal(eventGi.length, 1, 'Event Finish Pulling membuat satu antrean GI di transaksi yang sama');

        let queryCount = 0;
        let fail = false;
        let configured = true;
        let rows: GoodsMovementUpload[] = [
          {
            number: 701,
            itemNumber: 9001,
            typeTrans: 'NODL',
            validate: 'X',
            upload: '0',
            partNumber: 'QA-PART-A',
            qty: 20,
          },
          {
            number: 701,
            itemNumber: 9002,
            typeTrans: 'NODL',
            validate: 'X',
            upload: '0',
            partNumber: 'QA-PART-B',
            qty: 5,
          },
        ];
        const staging = {
          get terkonfigurasi() {
            return configured;
          },
          async query(query: string, params: Record<string, unknown>) {
            queryCount++;
            assert.match(query, /^SELECT /);
            assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE)\b/i);
            assert.match(query, /WHERE H.INT_NUMBER = @number/);
            assert.deepEqual(
              params,
              { number: 701 },
              'Menggunakan INT_NUMBER staging, bukan ID outbox',
            );
            if (fail) throw new Error('SQL Server offline (fixture)');
            return rows;
          },
        } as unknown as StagingDbService;
        const service = new DeliveryGiService(tx as unknown as Database, staging);
        assert.equal(await service.checkRequest(job.id), false);
        assert.equal(queryCount, 0, 'Request HELD belum boleh mengecek nomor staging tebakan');
        await tx
          .update(sapOutbox)
          .set({ status: 'SENT', stagingNumber: 701 })
          .where(eq(sapOutbox.id, parent.id));
        assert.equal(await service.checkRequest(job.id), false);
        rows[0]!.upload = 'X';
        assert.equal(await service.checkRequest(job.id), false, 'Satu item X belum cukup');
        const complete = rows.map((row) => ({ ...row, upload: 'X' }));
        rows = complete.slice(0, 1);
        assert.equal(await service.checkRequest(job.id), false, 'Baris hilang menahan GI');
        rows = complete;
        assert.equal(await service.checkRequest(job.id), true);
        assert.equal(await service.checkRequest(job.id), true);
        let [ready] = await getJobs();
        assert.equal((await getJobs()).length, 1, 'Polling ulang tidak menggandakan GI');
        assert.equal((ready!.payload as { state: string }).state, 'WAITING_GI_TABLE');
        assert.equal(ready!.status, 'HELD', 'Tanpa tabel GI, tidak boleh mengaku SENT');
        assert.equal(ready!.sapDocNumber, null);
        assert.equal(ready!.confirmedAt, null);
        const [stillSent] = await tx.select().from(sapOutbox).where(eq(sapOutbox.id, parent.id));
        assert.equal(stillSent!.status, 'SENT', 'Upload X tidak mengonfirmasi GI/GR');

        rows[1]!.upload = '0';
        assert.equal(
          await service.checkRequest(job.id),
          false,
          'Kondisi staging dibaca ulang, bukan readiness lama',
        );
        fail = true;
        assert.equal(await service.checkRequest(job.id), false);
        [ready] = await getJobs();
        assert.match(ready!.lastError!, /SQL Server offline/);
        fail = false;
        rows = complete.map((row) => ({ ...row, upload: 'X' }));
        assert.equal(
          await service.checkRequest(job.id),
          true,
          'Pulih setelah gangguan tanpa enqueue ulang',
        );
        configured = false;
        assert.equal(await service.checkRequest(job.id), false);
        configured = true;
        await tx.update(sapOutbox).set({ isSimulation: true }).where(eq(sapOutbox.id, parent.id));
        const beforeSimulation = queryCount;
        assert.equal(await service.checkRequest(job.id), false);
        assert.equal(queryCount, beforeSimulation, 'Simulasi tidak membaca staging nyata');

        for (const type of ['DELIVERY_GI_AII', 'DELIVERY_GR_AII']) {
          const [other] = await tx
            .insert(sapOutbox)
            .values({
              plantId: plant.id,
              sourceTable: 'TT_DELIVERY_ORDER',
              sourceId: parent.sourceId,
              docType: type,
              idempotencyKey: `qa-gi:${key}:${type}`,
              status: 'HELD',
              occurredAt: new Date(),
              payload: {},
            })
            .returning();
          assert(other);
          await queueFinishPullingGi(tx, other.id);
          const jobs = await tx
            .select()
            .from(sapOutbox)
            .where(
              and(eq(sapOutbox.sourceTable, 'TT_SAP_OUTBOX'), eq(sapOutbox.sourceId, other.id)),
            );
          assert.equal(jobs.length, 0, `${type} tidak membuat antrean Finish Pulling`);
        }
        console.log(
          'Finish Pulling GI PG checks passed: duplicate events, all-items X, missing rows, reconnect, simulation, pickup exclusion; SAP mocked and local fixture rolled back.',
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  } finally {
    await closeDb();
  }
}
void main();
