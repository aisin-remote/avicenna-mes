import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import {
  customerParts,
  customers,
  deliveries,
  deliveryLines,
  kanbanItems,
  kanbans,
  locations,
  mutations,
  parts,
  plants,
} from './schema/index';

const CUSTOMER_CODE = 'TRIAL3W';
const CUSTOMER_PART = 'TRIAL-CUST-001';

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
      .map((part) => [part.type, part.value]),
  );
  const at = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
  return new Date(Number(fields.hour) < 6 ? at - 86_400_000 : at).toISOString().slice(0, 10);
}

async function main() {
  const db = getDb();
  const date = operationalDate();
  const dateKey = date.replaceAll('-', '');
  const documentNumber = `LL-TRIAL-${dateKey}-01`;
  const manifestNumber = `MNF-TRIAL-${dateKey}`;
  const cardSerials = [`TRIAL-${dateKey}-01`, `TRIAL-${dateKey}-02`];

  const [plant] = await db.select().from(plants).orderBy(plants.id).limit(1);
  if (!plant) throw new Error('Belum ada plant. Jalankan pnpm db:seed lebih dulu.');

  const [part] = await db
    .select()
    .from(parts)
    .where(and(eq(parts.plantId, plant.id), eq(parts.partNumber, 'AV-12345-001')))
    .limit(1);
  if (!part) throw new Error('Part AV-12345-001 belum ada. Jalankan pnpm db:seed lebih dulu.');

  const plantLocations = await db.select().from(locations).where(eq(locations.plantId, plant.id));
  const source = plantLocations.find((location) => location.code === 'PP02');
  const staging = plantLocations.find((location) => location.code === 'PP04');
  if (!source || !staging) throw new Error('SLOC PP02/PP04 belum ada. Jalankan pnpm db:seed.');

  let [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.code, CUSTOMER_CODE))
    .limit(1);
  if (!customer) {
    await db.insert(customers).values({
      code: CUSTOMER_CODE,
      name: 'Customer Trial 3-Way Matching',
      dock: 'TRIAL',
      partNumberFormat: 'NONE',
      directKanban: false,
    });
    [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.code, CUSTOMER_CODE))
      .limit(1);
  }
  if (!customer) throw new Error('Customer trial gagal dibuat.');

  let [customerPart] = await db
    .select()
    .from(customerParts)
    .where(
      and(
        eq(customerParts.customerId, customer.id),
        eq(customerParts.customerPartNumber, CUSTOMER_PART),
      ),
    )
    .limit(1);
  if (!customerPart) {
    await db.insert(customerParts).values({
      partId: part.id,
      customerId: customer.id,
      customerPartNumber: CUSTOMER_PART,
      customerBackNumber: 'TRIAL-BACK',
      qtyPerKanban: 20,
    });
    [customerPart] = await db
      .select()
      .from(customerParts)
      .where(
        and(
          eq(customerParts.customerId, customer.id),
          eq(customerParts.customerPartNumber, CUSTOMER_PART),
        ),
      )
      .limit(1);
  }
  if (!customerPart) throw new Error('Mapping part customer trial gagal dibuat.');

  for (const serialNumber of cardSerials) {
    let [card] = await db
      .select()
      .from(kanbans)
      .where(and(eq(kanbans.partId, part.id), eq(kanbans.serialNumber, serialNumber)))
      .limit(1);
    if (!card) {
      await db.insert(kanbans).values({
        plantId: plant.id,
        partId: part.id,
        serialNumber,
        qtyPerBox: 20,
        unitPerKanban: 1,
        owner: 'INTERNAL',
        status: 'PRODUCED',
        producedAt: new Date(),
      });
      [card] = await db
        .select()
        .from(kanbans)
        .where(and(eq(kanbans.partId, part.id), eq(kanbans.serialNumber, serialNumber)))
        .limit(1);
    }
    if (!card) throw new Error(`Kanban ${serialNumber} gagal dibuat.`);

    const itemSerial = `UNIT-${serialNumber}`;
    const [item] = await db
      .select({ id: kanbanItems.id })
      .from(kanbanItems)
      .where(eq(kanbanItems.serialNumber, itemSerial))
      .limit(1);
    if (!item) {
      await db.insert(kanbanItems).values({
        kanbanId: card.id,
        serialNumber: itemSerial,
        attachedAt: new Date(),
      });
    }
  }

  let [delivery] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.plantId, plant.id), eq(deliveries.documentNumber, documentNumber)))
    .limit(1);
  if (!delivery) {
    await db.insert(deliveries).values({
      plantId: plant.id,
      customerId: customer.id,
      documentNumber,
      manifestNumber,
      pdsNumber: `PDS-TRIAL-${dateKey}`,
      purchaseOrderNumber: `PO-TRIAL-${dateKey}`,
      salesOrganization: 'J901',
      distributionChannel: 'C1',
      division: '01',
      deliveryType: 'ZMAK',
      sapGiStatus: 'A',
      qcStatus: '0',
      deliveryDate: date,
      cycle: 1,
      dock: 'TRIAL',
      locationId: source.id,
      stagingLocationId: staging.id,
      status: 'PICKED',
      truckStatus: 'ARRIVED',
      truckNumber: 'B 1234 TRL',
      driverName: 'Driver Trial',
    });
    [delivery] = await db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.plantId, plant.id), eq(deliveries.documentNumber, documentNumber)))
      .limit(1);
  }
  if (!delivery) throw new Error('Loading list trial gagal dibuat.');
  if (delivery.status === 'SHIPPED' || delivery.status === 'RECEIVED') {
    throw new Error(`${documentNumber} sudah selesai; ubah suffix dokumen untuk trial baru.`);
  }

  const [line] = await db
    .select()
    .from(deliveryLines)
    .where(and(eq(deliveryLines.deliveryId, delivery.id), eq(deliveryLines.partId, part.id)))
    .limit(1);
  const lineValues = {
    customerPartId: customerPart.id,
    sapItemNumber: '000010',
    sapDeliveryQty: 40,
    itemType: 'ZMAK',
    plannedKanban: 2,
    plannedQty: 40,
    qtyPerKanban: 20,
    pickedKanban: 2,
    pickedQty: 40,
    actualKanban: 0,
    actualQty: 0,
  };
  if (!line) {
    await db.insert(deliveryLines).values({
      deliveryId: delivery.id,
      partId: part.id,
      ...lineValues,
    });
  }

  const stockNote = `Dummy stok staging untuk ${documentNumber}`;
  const [stock] = await db
    .select({ id: mutations.id })
    .from(mutations)
    .where(eq(mutations.note, stockNote))
    .limit(1);
  if (!stock) {
    await db.insert(mutations).values({
      plantId: plant.id,
      partId: part.id,
      locationId: staging.id,
      type: 'ADJUSTMENT',
      qty: '40',
      occurredAt: new Date(),
      note: stockNote,
    });
  }

  console.log(`[trial] manifest/loading list: ${manifestNumber} / ${documentNumber}`);
  cardSerials.forEach((serial, index) => {
    console.log(
      `[trial] box ${index + 1}: customer=${CUSTOMER_CODE}~${CUSTOMER_PART}~${documentNumber}~${index + 1}`,
    );
    console.log(`[trial] box ${index + 1}: internal=TRIAL-BACK|${serial}`);
  });
}

main()
  .catch((error) => {
    console.error(`[trial] gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
