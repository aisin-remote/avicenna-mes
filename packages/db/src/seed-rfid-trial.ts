import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import {
  customerParts,
  customers,
  deliveries,
  deliveryLines,
  devices,
  locations,
  mutations,
  parts,
  plants,
} from './schema/index';

/**
 * Data trial untuk POST /loading/rfid/batch: satu perangkat RFID aktif dengan
 * token yang diketahui, dan satu loading list DRAFT berisi dua part.
 *
 *   pnpm --filter @avicenna/db db:seed-rfid-trial
 *
 * RFID_TRIAL_RUN=2 membuat loading list baru; run yang sama dijalankan ulang
 * hanya mencetak datanya lagi (progres scan lama tidak direset).
 */
const ITEMS = [
  { letter: 'A', name: 'PART RFID TRIAL A', perBox: 20, kanban: 3 },
  { letter: 'B', name: 'PART RFID TRIAL B', perBox: 10, kanban: 2 },
];

function operationalDate(): string {
  const f = Object.fromEntries(
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
  const day = Date.UTC(Number(f.year), Number(f.month) - 1, Number(f.day));
  return new Date(Number(f.hour) < 6 ? day - 86_400_000 : day).toISOString().slice(0, 10);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw Error('Seed RFID trial hanya untuk lokal/UAT.');
  if ((process.env.STAGING_PUSH_ENABLED ?? '').trim().toLowerCase() === 'true')
    throw Error('Matikan push staging nyata sebelum membuat dummy.');
  const runNumber = Number(process.env.RFID_TRIAL_RUN ?? 1);
  assert(Number.isInteger(runNumber) && runNumber >= 1 && runNumber <= 99, 'RFID_TRIAL_RUN harus 1–99.');
  const date = operationalDate(),
    dateKey = date.replaceAll('-', ''),
    run = String(runNumber).padStart(2, '0');
  const documentNumber = `LL-RFID-${dateKey}-${run}`;
  const deviceCode = process.env.RFID_DEVICE_CODE ?? 'RFID-TRIAL-01';
  const deviceToken = process.env.RFID_DEVICE_TOKEN ?? 'rfid-trial-123';
  const db = getDb();

  const doc = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${documentNumber},0))`);
    const [existing] = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.documentNumber, documentNumber));
    if (existing) return existing;

    const allPlants = await tx.select().from(plants).orderBy(plants.id);
    const plant = allPlants.find((p) => p.code.toUpperCase() === 'BODY') ?? allPlants[0];
    assert(plant, 'Jalankan seed master plant lebih dulu.');
    const slocs = await tx.select().from(locations).where(eq(locations.plantId, plant.id));
    const fg = slocs.find((l) => l.kind === 'FINISH_GOOD'),
      staging = slocs.find((l) => l.kind === 'STAGING');
    assert(fg && staging, 'SLOC FG dan staging belum tersedia.');

    let [customer] = await tx.select().from(customers).where(eq(customers.code, 'TRIAL-RFID'));
    if (!customer)
      [customer] = await tx
        .insert(customers)
        .values({
          code: 'TRIAL-RFID',
          name: 'CUSTOMER DUMMY RFID',
          dock: 'DOCK RFID',
          partNumberFormat: 'NONE',
          directKanban: false,
        })
        .returning();
    assert(customer?.isActive, 'Customer TRIAL-RFID nonaktif.');

    const [created] = await tx
      .insert(deliveries)
      .values({
        plantId: plant.id,
        customerId: customer.id,
        documentNumber,
        manifestNumber: `MNF-RFID-${dateKey}-${run}`,
        pdsNumber: `PDS-RFID-${dateKey}-${run}`,
        deliveryDate: date,
        cycle: 1,
        dock: 'DOCK RFID',
        planTime: '13:00:00',
        locationId: fg.id,
        stagingLocationId: staging.id,
        status: 'DRAFT',
        truckStatus: 'ARRIVED',
      })
      .returning();
    assert(created);

    for (const [i, item] of ITEMS.entries()) {
      const partNumber = `TR-RFID-${item.letter}-${dateKey}-${run}`;
      const [part] = await tx
        .insert(parts)
        .values({
          plantId: plant.id,
          partNumber,
          name: item.name,
          backNumber: `RF${item.letter}`,
          processType:
            plant.code.toUpperCase() === 'BODY' ? 'ASSEMBLING_BODY_FG' : 'ASSEMBLING_UNIT_FG',
          partType: 'FINISHED_GOOD',
          trackingMode: 'QUANTITY',
          uom: 'PC',
          qtyPerKanban: item.perBox,
        })
        .returning();
      assert(part);
      // Format NONE: customerPart di tag RFID = nomor part customer ini apa adanya.
      const [mapping] = await tx
        .insert(customerParts)
        .values({
          customerId: customer.id,
          partId: part.id,
          customerPartNumber: `C-${partNumber}`,
          customerBackNumber: `RF${item.letter}`,
          qtyPerKanban: item.perBox,
        })
        .returning();
      assert(mapping);
      const qty = item.perBox * item.kanban;
      await tx.insert(deliveryLines).values({
        deliveryId: created.id,
        partId: part.id,
        customerPartId: mapping.id,
        customerPartNumberSource: mapping.customerPartNumber,
        sapItemNumber: String((i + 1) * 10).padStart(6, '0'),
        sapDeliveryQty: qty,
        plannedKanban: item.kanban,
        plannedQty: qty,
        qtyPerKanban: item.perBox,
      });
      // Stok FG cukup supaya tutup pulling tidak berakhir dengan kekurangan saldo.
      await tx.insert(mutations).values({
        plantId: plant.id,
        partId: part.id,
        locationId: fg.id,
        type: 'ADJUSTMENT',
        qty: String(qty),
        occurredAt: new Date(),
        note: `Dummy stok FG untuk ${documentNumber}`,
      });
    }
    return created;
  });

  // Token di-reset setiap seed supaya selalu cocok dengan yang dicetak di bawah.
  await db
    .insert(devices)
    .values({
      code: deviceCode,
      name: 'RFID READER TRIAL',
      plantId: doc.plantId,
      kind: 'RFID',
      tokenHash: await bcrypt.hash(deviceToken, 10),
    })
    .onConflictDoUpdate({
      target: devices.code,
      set: {
        plantId: doc.plantId,
        kind: 'RFID',
        isActive: true,
        tokenHash: await bcrypt.hash(deviceToken, 10),
      },
    });

  const lines = await db
    .select({
      customerPart: deliveryLines.customerPartNumberSource,
      plannedKanban: deliveryLines.plannedKanban,
      pickedKanban: deliveryLines.pickedKanban,
    })
    .from(deliveryLines)
    .where(eq(deliveryLines.deliveryId, doc.id))
    .orderBy(deliveryLines.id);
  assert.equal(lines.length, ITEMS.length);

  console.log(
    JSON.stringify(
      {
        postman: {
          deviceCode,
          deviceToken,
          documentCode: documentNumber,
          deliveryId: doc.id,
          customerPart: lines[0]!.customerPart,
        },
        status: doc.status,
        manifestNumber: doc.manifestNumber,
        lines,
        contohBody: {
          deliveryId: doc.id,
          tags: [
            { tagId: `EPC-${dateKey}-${run}-001`, customerPart: lines[0]!.customerPart },
            { tagId: `EPC-${dateKey}-${run}-002`, customerPart: lines[1]!.customerPart },
            { tagId: `EPC-${dateKey}-${run}-999`, customerPart: 'PART-TIDAK-ADA' },
          ],
        },
      },
      null,
      2,
    ),
  );
  if (doc.status !== 'DRAFT')
    console.log('[trial] Progres lama dipertahankan. Pakai RFID_TRIAL_RUN berikutnya untuk trial baru.');
}

void main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
