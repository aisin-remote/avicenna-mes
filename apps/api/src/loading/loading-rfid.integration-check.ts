import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import {
  getDb,
  closeDb,
  plants,
  lines,
  parts,
  customers,
  customerParts,
  locations,
  users,
  devices,
  deliveries,
  deliveryLines,
  deliveryOrders,
  kanbans,
  kanbanItems,
  kanbanEvents,
  scanEvents,
  mutations,
  sapOutbox,
  eq,
  inArray,
} from '@avicenna/db';
import {
  loadingRfidBatchSchema,
  type LoadingRfidBatchInput,
  type LoadingRfidBatchResult,
} from '@avicenna/contracts';
import type { Principal } from '../auth/auth.types';
import { LoadingService } from './loading.service';
import { LoadingController } from './loading.controller';

type Tag = LoadingRfidBatchInput['tags'][number];
type ItemPlan = {
  partId: number;
  customerPart: string;
  boxes: number;
  qty: number;
  perBox: number;
};

/** Committed, isolated fixtures let concurrent requests use real independent PG connections. */
async function main() {
  assert.notEqual(
    process.env.NODE_ENV,
    'production',
    'RFID QA tidak boleh dijalankan di produksi.',
  );
  assert(
    ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),
    'RFID QA hanya untuk PostgreSQL lokal.',
  );
  assert.notEqual(
    (process.env.STAGING_PUSH_ENABLED ?? '').trim().toLowerCase(),
    'true',
    'Matikan push staging sebelum menjalankan fixture QA.',
  );
  const db = getDb(),
    service = new LoadingService(db),
    suffix = randomUUID().slice(0, 12);
  const plantIds: number[] = [],
    partIds: number[] = [],
    documentIds: number[] = [],
    kanbanIds: number[] = [];
  let customerId = 0;
  try {
    const [plant] = await db
      .insert(plants)
      .values({ code: `RFQA-${suffix}`, name: 'RFID QA only' })
      .returning();
    plantIds.push(plant!.id);
    const [otherPlant] = await db
      .insert(plants)
      .values({ code: `RFQ2-${suffix}`, name: 'RFID QA other plant' })
      .returning();
    plantIds.push(otherPlant!.id);
    const plantId = plant!.id;
    const [customer] = await db
      .insert(customers)
      .values({
        code: `RFQA-${suffix}`,
        name: 'Normal customer RFID QA',
        directKanban: false,
        partNumberFormat: 'NONE',
      })
      .returning();
    customerId = customer!.id;
    const [source] = await db
      .insert(locations)
      .values({ plantId, code: 'RFQA-FG', name: 'RFID QA FG', kind: 'FINISH_GOOD' })
      .returning();
    const [staging] = await db
      .insert(locations)
      .values({ plantId, code: 'RFQA-STAGE', name: 'RFID QA staging', kind: 'STAGING' })
      .returning();
    const [productionLine] = await db
      .insert(lines)
      .values({
        plantId,
        code: 'RFQA-LINE',
        name: 'RFID QA line',
        processType: 'ASSEMBLING_UNIT_FG',
        inputLocationId: source!.id,
        outputLocationId: staging!.id,
      })
      .returning();
    async function part(letter: string, perBox: number) {
      const number = `RFQA-PART-${letter}-${suffix}`;
      const [row] = await db
        .insert(parts)
        .values({
          plantId,
          lineId: productionLine!.id,
          partNumber: number,
          backNumber: `RF${letter}`,
          name: number,
          processType: 'ASSEMBLING_UNIT_FG',
          qtyPerKanban: perBox,
          trackingMode: 'QUANTITY',
        })
        .returning();
      partIds.push(row!.id);
      await db
        .insert(customerParts)
        .values({ customerId, partId: row!.id, customerPartNumber: number });
      return { partId: row!.id, customerPart: number, perBox };
    }
    const a = await part('A', 20),
      b = await part('B', 10);
    const [user] = await db.select().from(users).orderBy(users.id).limit(1);
    assert(user, 'Butuh satu pengguna lokal untuk FK audit.');
    const admin: Principal = {
      kind: 'user',
      sub: user.id,
      npk: 'RFID-QA',
      name: 'RFID QA',
      role: null,
      roleKind: 'ADMIN',
      roleProcessGroup: null,
      plantId,
    };
    const scanner: Principal = { ...admin, roleKind: 'SCANNING' };
    const deviceRows = await db
      .insert(devices)
      .values([
        { plantId, code: `RFQA-RFID-${suffix}`, name: 'RFID QA reader', kind: 'RFID' as const },
        {
          plantId,
          code: `RFQA-OFF-${suffix}`,
          name: 'RFID QA inactive reader',
          kind: 'RFID' as const,
          isActive: false,
        },
        {
          plantId,
          code: `RFQA-GUN-${suffix}`,
          name: 'RFID QA barcode gun',
          kind: 'SCANNER' as const,
        },
        {
          plantId: otherPlant!.id,
          code: `RFQA-OTHER-${suffix}`,
          name: 'RFID QA foreign reader',
          kind: 'RFID' as const,
        },
      ])
      .returning();
    const reader = (index: number): Principal => ({
      kind: 'device',
      sub: deviceRows[index]!.id,
      code: deviceRows[index]!.code,
      plantId: deviceRows[index]!.plantId,
    });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    async function document(label: string, plan: ItemPlan[]) {
      const [doc] = await db
        .insert(deliveries)
        .values({
          plantId,
          customerId,
          documentNumber: `RFQA-${suffix}-${label}`,
          pdsNumber: `RFQA-PDS-${suffix}-${label}`,
          deliveryDate: today,
          cycle: 1,
          locationId: source!.id,
          stagingLocationId: staging!.id,
          status: 'DRAFT',
        })
        .returning();
      documentIds.push(doc!.id);
      const itemRows = await db
        .insert(deliveryLines)
        .values(
          plan.map((p, i) => ({
            deliveryId: doc!.id,
            partId: p.partId,
            customerPartNumberSource: p.customerPart,
            sapItemNumber: String((i + 1) * 10),
            plannedKanban: p.boxes,
            plannedQty: p.qty,
            qtyPerKanban: p.perBox,
          })),
        )
        .returning();
      return { id: doc!.id, items: itemRows };
    }
    const tag = (id: string, customerPart = a.customerPart, serialNumber?: string): Tag => ({
      tagId: `${suffix}-${id}`,
      customerPart,
      ...(serialNumber ? { serialNumber } : {}),
    });
    const batch = (deliveryId: number, tags: Tag[], principal: Principal | undefined = admin) =>
      service.scanRfidBatch({ deliveryId, tags }, principal);
    function statuses(result: LoadingRfidBatchResult, expected: string[]) {
      assert.deepEqual(
        result.results.map((r) => r.status),
        expected,
      );
      assert.deepEqual(
        result.results.map((r) => r.index),
        expected.map((_, i) => i),
      );
      assert.equal(result.phase, 'PULLING');
      assert.equal(result.summary.total, expected.length);
      assert.equal(result.summary.accepted, expected.filter((s) => s === 'ACCEPTED').length);
      assert.equal(result.summary.duplicate, expected.filter((s) => s === 'DUPLICATE').length);
      assert.equal(result.summary.rejected, expected.filter((s) => s === 'REJECTED').length);
    }
    async function lineState(id: number) {
      const [row] = await db.select().from(deliveryLines).where(eq(deliveryLines.id, id));
      assert(row);
      return row;
    }
    async function denied(operation: Promise<unknown>) {
      await assert.rejects(operation, (e: unknown) => {
        const status = (e as { getStatus?: () => number }).getStatus?.();
        return status === 401 || status === 403;
      });
    }

    const mixed = await document('mixed', [
      { ...a, boxes: 3, qty: 60 },
      { ...b, boxes: 1, qty: 10 },
    ]);
    const input = { deliveryId: mixed.id, tags: [tag('SCHEMA')] };
    assert(loadingRfidBatchSchema.safeParse(input).success);
    for (const invalid of [
      { ...input, tags: [] },
      { ...input, tags: Array.from({ length: 201 }, () => tag('TOO-MANY')) },
      { ...input, phase: 'LOADING' },
      { ...input, tags: [{ ...tag('X'), tagId: '' }] },
      { ...input, tags: [{ ...tag('X'), tagId: 'x'.repeat(129) }] },
      { ...input, tags: [{ ...tag('X'), customerPart: 'x'.repeat(256) }] },
      { ...input, tags: [{ ...tag('X'), serialNumber: '' }] },
      { ...input, tags: [{ ...tag('X'), serialNumber: 'x'.repeat(65) }] },
      { ...input, tags: [{ ...tag('X'), internalKanban: 'BYPASS' }] },
    ])
      assert(
        !loadingRfidBatchSchema.safeParse(invalid).success,
        'Schema harus menolak payload tidak sah',
      );
    await denied(batch(mixed.id, [tag('VIEW')], { ...admin, roleKind: 'VIEW' }));
    await denied(batch(mixed.id, [tag('WRONG-PLANT')], { ...scanner, plantId: otherPlant!.id }));
    await denied(batch(mixed.id, [tag('NO-PLANT')], { ...scanner, plantId: null }));
    await denied(service.scanRfidBatch(input, undefined));
    await denied(batch(mixed.id, [tag('OFF')], reader(1)));
    await denied(batch(mixed.id, [tag('NOT-RFID')], reader(2)));
    await denied(batch(mixed.id, [tag('OTHER-DEVICE')], reader(3)));
    await denied(batch(mixed.id, [tag('FORGED-DEVICE-PLANT')], { ...reader(3), plantId }));
    const controller = new LoadingController(service);
    const foreignRequest = { principal: reader(3) } as Request;
    for (const operation of [
      () =>
        controller.scan(
          { deliveryId: mixed.id, phase: 'PULLING', customerPart: a.customerPart },
          foreignRequest,
        ),
      () =>
        controller.undo(
          mixed.id,
          mixed.items[0]!.id,
          foreignRequest,
          { reason: 'RFID QA' },
          'PULLING',
        ),
      () => controller.pick(mixed.id, foreignRequest),
      () => controller.ship(mixed.id, foreignRequest),
      () => controller.truck(mixed.id, { truckStatus: 'ARRIVED' }, foreignRequest),
    ]) {
      await assert.rejects(
        operation,
        (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 403,
        'Endpoint barcode lama juga harus menolak RFID dari pabrik lain',
      );
    }
    assert.equal((await lineState(mixed.items[0]!.id)).pickedKanban, 0);
    const [guardedHeader] = await db.select().from(deliveries).where(eq(deliveries.id, mixed.id));
    assert.equal(guardedHeader!.status, 'DRAFT');
    assert.equal(guardedHeader!.truckStatus, 'PENDING');
    await assert.rejects(
      service.scan({ deliveryId: mixed.id, phase: 'PULLING', customerPart: a.customerPart }, admin),
      /internal/i,
      'Customer biasa tetap membutuhkan kanban internal pada scan manual',
    );

    const mixedTags = [
      tag('A1', a.customerPart, '01'),
      tag('RECOVER', 'RFQA-UNKNOWN-PART'),
      tag('A1', a.customerPart, '01'),
      tag('A2', a.customerPart, '01'),
      tag('B1', b.customerPart, '01'),
    ];
    const result = await batch(mixed.id, mixedTags);
    statuses(result, ['ACCEPTED', 'REJECTED', 'DUPLICATE', 'ACCEPTED', 'ACCEPTED']);
    assert.equal(result.results[0]!.lineId, mixed.items[0]!.id);
    assert.equal(result.results[2]!.lineId, mixed.items[0]!.id);
    assert.equal(result.results[4]!.lineId, mixed.items[1]!.id);
    assert.equal(result.results[4]!.partNumber, b.customerPart);
    assert.deepEqual(result.totals, { plannedKanban: 4, pickedKanban: 3, actualKanban: 0 });
    assert.deepEqual(
      result.results.map((r) => r.tagId),
      mixedTags.map((t) => t.tagId),
    );
    assert.equal((await lineState(mixed.items[0]!.id)).pickedQty, 40);
    assert.equal((await lineState(mixed.items[1]!.id)).pickedQty, 10);
    const retried = await batch(mixed.id, mixedTags);
    statuses(retried, ['DUPLICATE', 'REJECTED', 'DUPLICATE', 'DUPLICATE', 'DUPLICATE']);
    statuses(await batch(mixed.id, [tag('A1', b.customerPart, '01')]), ['REJECTED']);
    statuses(await batch(mixed.id, [tag('A1', a.customerPart, '02')]), ['REJECTED']);
    statuses(await batch(mixed.id, [tag('RECOVER')]), ['ACCEPTED']);
    statuses(await batch(mixed.id, [tag('A-OVER')]), ['REJECTED']);
    assert.equal((await lineState(mixed.items[0]!.id)).pickedKanban, 3);
    assert.equal((await lineState(mixed.items[0]!.id)).pickedQty, 60);
    const [mixedHeader] = await db.select().from(deliveries).where(eq(deliveries.id, mixed.id));
    assert.equal(mixedHeader!.status, 'PICKING');

    const otherActive = await document('other-active', [{ ...a, boxes: 2, qty: 40 }]);
    statuses(await batch(otherActive.id, [tag('A1', a.customerPart, '01')]), ['REJECTED']);
    assert.equal((await lineState(otherActive.items[0]!.id)).pickedKanban, 0);
    const pcs = await document('pcs-cap', [{ ...a, boxes: 2, qty: 25 }]);
    statuses(await batch(pcs.id, [tag('PCS1'), tag('PCS2')]), ['ACCEPTED', 'REJECTED']);
    assert.equal(
      (await lineState(pcs.items[0]!.id)).pickedQty,
      20,
      'Tidak melewati rencana pcs walau masih ada slot box',
    );
    const drift = await document('qty-drift', [{ ...a, boxes: 5, qty: 40 }]);
    await db
      .update(deliveryLines)
      .set({ pickedKanban: 2, pickedQty: 0 })
      .where(eq(deliveryLines.id, drift.items[0]!.id));
    statuses(await batch(drift.id, [tag('QTY-DRIFT')]), ['REJECTED']);
    assert.equal((await lineState(drift.items[0]!.id)).pickedKanban, 2);
    assert.equal(
      (await lineState(drift.items[0]!.id)).pickedQty,
      0,
      'Data qty migrasi tidak boleh dipakai melewati cap',
    );

    const concurrent = await document('concurrent', [{ ...a, boxes: 3, qty: 60 }]);
    const overlaps = await Promise.all([
      batch(concurrent.id, [tag('C1'), tag('C2')]),
      batch(concurrent.id, [tag('C2'), tag('C3'), tag('C4')]),
    ]);
    const combined = overlaps.flatMap((r) => r.results);
    assert.equal(combined.filter((r) => r.status === 'ACCEPTED').length, 3);
    assert.equal(combined.filter((r) => r.status === 'DUPLICATE').length, 1);
    assert.equal(combined.filter((r) => r.status === 'REJECTED').length, 1);
    assert.equal((await lineState(concurrent.items[0]!.id)).pickedKanban, 3);
    assert.equal((await lineState(concurrent.items[0]!.id)).pickedQty, 60);

    const duplicates = await document('same-part-items', [
      { ...a, boxes: 1, qty: 20 },
      { ...a, boxes: 1, qty: 20 },
    ]);
    statuses(await batch(duplicates.id, [tag('L1'), tag('L2'), tag('L3')]), [
      'ACCEPTED',
      'ACCEPTED',
      'REJECTED',
    ]);
    assert.equal((await lineState(duplicates.items[0]!.id)).pickedKanban, 1);
    assert.equal((await lineState(duplicates.items[1]!.id)).pickedKanban, 1);

    const undo = await document('undo', [{ ...a, boxes: 1, qty: 20 }]);
    const undoTag = tag('UNDO-1', a.customerPart, 'SHORT');
    statuses(await batch(undo.id, [undoTag, tag('UNDO-OVER')]), ['ACCEPTED', 'REJECTED']);
    await service.undoScan(undo.id, undo.items[0]!.id, 'PULLING', admin, 'QA salah posisi tag');
    assert.equal((await lineState(undo.items[0]!.id)).pickedKanban, 0);
    statuses(await batch(undo.id, [undoTag, undoTag]), ['ACCEPTED', 'DUPLICATE']);
    assert.equal((await lineState(undo.items[0]!.id)).pickedKanban, 1);
    assert.equal((await lineState(undo.items[0]!.id)).pickedQty, 20);

    const maximum = await document('maximum-batch', [{ ...a, boxes: 200, qty: 4000 }]);
    const maximumTags = Array.from({ length: 200 }, (_, index) => tag(`MAX-${index}`));
    const started = Date.now();
    statuses(
      await batch(maximum.id, maximumTags),
      maximumTags.map(() => 'ACCEPTED'),
    );
    const acceptedMs = Date.now() - started;
    const replayStarted = Date.now();
    statuses(
      await batch(maximum.id, maximumTags),
      maximumTags.map(() => 'DUPLICATE'),
    );
    const replayMs = Date.now() - replayStarted;
    assert.equal((await lineState(maximum.items[0]!.id)).pickedKanban, 200);
    assert.equal((await lineState(maximum.items[0]!.id)).pickedQty, 4000);
    console.log(
      `RFID 200-tag fixture: accept ${acceptedMs} ms, replay ${replayMs} ms (local PG; no timing threshold).`,
    );

    const method = await document('method-isolation', [{ ...a, boxes: 2, qty: 40 }]);
    const internalSerial = `${suffix}-INTERNAL`;
    const [internalCard] = await db
      .insert(kanbans)
      .values({
        plantId,
        partId: a.partId,
        serialNumber: internalSerial,
        owner: 'INTERNAL',
        status: 'PRODUCED',
        qtyPerBox: a.perBox,
      })
      .returning();
    kanbanIds.push(internalCard!.id);
    await db.insert(kanbanItems).values({
      kanbanId: internalCard!.id,
      serialNumber: `${suffix}-UNIT`,
      attachedAt: new Date(),
    });
    const manual = () =>
      service.scan(
        {
          deliveryId: method.id,
          phase: 'PULLING',
          customerPart: a.customerPart,
          internalKanban: `RFA|${internalSerial}`,
          clientRef: randomUUID(),
        },
        admin,
      );
    assert.equal((await manual()).status, 'ACCEPTED');
    try {
      statuses(await batch(method.id, [tag('METHOD')]), ['REJECTED']);
    } catch (error) {
      const code = (error as { getStatus?: () => number }).getStatus?.();
      assert(code === 400 || code === 409, 'RFID tidak boleh bercampur dengan scan barcode aktif');
    }
    assert.equal((await lineState(method.items[0]!.id)).pickedKanban, 1);
    await service.undoScan(
      method.id,
      method.items[0]!.id,
      'PULLING',
      admin,
      'QA ganti barcode ke RFID',
    );
    statuses(await batch(method.id, [tag('METHOD')]), ['ACCEPTED']);
    await assert.rejects(
      manual(),
      (error: unknown) => {
        const code = (error as { getStatus?: () => number }).getStatus?.();
        return code === 400 || code === 409;
      },
      'Scan barcode tidak boleh bercampur dengan RFID aktif',
    );
    assert.equal((await lineState(method.items[0]!.id)).pickedKanban, 1);
    await service.undoScan(
      method.id,
      method.items[0]!.id,
      'PULLING',
      admin,
      'QA ganti RFID ke barcode',
    );
    assert.equal(
      (await manual()).status,
      'ACCEPTED',
      'Undo seluruh scan membuka perpindahan metode',
    );
    assert.equal((await lineState(method.items[0]!.id)).pickedKanban, 1);

    const authorized = await document('authorized', [{ ...a, boxes: 3, qty: 60 }]);
    statuses(await batch(authorized.id, [tag('USER')], scanner), ['ACCEPTED']);
    statuses(await batch(authorized.id, [tag('READER')], reader(0)), ['ACCEPTED']);
    statuses(
      await batch(
        authorized.id,
        [{ tagId: `${suffix}-${'E'.repeat(127 - suffix.length)}`, customerPart: a.customerPart }],
        reader(0),
      ),
      ['ACCEPTED'],
    );
    await db.update(devices).set({ isActive: false }).where(eq(devices.id, deviceRows[0]!.id));
    await denied(batch(authorized.id, [tag('READER-NOW-OFF')], reader(0)));

    const closed = await document('closed', [{ ...a, boxes: 2, qty: 40 }]);
    statuses(await batch(closed.id, [tag('CLOSE-OK')]), ['ACCEPTED']);
    for (const status of ['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED', 'CANCELLED'] as const) {
      await db.update(deliveries).set({ status }).where(eq(deliveries.id, closed.id));
      try {
        const deniedResult = await batch(closed.id, [tag(`AFTER-${status}`)]);
        statuses(deniedResult, ['REJECTED']);
      } catch (error) {
        const code = (error as { getStatus?: () => number }).getStatus?.();
        assert(
          code === 400 || code === 409,
          `Dokumen ${status} harus ditolak sebagai validasi bisnis`,
        );
      }
      assert.equal((await lineState(closed.items[0]!.id)).pickedKanban, 1);
    }

    assert.equal(
      (await db.select().from(mutations).where(eq(mutations.plantId, plantId))).length,
      0,
      'Scan RFID tidak boleh membuat mutasi stok',
    );
    assert.equal(
      (await db.select().from(sapOutbox).where(eq(sapOutbox.plantId, plantId))).length,
      0,
      'Scan RFID tidak boleh memicu GI/outbox sebelum Finish Pulling',
    );
    const audit = await db.select().from(scanEvents).where(eq(scanEvents.plantId, plantId));
    assert(
      audit.some((r) => r.qty > 0),
      'Scan diterima menyimpan jejak audit',
    );
    assert(
      audit.some((r) => (r.meta as { action?: string } | null)?.action === 'UNDO'),
      'Undo tetap append-only',
    );
    console.log(
      'PASS delivery RFID: mixed/retry, 200 tags, payload conflict, active delivery, short serial, concurrent cap, box/pcs limits, item allocation, undo, method isolation/switch, auth/device, schema, and no stock/SAP writes.',
    );
  } finally {
    if (plantIds.length) {
      await db.delete(scanEvents).where(inArray(scanEvents.plantId, plantIds));
      await db.delete(mutations).where(inArray(mutations.plantId, plantIds));
      await db.delete(sapOutbox).where(inArray(sapOutbox.plantId, plantIds));
    }
    if (documentIds.length) {
      await db.delete(deliveryLines).where(inArray(deliveryLines.deliveryId, documentIds));
      await db.delete(deliveries).where(inArray(deliveries.id, documentIds));
    }
    if (customerId)
      await db.delete(deliveryOrders).where(eq(deliveryOrders.customerId, customerId));
    if (customerId) await db.delete(customerParts).where(eq(customerParts.customerId, customerId));
    if (kanbanIds.length) {
      await db.delete(kanbanEvents).where(inArray(kanbanEvents.kanbanId, kanbanIds));
      await db.delete(kanbanItems).where(inArray(kanbanItems.kanbanId, kanbanIds));
      await db.delete(kanbans).where(inArray(kanbans.id, kanbanIds));
    }
    if (partIds.length) await db.delete(parts).where(inArray(parts.id, partIds));
    if (plantIds.length) {
      await db.delete(devices).where(inArray(devices.plantId, plantIds));
      await db.delete(lines).where(inArray(lines.plantId, plantIds));
      await db.delete(locations).where(inArray(locations.plantId, plantIds));
    }
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    if (plantIds.length) await db.delete(plants).where(inArray(plants.id, plantIds));
    console.log(
      'RFID QA cleanup: hanya fixture ber-ID/pabrik unik milik pengujian yang dihapus; trial pengguna tidak disentuh.',
    );
  }
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
