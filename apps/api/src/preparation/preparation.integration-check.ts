import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  closeDb,
  customers,
  deliveries,
  deliveryLines,
  eq,
  getDb,
  parts,
  plants,
  preparationSchedules,
  scanEvents,
  type Database,
} from '@avicenna/db';
import { PreparationService } from './preparation.service';
import { StagingPullService } from '../staging/staging-pull.service';
import type { StagingDbService } from '../staging/staging-db.service';
import type { Principal } from '../auth/auth.types';
import { preparationFilterSchema, preparationScheduleSchema } from '@avicenna/contracts';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert(
    ['127.0.0.1', 'localhost'].includes(url.hostname),
    'Integration check only runs on a local database',
  );
  const db = getDb(),
    tag = `PREP-QA-${randomUUID().slice(0, 8)}`,
    rollback = new Error('rollback QA');
  const admin: Principal = {
    kind: 'user',
    sub: 1,
    npk: 'QA',
    name: 'QA',
    role: null,
    roleKind: 'ADMIN',
    roleProcessGroup: null,
    plantId: null,
  };
  const queries: string[] = [];
  let duplicateSchedule = false;
  try {
    await db.transaction(async (tx) => {
      const database = tx as unknown as Database;
      const [plant] = await tx.insert(plants).values({ code: tag, name: tag }).returning();
      const [otherPlant] = await tx
        .insert(plants)
        .values({ code: `${tag}-2`, name: tag })
        .returning();
      const [customer] = await tx.insert(customers).values({ code: tag, name: tag }).returning();
      const [part] = await tx
        .insert(parts)
        .values({
          plantId: plant!.id,
          partNumber: tag,
          name: tag,
          processType: 'ASSEMBLING_UNIT_FG',
        })
        .returning();
      const [doc] = await tx
        .insert(deliveries)
        .values({
          plantId: plant!.id,
          customerId: customer!.id,
          documentNumber: tag,
          pdsNumber: 'PDS-SAME',
          deliveryDate: '2026-10-27',
          cycle: 10,
          dock: 'D1',
        })
        .returning();
      const [other] = await tx
        .insert(deliveries)
        .values({
          plantId: otherPlant!.id,
          customerId: customer!.id,
          documentNumber: `${tag}-2`,
          pdsNumber: 'PDS-SAME',
          deliveryDate: '2026-10-27',
          cycle: 10,
          dock: 'D1',
        })
        .returning();
      const [first, second] = await tx
        .insert(deliveryLines)
        .values([
          {
            deliveryId: doc!.id,
            partId: part!.id,
            sapItemNumber: '10',
            plannedKanban: 2,
            pickedKanban: 3,
            qtyPerKanban: 10,
            plannedQty: 20,
            pickedQty: 30,
          },
          {
            deliveryId: doc!.id,
            partId: part!.id,
            sapItemNumber: '20',
            plannedKanban: 2,
            pickedKanban: 1,
            qtyPerKanban: 10,
            plannedQty: 20,
            pickedQty: 10,
          },
        ])
        .returning();
      const staging = {
        terkonfigurasi: true,
        tarikAktif: false,
        query: async (query: string) => {
          assert.match(query.trim(), /^SELECT\b/i);
          assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
          queries.push(query);
          const row = {
            customerCode: `${tag} `,
            destination: 'D1 ',
            gate: '',
            cycle: '10- ',
            pickTime: duplicateSchedule ? '070000' : '060000',
            loadingTime: '',
            deliveryTime: '',
          };
          return duplicateSchedule ? [row, { ...row, cycle: '010' }] : [row];
        },
      } as unknown as StagingDbService;
      const pull = new StagingPullService(database, staging);
      const service = new PreparationService(database, staging, pull);
      const input = preparationScheduleSchema.parse({
        customerId: customer!.id,
        destination: 'D1',
        cycle: 10,
        preparationStart: '22:00',
        preparationEnd: '02:00',
        dayOffset: -1,
        truckTime: '03:00',
      });
      const saved = await service.saveSchedule(null, input, admin);
      const pulled = await pull.tarikJadwalPreparation();
      assert.equal(pulled.diperbarui, 1);
      const [schedule] = await tx
        .select()
        .from(preparationSchedules)
        .where(eq(preparationSchedules.id, saved.id));
      assert.equal(schedule!.preparationStart, '22:00:00', 'SAP must not overwrite PPIC clocks');
      assert.equal(schedule!.sapPickTime, '06:00:00');
      duplicateSchedule = true;
      assert.equal(
        (await pull.tarikJadwalPreparation()).dilewati,
        2,
        'normalized key collisions must not pick an arbitrary row',
      );
      assert.equal(
        (
          await tx.select().from(preparationSchedules).where(eq(preparationSchedules.id, saved.id))
        )[0]!.sapPickTime,
        '06:00:00',
      );
      const scan = async (
        lineId: number,
        serial: string,
        at: string,
        action: string | null = null,
      ) => {
        await tx
          .insert(scanEvents)
          .values({
            plantId: plant!.id,
            partId: part!.id,
            kind: 'DELIVERY',
            serialNumber: serial,
            rawCode: serial,
            qty: action === 'UNDO' ? -10 : 10,
            scannedAt: new Date(at),
            dedupeKey: randomUUID(),
            meta: {
              deliveryId: doc!.id,
              deliveryLineId: lineId,
              phase: 'PULLING',
              internalSerial: serial,
              customerSerial: `C-${serial}`,
              ...(action ? { action } : {}),
            },
          });
      };
      for (const serial of ['S1', 'S2', 'S3'])
        await scan(first!.id, serial, '2026-10-26T17:00:00Z');
      await scan(second!.id, 'S4', '2026-10-26T17:01:00Z');
      await scan(first!.id, 'UNDONE', '2026-10-27T01:00:00Z');
      await scan(first!.id, 'UNDONE', '2026-10-27T01:01:00Z', 'UNDO');
      for (const at of ['2026-10-26T16:00:00Z', '2026-10-27T03:00:00Z']) {
        await tx
          .insert(scanEvents)
          .values({
            plantId: plant!.id,
            partId: part!.id,
            kind: 'PRODUCTION',
            serialNumber: 'S1',
            rawCode: 'S1',
            qty: 10,
            scannedAt: new Date(at),
            dedupeKey: randomUUID(),
          });
      }
      const filters = preparationFilterSchema.parse({
        from: '2026-10-27',
        to: '2026-10-27',
        customerId: customer!.id,
      });
      const snapshot = await service.snapshot(filters, admin);
      assert.equal(
        snapshot.cycleGroups.length,
        2,
        'same PDS in different plants must remain separate',
      );
      const group = snapshot.cycleGroups.find((g) => g.plantId === plant!.id)!;
      assert.equal(group.progress, 75, 'overscan must not cover another item shortage');
      assert.equal(group.completed, false);
      assert.equal(group.deadlineAt, '2026-10-26T19:00:00.000Z');
      assert.equal(
        group.latestPullingAt,
        '2026-10-26T17:01:00.000Z',
        'undo must remove the late timestamp',
      );
      const detail = await service.detail(doc!.id, admin);
      assert.equal(detail.lines.length, 2, 'same part on separate SAP items must not merge');
      assert.equal(detail.scans.length, 4);
      assert.equal(
        detail.scans.find((s) => s.serial === 'S1')!.producedAt,
        '2026-10-26T16:00:00.000Z',
        'production must precede pulling, not current card state',
      );
      const viewer: Principal = { ...admin, roleKind: 'VIEW', plantId: plant!.id };
      assert.equal((await service.snapshot(filters, viewer)).cycleGroups.length, 1);
      await assert.rejects(() => service.detail(other!.id, viewer), /tidak ditemukan/);
      await assert.rejects(() => service.saveSchedule(saved.id, input, viewer), /administrator/);
      await assert.rejects(
        () => service.snapshot(filters, { kind: 'device', sub: 1, code: 'QA', plantId: plant!.id }),
        /manusia/,
      );
      const previousDay = await service.snapshot(
        { ...filters, from: '2026-10-26', to: '2026-10-26' },
        viewer,
      );
      assert.equal(
        previousDay.cycleGroups[0]!.documents[0]!.id,
        doc!.id,
        'H-1 prep remains visible on its actual day',
      );
      await tx
        .update(deliveryLines)
        .set({ pickedKanban: 2, pickedQty: 20 })
        .where(eq(deliveryLines.id, second!.id));
      await scan(second!.id, 'S5', '2026-10-27T02:00:00Z');
      assert.equal(
        (await service.snapshot(filters, viewer)).cycleGroups[0]!.status,
        'COMPLETE_LATE',
      );
      await service.deleteSchedule(saved.id, admin);
      assert.equal((await service.detail(doc!.id, admin)).group.deadlineAt, null);
      assert(queries.length >= 2);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  assert.equal((await db.select().from(customers).where(eq(customers.code, tag))).length, 0);
  await closeDb();
  console.log('Preparation integration fixtures rolled back');
}
void main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exitCode = 1;
});
