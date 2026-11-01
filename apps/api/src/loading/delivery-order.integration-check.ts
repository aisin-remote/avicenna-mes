import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  bacaKatalogProses,
  getDb,
  closeDb,
  deliveries,
  deliveryLines,
  deliveryOrders,
  deliveryOrderCounters,
  customers,
  parts,
  plants,
  locations,
  mutations,
  scanEvents,
  sapOutbox,
  lots,
  eq,
  and,
  sql,
  inArray,
  type Database,
} from '@avicenna/db';
import { LoadingService } from './loading.service';
import { prepareDeliveryOrder, lockDeliveryOrder } from './delivery-order';
import { advanceDeliveryOrders, readDeliveryFlow } from './delivery-flow';
import { SapOutboxService } from '../sap/sap-outbox.service';

async function main() {
  if (process.env.DELIVERY_ORDER_CHECK !== 'true')
    throw Error('Set DELIVERY_ORDER_CHECK=true untuk fixture lokal.');
  const db = getDb();
  const rollback = Error('ROLLBACK_QA');
  await assert.rejects(
    db.transaction(async (tx) => {
      const scoped = tx as unknown as Database;
      const service = new LoadingService(scoped);
      const key = `QA-FLOW-${randomUUID().slice(0, 8)}`;
      const [plant] = await tx.select().from(plants).orderBy(plants.id).limit(1);
      assert(plant);
      const slocs = await tx.select().from(locations).where(eq(locations.plantId, plant.id));
      const source = slocs.find((s) => s.kind === 'FINISH_GOOD'),
        staging = slocs.find((s) => s.kind === 'STAGING');
      assert(source && staging);
      const [customer] = await tx
        .insert(customers)
        .values({ code: key, name: 'Customer QA Intercompany', partNumberFormat: 'NONE' })
        .returning();
      const [part] = await tx
        .insert(parts)
        .values({
          plantId: plant.id,
          partNumber: key,
          name: 'FRAME QA DO',
          processType: 'ASSEMBLING_UNIT_FG',
          trackingMode: 'LOT',
          qtyPerKanban: 8,
          uom: 'PC',
        })
        .returning();
      assert(customer && part);
      const [lot] = await tx
        .insert(lots)
        .values({
          plantId: plant.id,
          partId: part.id,
          lotNumber: key,
          receivedAt: new Date('2026-01-01'),
          initialQty: '100',
          status: 'OPEN',
        })
        .returning();
      assert(lot);
      await tx
        .insert(mutations)
        .values({
          plantId: plant.id,
          partId: part.id,
          locationId: source.id,
          lotId: lot.id,
          type: 'ADJUSTMENT',
          qty: '100',
          occurredAt: new Date(),
        });
      async function create(suffix: string, pds = key) {
        const [d] = await tx
          .insert(deliveries)
          .values({
            plantId: plant!.id,
            customerId: customer!.id,
            documentNumber: `${key}-${suffix}`,
            pdsNumber: pds,
            manifestNumber: '0000012345',
            deliveryDate: '2026-10-27',
            status: 'PICKING',
            locationId: source!.id,
            stagingLocationId: staging!.id,
          })
          .returning();
        assert(d);
        await tx
          .insert(deliveryLines)
          .values({
            deliveryId: d.id,
            partId: part!.id,
            plannedKanban: 3,
            plannedQty: 24,
            pickedKanban: 2,
            pickedQty: 16,
            qtyPerKanban: 8,
            customerPartNumberSource: '69201-0K040',
          });
        return d;
      }
      const a = await create('A'),
        b = await create('B');
      await assert.rejects(
        service.scan({ deliveryId: a.id, phase: 'PULLING', customerPart: key }),
        /kanban internal/,
      );
      await assert.rejects(
        service.scan({ deliveryId: a.id, phase: 'LOADING', customerPart: key }),
        /pulling PPIC/,
      );
      assert.equal((await service.completePicking(a.id)).deliveryOrderNumber, null);
      assert.equal((await service.deliveryOrder(a.id)).data, null);
      await service.completePicking(b.id);
      let flow = (await service.intercompanyFlow(a.id)).data;
      assert(flow);
      const orderId = flow.orderId;
      assert.equal(flow.stage, 'WAITING_GI_AIIA');
      assert.equal(flow.steps.length, 1);
      assert.equal(flow.steps[0]?.status, 'HELD');
      assert.equal(flow.number, null, 'Nomor belum dialokasikan sebelum SAP berhasil');
      await assert.rejects(service.scanDriver(key, undefined), /belum dikonfirmasi/);
      await assert.rejects(service.receiveReturnedDocument(key), /belum berangkat/);
      await assert.rejects(service.ship(a.id), /Absensi Driver/);
      await assert.rejects(service.setTruckStatus(a.id, 'DEPARTED'), /GI AII/);
      const ack = async (
        type: string,
        status: 'CONFIRMED' | 'SENT' | 'REJECTED' | 'FAILED',
        number: string | null,
        simulation = false,
      ) => {
        await tx
          .update(sapOutbox)
          .set({ status, sapDocNumber: number, isSimulation: simulation })
          .where(
            and(
              eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
              eq(sapOutbox.sourceId, orderId),
              eq(sapOutbox.docType, type),
            ),
          );
        await advanceDeliveryOrders(scoped, new Date('2098-01-01T00:00:00+07:00'));
      };
      await ack('DELIVERY_GI_AIIA', 'SENT', null);
      assert.equal((await readDeliveryFlow(tx, orderId))?.steps.length, 1);
      await ack('DELIVERY_GI_AIIA', 'CONFIRMED', null);
      assert.equal((await readDeliveryFlow(tx, orderId))?.stage, 'WAITING_GI_AIIA');
      await ack('DELIVERY_GI_AIIA', 'REJECTED', null);
      assert.equal((await readDeliveryFlow(tx, orderId))?.steps.length, 1);
      await ack('DELIVERY_GI_AIIA', 'CONFIRMED', 'MAT-GI-AIIA/2098');
      assert.equal((await readDeliveryFlow(tx, orderId))?.stage, 'WAITING_GR_AII');
      await ack('DELIVERY_GR_AII', 'CONFIRMED', 'SIM-GR', true);
      assert.equal(
        (await service.deliveryOrder(a.id)).data,
        null,
        'Balasan simulasi dan nyata tidak boleh dicampur',
      );
      await ack('DELIVERY_GR_AII', 'CONFIRMED', 'MAT-GR-AII/2098');
      const issued = (await service.deliveryOrder(a.id)).data;
      assert(issued);
      assert.match(issued.number!, /^SJA\/98\/\d{6,}$/);
      assert.equal(issued.snapshot.qr.value, '0000012345');
      assert.equal(
        issued.snapshot.lines.reduce((n, l) => n + l.pickedQty, 0),
        32,
      );
      await tx.update(parts).set({ name: 'MASTER BERUBAH' }).where(eq(parts.id, part.id));
      assert.deepEqual(
        (await service.deliveryOrder(a.id)).data?.snapshot,
        issued.snapshot,
        'Snapshot cetak ulang tetap',
      );
      await service.completePicking(a.id);
      assert.equal((await service.deliveryOrder(a.id)).data?.number, issued.number);
      const late = await create('LATE');
      await assert.rejects(service.completePicking(late.id), /sudah diterbitkan/);
      const noPds = await create('BLANK', ' ');
      await assert.rejects(service.completePicking(noPds.id), /PDS customer wajib/);
      await tx.update(deliveries).set({ status: 'CANCELLED' }).where(eq(deliveries.id, b.id));
      await assert.rejects(service.scanDriver(key, undefined), /perlu diperiksa/);
      assert.equal((await service.deliveryOrder(a.id)).data, null);
      await tx.update(deliveries).set({ status: 'PICKED' }).where(eq(deliveries.id, b.id));
      const scan = await service.scanDriver(issued.number!, undefined);
      assert(!scan.selectionRequired);
      assert.equal(scan.flow.stage, 'WAITING_GI_AII');
      const repeat = await service.scanDriver(issued.number!, undefined);
      assert(!repeat.selectionRequired && repeat.alreadyScanned);
      const events = await tx
        .select()
        .from(scanEvents)
        .where(eq(scanEvents.dedupeKey, `delivery-driver:${orderId}`));
      assert.equal(events.length, 1);
      for (const status of ['SENT', 'FAILED', 'REJECTED'] as const) {
        await ack('DELIVERY_GI_AII', status, null);
        assert.equal((await readDeliveryFlow(tx, orderId))?.stage, 'WAITING_GI_AII');
        const out = await tx
          .select()
          .from(mutations)
          .where(
            and(eq(mutations.sourceTable, 'TT_DELIVERY_ORDER'), eq(mutations.sourceId, orderId)),
          );
        assert.equal(out.length, 0);
      }
      await ack('DELIVERY_GI_AII', 'CONFIRMED', 'MAT-GI-AII/2098');
      await advanceDeliveryOrders(scoped);
      const out = await tx
        .select()
        .from(mutations)
        .where(
          and(eq(mutations.sourceTable, 'TT_DELIVERY_ORDER'), eq(mutations.sourceId, orderId)),
        );
      assert.equal(out.length, 2);
      assert.equal(
        out.reduce((n, r) => n + Number(r.qty), 0),
        -32,
      );
      assert(
        out.every((r) => r.lotId === lot.id),
        'Alokasi FIFO lot tetap dipertahankan',
      );
      const shipped = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.deliveryOrderId, orderId));
      assert(shipped.every((d) => d.status === 'SHIPPED' && d.arrivedAt === null));
      const received = await service.receiveReturnedDocument(issued.number!);
      assert.equal(received.status, 'RECEIVED');
      assert.equal((await service.receiveReturnedDocument(issued.number!)).alreadyReceived, true);
      const history = await service.history(a.id);
      assert(history.scans.some((e) => (e.meta as any)?.action === 'DRIVER_SCAN'));
      assert(history.movements.some((e) => e.type === 'DELIVERY_OUT'));
      const sim = new SapOutboxService(scoped, {
        katalog: () => bacaKatalogProses(scoped, { termasukNonaktif: true }),
        segarkan: () => undefined,
      } as never);
      await assert.rejects(
        sim.simulateDelivery(flow.steps[0]!.id, 'PENDING'),
        /tidak dapat di-reset/,
      );
      console.log(
        'Intercompany PG checks passed: sequential GI/GR, SENT/rejected/missing-number gates, mixed simulation, cancellation, driver retry, FIFO stock once, return separately.',
      );
      throw rollback;
    }),
    (e) => e === rollback,
  );
  await concurrency(db);
  await closeDb();
}

