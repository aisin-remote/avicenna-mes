import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  getDb,
  closeDb,
  eq,
  and,
  parts,
  plants,
  suppliers,
  locations,
  users,
  mutations,
  receipts,
  receiptLines,
  sapOutbox,
  readAresOrderSheet,
} from '@avicenna/db';
import type { AresOrderSource } from '@avicenna/contracts';
import type { UserPrincipal } from '../auth/auth.types';
import { ReceivingSessionService } from './receiving-session.service';
import { SapOutboxService } from '../sap/sap-outbox.service';

/** Opt-in, fixture MES sendiri. Tidak pernah menulis ke ARES atau SAP. */
async function main() {
  if (process.env.RECEIVING_TRIAL_CHECK !== 'true')
    throw new Error('Set RECEIVING_TRIAL_CHECK=true untuk fixture receiving lokal.');
  if (process.env.STAGING_PUSH_ENABLED === 'true')
    throw new Error('Matikan push staging sebelum trial.');
  const db = getDb();
  const [plant] = await db.select().from(plants).orderBy(plants.id).limit(1);
  const [actor] = await db.select().from(users).where(eq(users.npk, 'ADMIN')).limit(1);
  assert(plant && actor, 'Butuh plant dan akun ADMIN lokal');
  const [warehouse] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.plantId, plant.id), eq(locations.kind, 'WAREHOUSE')))
    .limit(1);
  assert(warehouse, 'Butuh warehouse');
  const principal: UserPrincipal = {
    kind: 'user',
    sub: actor.id,
    npk: actor.npk,
    name: actor.name,
    role: 'QA',
    roleKind: 'ADMIN',
    roleProcessGroup: null,
    plantId: plant.id,
  };
  const suffix = randomUUID().slice(0, 8);
  const [supplier] = await db
    .insert(suppliers)
    .values({ code: `QA-RCV-${suffix}`, name: `Supplier QA Receiving ${suffix}` })
    .$returningId();
  const [part] = await db
    .insert(parts)
    .values({
      plantId: plant.id,
      partNumber: `QA-RCV-${suffix}`,
      name: 'Part QA Receiving',
      processType: 'ASSEMBLING_UNIT',
      partType: 'COMPONENT',
      sourceType: 'PURCHASED',
      trackingMode: 'LOT',
      uom: 'PCS',
    })
    .$returningId();
  assert(part && supplier);
  const order: AresOrderSource = {
    id: 1_000_000_000 + Math.floor(Math.random() * 900_000_000),
    orderNumber: `PL-261006-${Math.floor(Math.random() * 900_000) + 100_000}`,
    revision: 0,
    plantCode: plant.code,
    supplierCode: `QA-RCV-${suffix}`,
    supplierName: `Supplier QA Receiving ${suffix}`,
    status: 'SHIPPED',
    deliveryDate: '2026-10-06',
    arrivalTime: '09:00:00',
    cycle: 1,
    lines: [
      {
        id: 1,
        vendorPartId: 1,
        partNumber: `QA-RCV-${suffix}`,
        materialNumber: `QA-RCV-${suffix}`,
        partName: 'Part QA Receiving',
        backNumber: 'QA-RCV',
        uom: 'PC',
        qtyPerBox: 12,
        boxOrdered: 3,
        boxShipped: 3,
        poNumber: 'PO-QA',
        poItem: '00010',
      },
    ],
    kanbans: [1, 2, 3].map((serial) => ({
      id: randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase(),
      lineId: 1,
      serial,
      status: serial === 1 ? 'PRINTED' : serial === 2 ? 'SHIPPED' : 'CANCELLED',
      revision: 0,
    })),
  };
  class FixtureReceiving extends ReceivingSessionService {
    protected override async source() {
      return structuredClone(order);
    }
  }
  const service = new FixtureReceiving(db);
  const code = `ARES:P:${order.orderNumber}-0`;
  await assert.rejects(
    service.open({ code, locationId: warehouse.id }, { ...principal, roleKind: 'VIEW' }),
  );
  const [session, resumed] = await Promise.all([
    service.open({ code, locationId: warehouse.id }, principal),
    service.open({ code, locationId: warehouse.id }, principal),
  ]);
  assert.equal(session.id, resumed.id, 'Open serentak harus resume sesi yang sama');
  await assert.rejects(
    service.get(session.id, { ...principal, roleKind: 'SCANNING', plantId: -1 }),
  );
  const barcode = (index: number) => `ARES:K:${order.kanbans[index]!.id}`;
  const ref = randomUUID();
  const first = await service.scan(session.id, { code: barcode(0), clientRef: ref }, principal);
  assert.equal(first.result, 'OK');
  assert.equal(first.autoShipped, true);
  assert.equal(
    (await service.scan(session.id, { code: barcode(0), clientRef: ref }, principal)).result,
    'OK',
  );
  await assert.rejects(service.scan(session.id, { code: barcode(1), clientRef: ref }, principal));
  assert.equal(
    (await service.scan(session.id, { code: barcode(0), clientRef: randomUUID() }, principal))
      .result,
    'DUPLICATE',
  );
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      service.scan(session.id, { code: barcode(1), clientRef: randomUUID() }, principal),
    ),
  );
  assert.deepEqual(concurrent.map((result) => result.result).sort(), ['DUPLICATE', 'OK']);
  assert.equal(
    (await service.scan(session.id, { code: barcode(2), clientRef: randomUUID() }, principal))
      .result,
    'REJECTED',
  );
  assert.equal(
    (
      await service.scan(
        session.id,
        { code: 'ARES:P:826100500101', clientRef: randomUUID() },
        principal,
      )
    ).result,
    'REJECTED',
  );
  const stock = () =>
    db
      .select()
      .from(mutations)
      .where(
        and(eq(mutations.sourceTable, 'TT_PURCHASE_RECEIPT_H'), eq(mutations.sourceId, session.id)),
      );
  assert.equal((await stock()).length, 0, 'Scan belum menambah stok');
  await assert.rejects(service.close(session.id, '', principal), /Alasan wajib/);
  order.kanbans[0]!.status = 'CANCELLED';
  await assert.rejects(service.close(session.id, 'Kurang 1 box', principal), /Kanban.*berubah/);
  order.kanbans[0]!.status = 'PRINTED';
  await Promise.all([
    service.close(session.id, 'Supplier kurang 1 box', principal),
    service.close(session.id, 'Supplier kurang 1 box', principal),
  ]);
  assert.equal((await stock()).length, 1, 'Close serentak harus menambah stok sekali');
  assert.equal(Number((await stock())[0]!.qty), 24, 'Stok memakai 2 box aktual, bukan 3 pesanan');
  assert.equal((await service.get(session.id, principal)).totals.missing, 1);
  assert.equal(
    (await service.scan(session.id, { code: barcode(0), clientRef: ref }, principal)).result,
    'OK',
    'Retry sesudah close tidak menggandakan scan',
  );
  const outbox = new SapOutboxService(db);
  const build = Reflect.get(outbox, 'buildAndInsert').bind(outbox) as (
    table: string,
    id: number,
  ) => Promise<unknown>;
  await build('TT_PURCHASE_RECEIPT_H', session.id);
  const docs = () =>
    db
      .select()
      .from(sapOutbox)
      .where(
        and(eq(sapOutbox.sourceTable, 'TT_PURCHASE_RECEIPT_H'), eq(sapOutbox.sourceId, session.id)),
      );
  assert(
    (await docs()).every(
      (doc) =>
        doc.status === 'HELD' && doc.lastError?.startsWith('pendorong untuk receiving belum'),
    ),
  );
  await Promise.all([
    service.cancel(session.id, 'QA selesai', principal),
    service.cancel(session.id, 'QA selesai', principal),
  ]);
  assert.equal(
    (await stock()).reduce((sum, mutation) => sum + Number(mutation.qty), 0),
    0,
    'Cancel membalik stok tepat sekali',
  );
  await build('TT_PURCHASE_RECEIPT_H', session.id);
  assert(
    (await docs()).every((doc) => doc.status === 'SKIPPED'),
    'Dokumen cancel tidak boleh dikirim, termasuk collector terlambat',
  );
  assert.equal(
    (await db.select().from(receiptLines).where(eq(receiptLines.receiptId, session.id))).length,
    1,
    'Audit line tetap tersimpan',
  );
  console.log(
    JSON.stringify({
      result: 'PASS',
      receivingId: session.id,
      checks:
        'open/resume, scope/VIEW, FIFO UUID retry, concurrent duplicate, no stock before close, partial reason, live cancellation, atomic close, held GR, cancel once',
    }),
  );

  // Mapping demo ARES yang sudah berlabel uji; sumber tetap SELECT-only.
  if (process.env.RECEIVING_ARES_DEMO === 'true') {
    const demo = await readAresOrderSheet('PL-260921-0107', 0);
    assert(
      demo && demo.supplierName.startsWith('Supplier Uji'),
      'Hanya sumber demo yang boleh dipakai check ini',
    );
    const [demoPlant] = await db.select().from(plants).where(eq(plants.code, demo.plantCode));
    assert(demoPlant);
    const existingSupplier = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.code, demo.supplierCode!));
    if (!existingSupplier.length)
      await db.insert(suppliers).values({ code: demo.supplierCode!, name: demo.supplierName });
    for (const line of demo.lines) {
      const existingPart = await db
        .select()
        .from(parts)
        .where(and(eq(parts.plantId, demoPlant.id), eq(parts.partNumber, line.partNumber)));
      if (!existingPart.length)
        await db.insert(parts).values({
          plantId: demoPlant.id,
          partNumber: line.partNumber,
          backNumber: line.backNumber,
          name: line.partName,
          processType: 'ASSEMBLING_UNIT',
          partType: 'COMPONENT',
          sourceType: 'PURCHASED',
          trackingMode: 'LOT',
          uom: 'PCS',
        });
    }
    console.log(
      JSON.stringify({
        demoOrder: `ARES:P:${demo.orderNumber}-0`,
        demoKanban: `ARES:K:${demo.kanbans[0]!.id}`,
      }),
    );
  }
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exitCode = 1;
});
