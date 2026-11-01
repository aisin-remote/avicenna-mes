import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import {
  customerParts,
  customers,
  deliveries,
  driverDestinations,
  deliveryLines,
  kanbanItems,
  kanbans,
  locations,
  mutations,
  parts,
  plants,
} from './schema/index';

function operationalDate(): string {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const day = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
  return new Date(Number(fields.hour) < 6 ? day - 86_400_000 : day).toISOString().slice(0, 10);
}

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw Error('Dummy delivery hanya untuk lingkungan lokal/UAT.');
  if ((process.env.STAGING_PUSH_ENABLED ?? '').trim().toLowerCase() === 'true')
    throw Error('Matikan push staging nyata sebelum membuat dummy.');
  const runNumber = Number(process.env.DELIVERY_TRIAL_RUN ?? 1);
  assert(
    Number.isInteger(runNumber) && runNumber >= 1 && runNumber <= 99,
    'DELIVERY_TRIAL_RUN harus 1–99.',
  );
  const date = operationalDate(),
    dateKey = date.replaceAll('-', ''),
    run = String(runNumber).padStart(2, '0');
  const documentNumber = `LL-TRIAL-FULL-${dateKey}-${run}`,
    manifestNumber = `MNF-TRIAL-FULL-${dateKey}-${run}`,
    pdsNumber = `PDS-TRIAL-FULL-${dateKey}-${run}`;
  const customerCode = 'TRIAL-FULL',
    customerPartNumber = `TR-CUST-${dateKey}-${run}`,
    partNumber = `TR-FULL-${dateKey}-${run}`,
    backNumber = 'TF01';
  const serials = [1, 2].map((i) => `TRIAL-${dateKey}-${run}-${String(i).padStart(2, '0')}`);
  const db = getDb();
  const doc = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${documentNumber},0))`);
    const [existing] = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.documentNumber, documentNumber))
      .limit(1);
    if (existing) return existing;
    const allPlants = await tx.select().from(plants).orderBy(plants.id);
    const plant = allPlants.find((p) => p.code.toUpperCase() === 'BODY') ?? allPlants[0];
    assert(plant, 'Jalankan seed master plant lebih dulu.');
    const slocs = await tx.select().from(locations).where(eq(locations.plantId, plant.id));
    const fg = slocs.find((l) => l.kind === 'FINISH_GOOD'),
      staging = slocs.find((l) => l.kind === 'STAGING');
    assert(fg && staging, 'SLOC FG dan staging belum tersedia.');
    let [customer] = await tx.select().from(customers).where(eq(customers.code, customerCode));
    if (!customer)
      [customer] = await tx
        .insert(customers)
        .values({
          code: customerCode,
          name: 'CUSTOMER DUMMY FULL DELIVERY',
          dock: 'DOCK TRIAL',
          partNumberFormat: 'NONE',
          directKanban: false,
        })
        .returning();
    assert(
      customer?.isActive && customer.partNumberFormat === 'NONE' && !customer.directKanban,
      'Konfigurasi customer dummy tidak sesuai.',
    );
    const [part] = await tx
      .insert(parts)
      .values({
        plantId: plant.id,
        partNumber,
        name: 'PART DUMMY FULL DELIVERY',
        backNumber,
        processType:
          plant.code.toUpperCase() === 'BODY' ? 'ASSEMBLING_BODY_FG' : 'ASSEMBLING_UNIT_FG',
        partType: 'FINISHED_GOOD',
        trackingMode: 'QUANTITY',
        uom: 'PC',
        qtyPerKanban: 20,
      })
      .returning();
    assert(part);
    const [mapping] = await tx
      .insert(customerParts)
      .values({
        customerId: customer.id,
        partId: part.id,
        customerPartNumber,
        customerBackNumber: backNumber,
        qtyPerKanban: 20,
      })
      .returning();
    assert(mapping);
    for (const serialNumber of serials) {
      const [card] = await tx
        .insert(kanbans)
        .values({
          plantId: plant.id,
          partId: part.id,
          serialNumber,
          qtyPerBox: 20,
          unitPerKanban: 20,
          owner: 'INTERNAL',
          status: 'PRODUCED',
          producedAt: new Date(),
        })
        .returning();
      assert(card);
      await tx.insert(kanbanItems).values(
        Array.from({ length: 20 }, (_, i) => ({
          kanbanId: card.id,
          serialNumber: `UNIT-${serialNumber}-${String(i + 1).padStart(2, '0')}`,
          attachedAt: new Date(),
        })),
      );
    }
    const [created] = await tx
      .insert(deliveries)
      .values({
        plantId: plant.id,
        customerId: customer.id,
        documentNumber,
        manifestNumber,
        pdsNumber,
        purchaseOrderNumber: `PO-TRIAL-${dateKey}-${run}`,
        deliveryDate: date,
        cycle: 1,
        dock: 'DOCK TRIAL',
        planTime: '13:00:00',
        locationId: fg.id,
        stagingLocationId: staging.id,
        status: 'DRAFT',
        truckStatus: 'ARRIVED',
        truckNumber: 'B 1234 TRL',
        driverName: 'DRIVER DUMMY',
      })
      .returning();
    assert(created);
    await tx.insert(deliveryLines).values({
      deliveryId: created.id,
      partId: part.id,
      customerPartId: mapping.id,
      customerPartNumberSource: customerPartNumber,
      sapItemNumber: '000010',
      sapDeliveryQty: 40,
      plannedKanban: 2,
      plannedQty: 40,
      qtyPerKanban: 20,
      pickedKanban: 0,
      pickedQty: 0,
      actualKanban: 0,
      actualQty: 0,
    });
    await tx.insert(mutations).values({
      plantId: plant.id,
      partId: part.id,
      locationId: fg.id,
      type: 'ADJUSTMENT',
      qty: '40',
      occurredAt: new Date(),
      note: `Dummy stok FG untuk ${documentNumber}`,
    });
    return created;
  });
  await db
    .insert(driverDestinations)
    .values({
      plantId: doc.plantId,
      customerId: doc.customerId,
      code: 'TRIAL-FULL',
      name: 'CUSTOMER DUMMY FULL DELIVERY',
      dock: 'DOCK TRIAL',
      logistic: 'LOGISTIK DUMMY',
    })
    .onConflictDoNothing();
  const lines = await db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, doc.id));
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.plannedKanban, 2);
  assert.equal(lines[0]!.plannedQty, 40);
  assert.equal(lines[0]!.qtyPerKanban, 20);
  const cards = await db.select().from(kanbans).where(eq(kanbans.partId, lines[0]!.partId));
  assert.equal(cards.length, 2);
  for (const serial of serials) {
    const card = cards.find((c) => c.serialNumber === serial);
    assert(card);
    const contents = await db.select().from(kanbanItems).where(eq(kanbanItems.kanbanId, card.id));
    assert.equal(contents.length, 20);
  }
  console.log(
    JSON.stringify({
      id: doc.id,
      date,
      run,
      status: doc.status,
      documentNumber,
      manifestNumber,
      pdsNumber,
      partNumber,
      customerPartNumber,
      pickedKanban: lines[0]!.pickedKanban,
      plannedKanban: 2,
      qtyPerKanban: 20,
      totalQty: 40,
      boxes: serials.map((serial, i) => ({
        box: i + 1,
        customer: `${customerCode}~${customerPartNumber}~${documentNumber}~${i + 1}`,
        internal: `${backNumber}|${serial}`,
      })),
    }),
  );
  if (doc.status !== 'DRAFT')
    console.log(
      '[trial] Progres lama dipertahankan. Gunakan DELIVERY_TRIAL_RUN berikutnya untuk trial baru.',
    );
}
void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
