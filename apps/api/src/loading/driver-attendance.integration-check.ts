import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getDb,
  closeDb,
  plants,
  customers,
  parts,
  locations,
  users,
  deliveries,
  deliveryLines,
  deliveryOrders,
  sapOutbox,
  scanEvents,
  mutations,
  driverDestinations,
  driverAttendances,
  driverAttendanceOrders,
  and,
  eq,
  inArray,
} from '@avicenna/db';
import {
  driverAttendanceStartSchema,
  type DeliveryOrderSnapshot,
  type DriverAttendanceStart,
} from '@avicenna/contracts';
import type { Principal } from '../auth/auth.types';
import { FotoService } from '../master/foto.service';
import { DriverAttendanceService } from './driver-attendance.service';

async function main() {
  assert(
    ['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL!).hostname),
    'Fixture hanya untuk database lokal.',
  );
  const dir = await mkdtemp('D:/Temp/avicenna-attendance-qa-');
  const oldDir = process.env.FOTO_DIR;
  process.env.FOTO_DIR = dir;
  const db = getDb(),
    photos = new FotoService(),
    service = new DriverAttendanceService(db, photos);
  const tag = `ATT-${randomUUID().slice(0, 8)}`,
    orderIds: number[] = [],
    deliveryIds: number[] = [];
  let plantId = 0,
    customerId = 0,
    partId = 0;
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  try {
    const [plant] = await db
      .insert(plants)
      .values({ code: tag, name: 'Attendance QA' })
      .returning();
    plantId = plant!.id;
    const [customer] = await db
      .insert(customers)
      .values({ code: tag, name: 'Attendance QA' })
      .returning();
    customerId = customer!.id;
    const [part] = await db
      .insert(parts)
      .values({
        plantId,
        partNumber: tag,
        name: tag,
        processType: 'ASSEMBLING_UNIT_FG',
        qtyPerKanban: 20,
      })
      .returning();
    partId = part!.id;
    const [staging] = await db
      .insert(locations)
      .values({ plantId, code: 'PP04', name: 'QA staging', kind: 'STAGING' })
      .returning();
    const [user] = await db.select().from(users).limit(1);
    assert(user);
    const admin: Principal = {
      kind: 'user',
      sub: user.id,
      npk: 'QA',
      name: 'QA',
      role: null,
      roleKind: 'ADMIN',
      roleProcessGroup: null,
      plantId,
    };
    const other: Principal = { ...admin, roleKind: 'SCANNING', plantId: plantId + 10000 };
    const [destination] = await db
      .insert(driverDestinations)
      .values({
        plantId,
        customerId,
        code: tag,
        name: 'QA destination',
        dock: 'R-04-C',
        logistic: 'QA LP',
      })
      .returning();
    async function order(suffix: string) {
      const pds = `${tag}-${suffix}`;
      const snapshot: DeliveryOrderSnapshot = {
        pdsNumber: pds,
        qr: { value: pds, source: 'PDS' },
        customerCode: tag,
        customerName: 'Attendance QA',
        documentNumbers: [pds],
        deliveryDates: ['2026-10-28'],
        deliveryLocations: ['R-04-C'],
        purchaseOrderNumbers: [],
        planTimes: [],
        lines: [],
      };
      const [o] = await db
        .insert(deliveryOrders)
        .values({
          number: pds,
          customerId,
          pdsNumber: pds,
          intercompany: true,
          issuedAt: new Date(),
          snapshot,
        })
        .returning();
      orderIds.push(o!.id);
      const [d] = await db
        .insert(deliveries)
        .values({
          plantId,
          customerId,
          deliveryOrderId: o!.id,
          documentNumber: pds,
          pdsNumber: pds,
          deliveryDate: '2026-10-28',
          cycle: 1,
          dock: 'R-04-C',
          status: 'PICKED',
          stagingLocationId: staging!.id,
        })
        .returning();
      deliveryIds.push(d!.id);
      const [line] = await db
        .insert(deliveryLines)
        .values({
          deliveryId: d!.id,
          partId,
          qtyPerKanban: 20,
          plannedKanban: 1,
          plannedQty: 20,
          pickedKanban: 1,
          pickedQty: 20,
        })
        .returning();
      snapshot.deliveryIds = [d!.id];
      snapshot.lines = [
        {
          id: line!.id,
          deliveryId: d!.id,
          partId,
          plantId,
          stagingLocationId: staging!.id,
          partNumber: tag,
          customerPartNumber: tag,
          partName: tag,
          qtyPerKanban: 20,
          pickedKanban: 1,
          pickedQty: 20,
          uom: 'PC',
        },
      ];
      await db.update(deliveryOrders).set({ snapshot }).where(eq(deliveryOrders.id, o!.id));
      await db
        .insert(sapOutbox)
        .values(
          ['DELIVERY_GI_AIIA', 'DELIVERY_GR_AII'].map((type) => ({
            plantId,
            sourceTable: 'TT_DELIVERY_ORDER',
            sourceId: o!.id,
            docType: type,
            idempotencyKey: `${pds}-${type}`,
            status: 'CONFIRMED' as const,
            sapDocNumber: `${suffix}-${type}`,
            payload: {},
            occurredAt: new Date(),
          })),
        );
      return o!;
    }
    const a = await order('A'),
      b = await order('B');
    const input: DriverAttendanceStart = {
      plantId,
      slot: 1,
      destinationId: destination!.id,
      cycle: 1,
      helmet: true,
      vest: true,
      shoes: true,
      photo: image,
      orderIds: [a.id, b.id],
    };
    assert(!driverAttendanceStartSchema.safeParse({ ...input, helmet: false }).success);
    assert(!driverAttendanceStartSchema.safeParse({ ...input, photo: '' }).success);
    assert(!driverAttendanceStartSchema.safeParse({ ...input, orderIds: [a.id, a.id] }).success);
    await assert.rejects(service.start(input, other), /pabrik lain/);
    await assert.rejects(service.start(input, { ...admin, roleKind: 'VIEW' }), /hanya dapat melihat/);
    await assert.rejects(service.start({ ...input, cycle: 2 }, admin), /cycle berbeda/);
    assert.equal((await service.resolve(a.pdsNumber, plantId, admin)).data[0]?.id, a.id);
    const pickup = await service.start(input, admin);
    assert.equal(
      (await service.board(plantId, admin)).active[0]?.orders.length,
      2,
      'Sesi tetap tersedia sesudah refresh',
    );
    const gi = () =>
      db
        .select()
        .from(sapOutbox)
        .where(
          and(
            inArray(sapOutbox.sourceId, orderIds),
            eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
            eq(sapOutbox.docType, 'DELIVERY_GI_AII'),
          ),
        );
    assert.equal((await gi()).length, 0, 'Mulai pickup / scan DO belum memicu GI AII');
    assert((await service.photo(pickup.id, admin)).isi.length > 0);
    await assert.rejects(service.photo(pickup.id, other), /pabrik lain/);
    await assert.rejects(service.start(input, admin), /Posisi truk/);
    await assert.rejects(service.start({ ...input, slot: 2 }, admin), /sudah dipakai/);
    await assert.rejects(service.finish(pickup.id, other), /pabrik lain/);
    await db
      .update(sapOutbox)
      .set({ status: 'FAILED' })
      .where(and(eq(sapOutbox.sourceId, b.id), eq(sapOutbox.docType, 'DELIVERY_GR_AII')));
    await assert.rejects(service.finish(pickup.id, admin), /belum dikonfirmasi/);
    assert.equal((await gi()).length, 0, 'Kegagalan DO kedua membatalkan GI DO pertama');
    assert.equal((await service.board(plantId, admin)).active.length, 1);
    const [unchanged] = await db.select().from(deliveryOrders).where(eq(deliveryOrders.id, a.id));
    assert.equal(unchanged!.driverScannedAt, null);
    await db
      .update(sapOutbox)
      .set({ status: 'CONFIRMED' })
      .where(and(eq(sapOutbox.sourceId, b.id), eq(sapOutbox.docType, 'DELIVERY_GR_AII')));
    const results = await Promise.all([
      service.finish(pickup.id, admin),
      service.finish(pickup.id, admin),
    ]);
    assert.deepEqual(results.map((r) => r.alreadyFinished).sort(), [false, true]);
    assert.equal((await gi()).length, 2, 'Setiap DO hanya punya satu GI AII');
    assert.equal((await service.board(plantId, admin)).active.length, 0);
    const c = await order('C'),
      d = await order('D');
    const races = await Promise.allSettled([
      service.start({ ...input, orderIds: [c.id] }, admin),
      service.start({ ...input, orderIds: [d.id] }, admin),
    ]);
    assert.equal(
      races.filter((r) => r.status === 'fulfilled').length,
      1,
      'Satu slot tidak dapat dipakai dua pickup bersamaan',
    );
    const winner = races.find(
      (r): r is PromiseFulfilledResult<{ id: number }> => r.status === 'fulfilled',
    )!;
    await service.finish(winner.value.id, admin);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const filter = { plantId, from: date, to: date, page: 1 };
    const history = await service.history(filter, admin);
    assert.equal(history.total, 2);
    assert(history.data.every((r) => r.endedAt));
    assert.equal((await service.exportRows(filter, admin)).length, 2);
    assert.equal(
      (await db.select().from(mutations).where(eq(mutations.plantId, plantId))).length,
      0,
      'Antrean GI belum dianggap SAP berhasil / stok keluar',
    );
    await assert.rejects(service.history({ ...filter, to: '2020-01-01' }, admin), /Rentang/);
    console.log(
      'PASS attendance: safety, photo, multi-DO, no early GI, atomic finish, concurrent retry/slot, plant scope, history/export.',
    );
  } finally {
    if (plantId) {
      const entries = await db
        .select()
        .from(driverAttendances)
        .where(eq(driverAttendances.plantId, plantId));
      for (const r of entries) await photos.hapusDiam(r.photo, 'driver-attendance');
      if (entries.length)
        await db.delete(driverAttendanceOrders).where(
          inArray(
            driverAttendanceOrders.attendanceId,
            entries.map((r) => r.id),
          ),
        );
      await db.delete(driverAttendances).where(eq(driverAttendances.plantId, plantId));
      await db.delete(scanEvents).where(eq(scanEvents.plantId, plantId));
      await db.delete(sapOutbox).where(eq(sapOutbox.plantId, plantId));
      if (deliveryIds.length) {
        await db.delete(deliveryLines).where(inArray(deliveryLines.deliveryId, deliveryIds));
        await db.delete(deliveries).where(inArray(deliveries.id, deliveryIds));
      }
      if (orderIds.length)
        await db.delete(deliveryOrders).where(inArray(deliveryOrders.id, orderIds));
      await db.delete(driverDestinations).where(eq(driverDestinations.plantId, plantId));
      if (partId) await db.delete(parts).where(eq(parts.id, partId));
      await db.delete(locations).where(eq(locations.plantId, plantId));
      if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
      await db.delete(plants).where(eq(plants.id, plantId));
    }
    const scope = join(dir, 'driver-attendance');
    const remaining = await readdir(scope).catch(() => []);
    assert.deepEqual(remaining, [], 'Tidak ada foto yatim setelah rollback / race');
    await rmdir(scope).catch(() => undefined);
    await rmdir(dir);
    if (oldDir === undefined) delete process.env.FOTO_DIR;
    else process.env.FOTO_DIR = oldDir;
    await closeDb();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
