import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  getDb,
  closeDb,
  eq,
  and,
  sql,
  parts,
  plants,
  customers,
  customerParts,
  locations,
  deliveries,
  kanbans,
  kanbanItems,
  mutations,
  sapOutbox,
  deliverySyncs,
} from '@avicenna/db';
import { productionDayWindow, DELIVERY_DAY_START_HOUR } from '@avicenna/domain';
import { LoadingService } from './loading.service';
import { StagingPullService } from '../staging/staging-pull.service';
import type { StagingDbService } from '../staging/staging-db.service';
import { SapOutboxService } from '../sap/sap-outbox.service';

/** Check opt-in: membuat fixture QA sendiri, tidak mengubah transaksi/master lama. */
async function main() {
  if (process.env.DELIVERY_TRIAL_CHECK !== 'true')
    throw new Error('Set DELIVERY_TRIAL_CHECK=true untuk membuat fixture QA lokal.');
  if ((process.env.STAGING_PUSH_ENABLED ?? '').toLowerCase() === 'true')
    throw new Error('Matikan push staging sebelum trial.');
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const date = productionDayWindow(now, DELIVERY_DAY_START_HOUR).key;
  const number = `LL-TRIAL-QA-${suffix}`;
  const customerCode = `QA-${suffix}`;
  const customerPart = `QA-PART-${suffix}`;
  const [plant] = await db.select().from(plants).orderBy(plants.id).limit(1);
  assert(plant, 'Butuh plant lokal');
  const slocs = await db.select().from(locations).where(eq(locations.plantId, plant.id));
  const source = slocs.find((row) => row.code === 'PP02');
  const staging = slocs.find((row) => row.code === 'PP04');
  assert(source && staging, 'Butuh PP02 dan PP04');
  await db.insert(parts).values({
    plantId: plant.id,
    partNumber: `QA-DEL-${suffix}`,
    name: 'Part QA Delivery',
    processType: 'ASSEMBLING_UNIT',
    qtyPerKanban: 20,
    trackingMode: 'QUANTITY',
  });
  const [part] = await db
    .select()
    .from(parts)
    .where(eq(parts.partNumber, `QA-DEL-${suffix}`));
  assert(part);
  await db.insert(customers).values({
    code: customerCode,
    name: `Customer QA Delivery ${suffix}`,
    partNumberFormat: 'NONE',
  });
  const [customer] = await db.select().from(customers).where(eq(customers.code, customerCode));
  assert(customer);
  await db
    .insert(customerParts)
    .values({ customerId: customer.id, partId: part.id, customerPartNumber: customerPart });
  const serials = [1, 2, 3].map((index) => `QA-${suffix}-${index}`);
  for (const serial of serials) {
    await db.insert(kanbans).values({
      plantId: plant.id,
      partId: part.id,
      serialNumber: serial,
      qtyPerBox: 20,
      unitPerKanban: 1,
      owner: 'INTERNAL',
      status: 'PRODUCED',
      producedAt: now,
    });
    const [card] = await db
      .select()
      .from(kanbans)
      .where(and(eq(kanbans.partId, part.id), eq(kanbans.serialNumber, serial)));
    assert(card);
    await db
      .insert(kanbanItems)
      .values({ kanbanId: card.id, serialNumber: `UNIT-${serial}`, attachedAt: now });
  }
  await db.insert(mutations).values({
    plantId: plant.id,
    partId: part.id,
    locationId: source.id,
    type: 'ADJUSTMENT',
    qty: '60',
    occurredAt: now,
    note: `Stok fixture ${number}`,
  });
  const base = {
    delNo: `${number}   `,
    customerCode: `${customerCode} `,
    destination: 'QA',
    manifestNumber: `MNF-${suffix}`,
    pdsNumber: `PDS-${suffix}`,
    cycle: 1,
    deliveryDate: date.replaceAll('-', ''),
    actualDeliveryDate: '00000000',
    purchaseOrderNumber: 'PO-QA ',
    salesOrganization: 'J901 ',
    distributionChannel: 'C1',
    division: '01',
    deliveryType: 'ZMAK',
    sapGiStatus: 'A ',
    invoiceNumber: 'NULL',
    qcStatus: '0',
    sapHeaderMovementStatus: '0',
    sapLineMovementStatus: '0',
    sapReceiveStatus: '0',
    sapReceiveDate: '00000000',
    sapReceiveTime: 'NULL',
    headerDeleted: '',
    partNumber: `${part.partNumber} `,
    customerPartNumber: `${customerPart} `,
    plannedQty: 20,
    deliveryQty: 20,
    qtyPerBox: 20,
    itemType: 'ZMAK',
    lineDeleted: '',
  };
  let rows = [
    { ...base, deliveryItem: '000010' },
    { ...base, deliveryItem: '000020' },
    {
      ...base,
      delNo: `LL-TRIAL-MISSING-${suffix}`,
      customerCode: 'QA-NO-MASTER',
      deliveryItem: '000010',
    },
  ];
  const mockStaging = {
    tarikAktif: true,
    terkonfigurasi: true,
    query: async () => rows,
  } as unknown as StagingDbService;
  const importer = new StagingPullService(db, mockStaging);
  const imported = await importer.tarikPengiriman(now, false);
  assert.equal(imported.baru, 1);
  assert.equal(imported.dilewati, 1);
  const [doc] = await db.select().from(deliveries).where(eq(deliveries.documentNumber, number));
  assert(doc);
  assert.equal(doc.purchaseOrderNumber, 'PO-QA');
  assert.equal(doc.invoiceNumber, null);
  assert.equal(doc.sapActualDeliveryDate, null);
  assert.equal(doc.sapGiStatus, 'A');
  const service = new LoadingService(db);
  assert.equal((await service.findOne(doc.id)).lines.length, 2, 'Satu part, dua item SAP');
  const validRows = rows;
  rows = validRows.map((row) => ({ ...row, deliveryItem: '000010' }));
  assert.equal(
    (await importer.tarikPengiriman(now, false)).dilewati,
    2,
    'Nomor item duplikat ditahan',
  );
  rows = validRows.map((row) => ({ ...row, plannedQty: -1 }));
  assert.equal((await importer.tarikPengiriman(now, false)).dilewati, 2, 'Qty negatif ditahan');
  rows = validRows;
  await importer.tarikPengiriman(now, false);
  assert.equal(
    (await service.findOne(doc.id)).lines.length,
    2,
    'Impor ulang tidak menggandakan item',
  );
  const pull = (sequence: number, clientRef = randomUUID()) =>
    service.scan({
      deliveryId: doc.id,
      phase: 'PULLING',
      customerPart: `${customerCode}~${customerPart}~${number}~${sequence}`,
      clientRef,
    });
  const ref = randomUUID();
  const first = await pull(1, ref);
  const retry = await pull(1, ref);
  assert.equal(retry.lineId, first.lineId);
  assert.equal(retry.totals.pickedKanban, 1);
  await assert.rejects(pull(1), /sudah discan/);
  const second = await pull(2);
  assert.notEqual(second.lineId, first.lineId, 'Part yang sama mengisi item SAP berikutnya');
  const wrong = await service.scan({
    deliveryId: doc.id,
    phase: 'PULLING',
    customerPart: 'UNKNOWN-PART',
  });
  assert.equal(wrong.status, 'REJECTED');
  await service.undoScan(doc.id, second.lineId!, 'PULLING', undefined, 'Koreksi trial');
  assert.equal((await pull(2)).totals.pickedKanban, 2, 'Kanban dapat discan ulang setelah undo');
  rows = rows.map((row) => ({ ...row, qtyPerBox: 10 }));
  const changed = await importer.tarikPengiriman(now, false);
  assert(changed.catatan.some((note) => note.includes('setelah discan')));
  assert.equal((await service.findOne(doc.id)).lines[0]?.qtyPerKanban, 20);
  const picked = await Promise.allSettled([
    service.completePicking(doc.id),
    service.completePicking(doc.id),
  ]);
  assert.equal(
    picked.filter((value) => value.status === 'fulfilled').length,
    1,
    'Penutupan pulling sekali saja',
  );
  const load = (sequence: number, serial: string) =>
    service.scan({
      deliveryId: doc.id,
      phase: 'LOADING',
      customerPart: `${customerCode}~${customerPart}~${number}~${sequence}`,
      internalKanban: `QA-BACK|${serial}`,
      clientRef: randomUUID(),
    });
  assert.equal((await load(1, 'QA-UNKNOWN')).status, 'REJECTED');
  assert.equal((await load(1, serials[0]!)).status, 'ACCEPTED');
  await assert.rejects(load(2, serials[0]!), /sudah discan/);
  const loadedSecond = await load(2, serials[1]!);
  await service.undoScan(doc.id, loadedSecond.lineId!, 'LOADING', undefined, 'Box tertukar, trial');
  await load(2, serials[1]!);
  const over = await load(3, serials[2]!);
  assert.equal(over.status, 'OVER');
  await service.undoScan(doc.id, over.lineId!, 'LOADING', undefined, 'Koreksi lebih muat');
  const ship = await Promise.allSettled([service.ship(doc.id), service.ship(doc.id)]);
  assert.equal(
    ship.filter((value) => value.status === 'fulfilled').length,
    1,
    'Penutupan pengiriman sekali saja',
  );
  await assert.rejects(
    service.undoScan(doc.id, first.lineId!, 'LOADING', undefined, 'Sudah berangkat'),
    /ditutup/,
  );
  const outbox = new SapOutboxService(db);
  await outbox['buildAndInsert']('TT_DELIVERY', doc.id);
  await outbox['buildAndInsert']('TT_DELIVERY', doc.id);
  const [gi] = await db
    .select()
    .from(sapOutbox)
    .where(
      and(
        eq(sapOutbox.sourceId, doc.id),
        eq(sapOutbox.sourceTable, 'TT_DELIVERY'),
        eq(sapOutbox.docType, 'DELIVERY'),
      ),
    );
  assert(gi);
  assert.equal(gi.isSimulation, true, 'Fixture tidak masuk antrean push produksi');
  await db.execute(sql`UPDATE TT_SAP_OUTBOX o JOIN TT_DELIVERY d ON o.INT_SOURCE_ID = d.INT_ID
    SET o.FLG_SIMULATION = 1 WHERE o.CHR_SOURCE_TABLE = 'TT_DELIVERY' AND d.CHR_DEL_NO LIKE 'LL-TRIAL-%'`);
  assert.equal((await outbox.simulateDelivery(gi.id, 'REJECTED')).status, 'REJECTED');
  assert.equal(
    (await service.list({ page: 1, perPage: 100, query: number, attention: 'only' })).data.length,
    1,
  );
  await outbox.simulateDelivery(gi.id, 'PENDING');
  const confirmation = await outbox.simulateDelivery(gi.id, 'CONFIRMED');
  assert(confirmation.sapDocNumber?.startsWith('SIM-'));
  const returned = await service.receiveReturnedDocument(number);
  assert.equal(returned.status, 'RECEIVED');
  assert.equal((await service.receiveReturnedDocument(number)).alreadyReceived, true);
  const history = await service.history(doc.id);
  assert(
    history.scans.some((event) => (event.meta as { reason?: string })?.reason === 'Koreksi trial'),
  );
  assert.equal(history.movements.filter((event) => event.type === 'DELIVERY_OUT').length, 2);
  const [balance] =
    (
      (await db.execute(
        sql`SELECT SUM(FLT_QTY) AS qty FROM TT_STOCK_MUTATION WHERE INT_PART_ID = ${part.id}`,
      )) as unknown as Array<Array<{ qty: string }>>
    )[0] ?? [];
  assert.equal(Number(balance?.qty), 20);
  await db
    .update(deliverySyncs)
    .set({
      result: {
        ...changed,
        catatan: ['TRIAL lokal: hasil impor dari fixture, bukan koneksi SAP.', ...changed.catatan],
      },
    })
    .where(eq(deliverySyncs.operationalDate, date));
  console.log(`Delivery integration checks passed: ${number}, id=${doc.id}, date=${date}`);
  console.log(
    'Tested: import/item identity, retry/duplicate/undo, mismatch/over, close concurrency, GI simulation, return/audit.',
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