async function concurrency(db: Database) {
  const key = `QA-FLOW-RACE-${randomUUID().slice(0, 8)}`,
    year = 2099;
  const [before] = await db
    .select()
    .from(deliveryOrderCounters)
    .where(eq(deliveryOrderCounters.year, year));
  const fixture = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(plants).limit(1);
    assert(p);
    const [sloc] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.plantId, p.id), eq(locations.kind, 'STAGING')))
      .limit(1);
    assert(sloc);
    const [c] = await tx.insert(customers).values({ code: key, name: key }).returning();
    const [part] = await tx
      .insert(parts)
      .values({
        plantId: p.id,
        partNumber: key,
        name: 'QA concurrent',
        processType: 'ASSEMBLING_UNIT_FG',
        trackingMode: 'QUANTITY',
        qtyPerKanban: 8,
      })
      .returning();
    assert(c && part);
    for (const suffix of ['A1', 'A2', 'B1']) {
      const [d] = await tx
        .insert(deliveries)
        .values({
          plantId: p.id,
          customerId: c.id,
          documentNumber: `${key}-${suffix}`,
          pdsNumber: `${key}-${suffix[0]}`,
          deliveryDate: '2099-01-01',
          status: 'PICKED',
          stagingLocationId: sloc.id,
        })
        .returning();
      assert(d);
      await tx
        .insert(deliveryLines)
        .values({
          deliveryId: d.id,
          partId: part.id,
          plannedKanban: 1,
          plannedQty: 8,
          pickedKanban: 1,
          pickedQty: 8,
          qtyPerKanban: 8,
        });
    }
    return { customerId: c.id, partId: part.id };
  });
  try {
    await Promise.all(
      ['A', 'A', 'B'].map((g) =>
        db.transaction(async (tx) => {
          await lockDeliveryOrder(tx, fixture.customerId, `${key}-${g}`);
          await prepareDeliveryOrder(
            tx,
            fixture.customerId,
            `${key}-${g}`,
            new Date('2099-01-01'),
            null,
          );
        }),
      ),
    );
    const orders = await db
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.customerId, fixture.customerId));
    assert.equal(orders.length, 2);
    const ids = orders.map((o) => o.id);
    const filter = and(
      eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
      inArray(sapOutbox.sourceId, ids),
    );
    assert.equal(
      (await db.select().from(sapOutbox).where(filter)).length,
      2,
      'Satu GI AIIA untuk masing-masing PDS',
    );
    await db.update(sapOutbox).set({ status: 'CONFIRMED', sapDocNumber: 'QA-GI' }).where(filter);
    await advanceDeliveryOrders(db, new Date('2099-01-01'), ids);
    await db
      .update(sapOutbox)
      .set({ status: 'CONFIRMED', sapDocNumber: 'QA-GR' })
      .where(and(filter, eq(sapOutbox.docType, 'DELIVERY_GR_AII')));
    await Promise.all([
      advanceDeliveryOrders(db, new Date('2099-01-01'), ids),
      advanceDeliveryOrders(db, new Date('2099-01-01'), ids),
    ]);
    const numbered = await db
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.customerId, fixture.customerId));
    assert(numbered.every((o) => o.number?.startsWith('SJA/99/')));
    assert.equal(new Set(numbered.map((o) => o.number)).size, 2);
    assert.deepEqual(
      numbered.map((o) => o.serial!).sort((a, b) => a - b),
      [(before?.lastSerial ?? 0) + 1, (before?.lastSerial ?? 0) + 2],
    );
    console.log('Concurrent preparation/reconciliation and annual DO counter checks passed.');
  } finally {
    await db.transaction(async (tx) => {
      const os = await tx
        .select({ id: deliveryOrders.id })
        .from(deliveryOrders)
        .where(eq(deliveryOrders.customerId, fixture.customerId));
      if (os.length)
        await tx.delete(sapOutbox).where(
          and(
            eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
            inArray(
              sapOutbox.sourceId,
              os.map((o) => o.id),
            ),
          ),
        );
      await tx.delete(deliveries).where(eq(deliveries.customerId, fixture.customerId));
      await tx.delete(deliveryOrders).where(eq(deliveryOrders.customerId, fixture.customerId));
      await tx.delete(parts).where(eq(parts.id, fixture.partId));
      await tx.delete(customers).where(eq(customers.id, fixture.customerId));
      const [counter] = await tx
        .select()
        .from(deliveryOrderCounters)
        .where(eq(deliveryOrderCounters.year, year))
        .for('update');
      if (counter?.lastSerial === (before?.lastSerial ?? 0) + 2) {
        if (before)
          await tx
            .update(deliveryOrderCounters)
            .set({ lastSerial: before.lastSerial })
            .where(eq(deliveryOrderCounters.year, year));
        else await tx.delete(deliveryOrderCounters).where(eq(deliveryOrderCounters.year, year));
      }
    });
  }
}
void main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exitCode = 1;
});
