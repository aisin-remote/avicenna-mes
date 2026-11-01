import { BadRequestException } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  sql,
  deliveries,
  deliveryLines,
  deliveryOrders,
  customers,
  customerParts,
  parts,
  plants,
  locations,
  type Database,
} from '@avicenna/db';
import { deliveryOrderPreview, deliveryOrderQr } from '@avicenna/domain';
import type { DeliveryOrderSnapshot } from '@avicenna/contracts';
import { queueDeliveryStage } from './delivery-flow';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Lock sebelum mengunci loading list: dua operator satu PDS tidak menerbitkan DO ganda. */
export async function lockDeliveryOrder(tx: Transaction, customerId: number, pds: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['DO', customerId, pds.trim()])}, 0))`,
  );
}

export async function prepareDeliveryOrder(
  tx: Transaction,
  customerId: number,
  pdsNumber: string,
  now: Date,
  userId: number | null,
) {
  const [existing] = await tx
    .select()
    .from(deliveryOrders)
    .where(and(eq(deliveryOrders.customerId, customerId), eq(deliveryOrders.pdsNumber, pdsNumber)));
  if (existing?.intercompany) return existing.number;
  const group = await tx
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.customerId, customerId),
        sql`btrim(${deliveries.pdsNumber}) = ${pdsNumber}`,
        sql`${deliveries.status} <> 'CANCELLED'`,
      ),
    )
    .orderBy(deliveries.id);
  if (group.some((d) => !['PICKED', 'LOADING', 'SHIPPED', 'RECEIVED'].includes(d.status)))
    return null;
  const [customer] = await tx.select().from(customers).where(eq(customers.id, customerId));
  if (!customer || !group.length)
    throw new BadRequestException('Customer atau PDS tidak ditemukan');
  const lines = await tx
    .select({
      id: deliveryLines.id,
      deliveryId: deliveryLines.deliveryId,
      partId: deliveryLines.partId,
      partNumber: parts.partNumber,
      partName: parts.name,
      uom: parts.uom,
      customerPartNumber: sql<
        string | null
      >`COALESCE(${deliveryLines.customerPartNumberSource}, ${customerParts.customerPartNumber})`,
      qtyPerKanban: deliveryLines.qtyPerKanban,
      pickedKanban: deliveryLines.pickedKanban,
      pickedQty: deliveryLines.pickedQty,
    })
    .from(deliveryLines)
    .leftJoin(parts, eq(parts.id, deliveryLines.partId))
    .leftJoin(customerParts, eq(customerParts.id, deliveryLines.customerPartId))
    .where(
      inArray(
        deliveryLines.deliveryId,
        group.map((d) => d.id),
      ),
    )
    .orderBy(deliveryLines.deliveryId, deliveryLines.id);
  const distinct = (values: (string | null)[]) => [
    ...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v)),
  ];
  const manifests = distinct(group.map((d) => d.manifestNumber));
  const qr = deliveryOrderQr(manifests.length === 1 ? manifests[0]! : null, pdsNumber)!;
  const actual = deliveryOrderPreview({
    status: 'PICKED',
    manifestNumber: qr.value,
    pdsNumber,
    lines,
  });
  if (!actual.available) throw new BadRequestException(actual.reason);
  const contexts = await tx
    .select({
      deliveryId: deliveries.id,
      plantCode: plants.sapCode,
      stagingLocationCode: locations.code,
    })
    .from(deliveries)
    .leftJoin(plants, eq(plants.id, deliveries.plantId))
    .leftJoin(locations, eq(locations.id, deliveries.stagingLocationId))
    .where(
      inArray(
        deliveries.id,
        group.map((d) => d.id),
      ),
    );
  const snapshot: DeliveryOrderSnapshot = {
    deliveryIds: group.map((d) => d.id),
    pdsNumber,
    qr,
    customerCode: customer.code,
    customerName: customer.name,
    documentNumbers: distinct(group.map((d) => d.documentNumber)),
    deliveryDates: distinct(group.map((d) => d.deliveryDate)),
    deliveryLocations: distinct(group.map((d) => d.dock)),
    purchaseOrderNumbers: distinct(group.map((d) => d.purchaseOrderNumber)),
    planTimes: distinct(group.map((d) => d.planTime)),
    lines: lines
      .filter((l) => l.pickedKanban > 0)
      .map((l) => {
        const parent = group.find((d) => d.id === l.deliveryId)!;
        const context = contexts.find((c) => c.deliveryId === l.deliveryId);
        if (!parent.stagingLocationId)
          throw new BadRequestException('SLOC staging wajib tersedia untuk pengiriman.');
        return {
          ...l,
          plantId: parent.plantId,
          stagingLocationId: parent.stagingLocationId,
          ...context,
        };
      }),
  };
  const values = {
    customerId,
    pdsNumber,
    snapshot,
    preparedAt: now,
    issuedById: userId,
    intercompany: true,
  };
  const [issued] = existing
    ? await tx
        .update(deliveryOrders)
        .set(values)
        .where(eq(deliveryOrders.id, existing.id))
        .returning()
    : await tx.insert(deliveryOrders).values(values).returning();
  await tx
    .update(deliveries)
    .set({ deliveryOrderId: issued!.id })
    .where(
      inArray(
        deliveries.id,
        group.map((d) => d.id),
      ),
    );
  await queueDeliveryStage(tx, issued!, 'DELIVERY_GI_AIIA', now);
  return null;
}
