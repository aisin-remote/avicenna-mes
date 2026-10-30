import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  or,
  sql,
  deliveries,
  deliveryLines,
  deliveryOrders,
  deliveryOrderCounters,
  sapOutbox,
  mutations,
  scanEvents,
  parts,
  lots,
  type Database,
} from '@avicenna/db';
import { deliveryOrderNumber, allocateFifo } from '@avicenna/domain';
import { DELIVERY_SAP_STAGES, type DeliverySapStage, type DeliveryFlow } from '@avicenna/contracts';
import type { Principal } from '../auth/auth.types';
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Order = typeof deliveryOrders.$inferSelect;
type Step = typeof sapOutbox.$inferSelect;
export const DELIVERY_STAGING_HOLD =
  'Kontrak staging SD intercompany belum terkonfirmasi: tabel pemicu, company/plant AII, movement type, idempotency dan flag balasan GI AIIA / GR AII / GI AII.';
const confirmed = (s: Step | undefined) => s?.status === 'CONFIRMED' && !!s.sapDocNumber?.trim();
function validMembers(order: Order, group: (typeof deliveries.$inferSelect)[]) {
  return (
    !!group.length &&
    group.length === order.snapshot.deliveryIds?.length &&
    group.every(
      (d) =>
        order.snapshot.deliveryIds!.includes(d.id) &&
        d.customerId === order.customerId &&
        d.pdsNumber?.trim() === order.pdsNumber &&
        d.status !== 'CANCELLED',
    ) &&
    order.snapshot.lines.every((l) => {
      const d = group.find((d) => d.id === l.deliveryId);
      return d?.plantId === l.plantId && d?.stagingLocationId === l.stagingLocationId;
    })
  );
}

export async function queueDeliveryStage(
  tx: Transaction,
  order: Order,
  stage: DeliverySapStage,
  now: Date,
) {
  const first = order.snapshot.lines[0];
  if (!first?.plantId || !order.snapshot.deliveryIds?.length)
    throw new BadRequestException('Snapshot pengiriman belum memiliki konteks plant/loading list.');
  const [trial] = await tx
    .select({ id: sapOutbox.id })
    .from(sapOutbox)
    .where(
      and(
        eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
        eq(sapOutbox.sourceId, order.id),
        eq(sapOutbox.isSimulation, true),
      ),
    )
    .limit(1);
  await tx
    .insert(sapOutbox)
    .values({
      plantId: first.plantId,
      sourceTable: 'TT_DELIVERY_ORDER',
      sourceId: order.id,
      docType: stage,
      idempotencyKey: `delivery-order:${order.id}:${stage}`,
      status: 'HELD',
      isSimulation:
        !!trial || order.snapshot.documentNumbers.every((number) => number.startsWith('LL-TRIAL-')),
      movementType: null,
      lastError: DELIVERY_STAGING_HOLD,
      occurredAt: now,
      payload: {
        stage,
        company: stage === 'DELIVERY_GI_AIIA' ? 'AIIA' : 'AII',
        destinationCompany:
          stage === 'DELIVERY_GI_AIIA' ? 'AII' : stage === 'DELIVERY_GI_AII' ? 'CUSTOMER' : null,
        orderId: order.id,
        pdsNumber: order.pdsNumber,
        snapshot: order.snapshot,
      },
    })
    .onConflictDoNothing();
}

async function stepsOf(db: Database | Transaction, id: number) {
  return db
    .select()
    .from(sapOutbox)
    .where(
      and(
        eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
        eq(sapOutbox.sourceId, id),
        inArray(sapOutbox.docType, [...DELIVERY_SAP_STAGES]),
      ),
    );
}

export async function readDeliveryFlow(
  db: Database | Transaction,
  id: number,
): Promise<DeliveryFlow | null> {
  const [order] = await db.select().from(deliveryOrders).where(eq(deliveryOrders.id, id));
  if (!order) return null;
  const steps = await stepsOf(db, id);
  const members = await db.select().from(deliveries).where(eq(deliveries.deliveryOrderId, id));
  const gi = steps.find((s) => s.docType === 'DELIVERY_GI_AIIA'),
    gr = steps.find((s) => s.docType === 'DELIVERY_GR_AII'),
    out = steps.find((s) => s.docType === 'DELIVERY_GI_AII');
  const inconsistent = steps
    .filter((s) => confirmed(s))
    .some((s) => s.isSimulation !== !!gi?.isSimulation);
  const stage: DeliveryFlow['stage'] =
    !validMembers(order, members) || !order.intercompany || inconsistent
      ? 'BLOCKED'
      : order.shippedAt
        ? 'SHIPPED'
        : !confirmed(gi)
          ? 'WAITING_GI_AIIA'
          : !confirmed(gr)
            ? 'WAITING_GR_AII'
            : order.driverScannedAt
              ? 'WAITING_GI_AII'
              : order.number && order.issuedAt
                ? 'READY'
                : 'WAITING_GR_AII';
  return {
    orderId: order.id,
    number: order.number,
    pdsNumber: order.pdsNumber,
    customerName: order.snapshot.customerName,
    driverScannedAt: order.driverScannedAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    isSimulation: steps.some((s) => s.isSimulation),
    stage,
    steps: steps.map((s) => ({
      id: s.id,
      type: s.docType as DeliverySapStage,
      status: s.status,
      isSimulation: s.isSimulation,
      sapDocNumber: s.sapDocNumber,
      error: s.lastError,
    })),
  };
}

/** Dipanggil worker setelah membaca balasan; SENT tidak pernah membuka tahap berikutnya. */
export async function advanceDeliveryOrders(db: Database, now = new Date(), orderIds?: number[]) {
  if (orderIds?.length === 0) return;
  const rows = await db
    .select({ id: deliveryOrders.id })
    .from(deliveryOrders)
    .where(
      and(
        eq(deliveryOrders.intercompany, true),
        sql`${deliveryOrders.shippedAt} IS NULL`,
        ...(orderIds ? [inArray(deliveryOrders.id, orderIds)] : []),
      ),
    );
  for (const { id } of rows)
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(deliveryOrders)
        .where(eq(deliveryOrders.id, id))
        .for('update');
      if (!order || order.shippedAt) return;
      const group = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.deliveryOrderId, id))
        .orderBy(deliveries.id)
        .for('update');
      if (!validMembers(order, group)) return;
      const steps = await stepsOf(tx, id);
      const gi = steps.find((s) => s.docType === 'DELIVERY_GI_AIIA'),
        gr = steps.find((s) => s.docType === 'DELIVERY_GR_AII'),
        out = steps.find((s) => s.docType === 'DELIVERY_GI_AII');
      if (!confirmed(gi)) return;
      if (!gr) {
        await queueDeliveryStage(tx, order, 'DELIVERY_GR_AII', now);
        return;
      }
      if (!confirmed(gr) || gi!.isSimulation !== gr.isSimulation) return;
      if (!order.number || !order.issuedAt) {
        const year = Number(
          new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(now),
        );
        const [counter] = !order.number
          ? await tx
              .insert(deliveryOrderCounters)
              .values({ year, lastSerial: 1 })
              .onConflictDoUpdate({
                target: deliveryOrderCounters.year,
                set: { lastSerial: sql`${deliveryOrderCounters.lastSerial} + 1` },
              })
              .returning()
          : [];
        await tx
          .update(deliveryOrders)
          .set({
            ...(counter
              ? {
                  number: deliveryOrderNumber(year, counter.lastSerial),
                  year,
                  serial: counter.lastSerial,
                }
              : {}),
            issuedAt: now,
          })
          .where(eq(deliveryOrders.id, id));
      }
      if (!order.driverScannedAt || !confirmed(out) || out!.isSimulation !== gi!.isSimulation)
        return;
      if (group.some((d) => !['PICKED', 'LOADING'].includes(d.status)))
        throw new ConflictException('Status loading list berubah sebelum konfirmasi GI AII.');
      const partIds = [
        ...new Set(order.snapshot.lines.map((l) => l.partId).filter((id): id is number => !!id)),
      ].sort((a, b) => a - b);
      const tracked = await tx
        .select({ id: parts.id, trackingMode: parts.trackingMode })
        .from(parts)
        .where(inArray(parts.id, partIds))
        .orderBy(parts.id)
        .for('update');
      for (const line of order.snapshot.lines) {
        if (!line.partId || !line.plantId || !line.stagingLocationId || line.pickedQty <= 0)
          throw new BadRequestException('Konteks stok pada snapshot tidak lengkap.');
        const base = {
          plantId: line.plantId,
          partId: line.partId,
          locationId: line.stagingLocationId,
          type: 'DELIVERY_OUT' as const,
          sourceTable: 'TT_DELIVERY_ORDER',
          sourceId: id,
          userId: order.driverScannedById,
          occurredAt: now,
          note: `GI AII ${order.number ?? id} · PDS ${order.pdsNumber}${out!.isSimulation ? ' · SIMULASI' : ''}`,
        };
        if (tracked.find((p) => p.id === line.partId)?.trackingMode === 'LOT') {
          const rows = await tx
            .select({
              lotId: lots.id,
              receivedAt: lots.receivedAt,
              createdAt: lots.createdAt,
              qty: sql<string>`COALESCE(SUM(${mutations.qty}),0)`,
            })
            .from(lots)
            .leftJoin(
              mutations,
              and(eq(mutations.lotId, lots.id), eq(mutations.locationId, line.stagingLocationId)),
            )
            .where(and(eq(lots.partId, line.partId), eq(lots.status, 'OPEN')))
            .groupBy(lots.id, lots.receivedAt, lots.createdAt);
          const { allocations, unallocated } = allocateFifo(
            line.pickedQty,
            rows
              .map((r) => ({
                lotId: r.lotId,
                remainingQty: Number(r.qty),
                receivedAt: r.receivedAt ?? r.createdAt,
              }))
              .filter((r) => r.remainingQty > 0),
          );
          for (const allocation of allocations)
            await tx
              .insert(mutations)
              .values({ ...base, qty: String(-allocation.qty), lotId: allocation.lotId });
          if (unallocated > 0)
            await tx.insert(mutations).values({
              ...base,
              qty: String(-unallocated),
              note: `${base.note} (tanpa lot — stok lot tidak mencukupi)`,
            });
        } else await tx.insert(mutations).values({ ...base, qty: String(-line.pickedQty) });
        await tx
          .update(deliveryLines)
          .set({ actualKanban: line.pickedKanban, actualQty: line.pickedQty })
          .where(and(eq(deliveryLines.id, line.id), eq(deliveryLines.deliveryId, line.deliveryId)));
      }
      await tx
        .update(deliveries)
        .set({ status: 'SHIPPED', truckStatus: 'DEPARTED', departedAt: now })
        .where(eq(deliveries.deliveryOrderId, id));
      await tx.update(deliveryOrders).set({ shippedAt: now }).where(eq(deliveryOrders.id, id));
    });
}

export async function scanDriverDocument(
  db: Database,
  raw: string,
  selectedId: number | undefined,
  principal?: Principal,
) {
  const code = raw.trim();
  if (!code || code.length > 128)
    throw new BadRequestException('Scan manifest, PDS atau nomor surat jalan yang valid.');
  const candidates = await db
    .select({
      id: deliveryOrders.id,
      number: deliveryOrders.number,
      pdsNumber: deliveryOrders.pdsNumber,
      customerName: sql<string>`${deliveryOrders.snapshot}->>'customerName'`,
    })
    .from(deliveryOrders)
    .where(
      and(
        eq(deliveryOrders.intercompany, true),
        or(
          eq(deliveryOrders.number, code),
          eq(deliveryOrders.pdsNumber, code),
          sql`${deliveryOrders.snapshot}->'qr'->>'value' = ${code}`,
        ),
      ),
    )
    .limit(101);
  if (!candidates.length) throw new NotFoundException('Surat jalan tidak ditemukan.');
  if (candidates.length > 100)
    throw new BadRequestException(
      'Manifest memiliki terlalu banyak PDS. Scan nomor PDS atau surat jalan.',
    );
  if (!selectedId && candidates.length > 1) return { selectionRequired: true as const, candidates };
  const chosen = candidates.find((c) => (selectedId ? c.id === selectedId : true));
  if (!chosen) throw new BadRequestException('Surat jalan pilihan tidak cocok dengan barcode.');
  return db.transaction((tx) => recordDriverDeparture(tx, chosen.id, code, principal));
}

/** Dipakai dalam transaksi pickup agar seluruh DO dan akhir sesi tersimpan bersama. */
export async function recordDriverDeparture(
  tx: Transaction,
  orderId: number,
  code: string,
  principal?: Principal,
  attendanceId?: number,
) {
  const [order] = await tx
    .select()
    .from(deliveryOrders)
    .where(eq(deliveryOrders.id, orderId))
    .for('update');
  if (!order) throw new NotFoundException('Surat jalan tidak ditemukan.');
  const flow = await readDeliveryFlow(tx, order.id);
  if (!flow || flow.stage === 'BLOCKED')
    throw new BadRequestException('Alur SAP dokumen ini perlu diperiksa.');
  if (order.driverScannedAt)
    return { selectionRequired: false as const, flow, alreadyScanned: true };
  if (flow.stage !== 'READY')
    throw new BadRequestException(
      'GI AIIA dan GR AII belum dikonfirmasi berhasil. Surat jalan belum boleh dipakai driver.',
    );
  const now = new Date();
  await queueDeliveryStage(tx, order, 'DELIVERY_GI_AII', now);
  await tx
    .update(deliveryOrders)
    .set({
      driverScannedAt: now,
      driverScannedById: principal?.kind === 'user' ? principal.sub : null,
    })
    .where(eq(deliveryOrders.id, order.id));
  await tx.insert(scanEvents).values({
    plantId: order.snapshot.lines[0]!.plantId!,
    kind: 'DELIVERY',
    rawCode: code,
    qty: 0,
    userId: principal?.kind === 'user' ? principal.sub : null,
    scannedAt: now,
    dedupeKey: `delivery-driver:${order.id}`,
    meta: {
      action: attendanceId ? 'DRIVER_PICKUP_FINISH' : 'DRIVER_SCAN',
      ...(attendanceId ? { attendanceId } : {}),
      deliveryOrderId: order.id,
      deliveryIds: order.snapshot.deliveryIds,
    },
  });
  return {
    selectionRequired: false as const,
    flow: (await readDeliveryFlow(tx, order.id))!,
    alreadyScanned: false,
  };
}

export async function receiveDeliveryOrderReturn(
  db: Database,
  code: string,
  principal?: Principal,
) {
  const candidates = await db
    .select({ id: deliveryOrders.id })
    .from(deliveryOrders)
    .where(
      or(
        eq(deliveryOrders.number, code),
        eq(deliveryOrders.pdsNumber, code),
        sql`${deliveryOrders.snapshot}->'qr'->>'value' = ${code}`,
        sql`${deliveryOrders.snapshot}->'documentNumbers' @> ${JSON.stringify([code])}::jsonb`,
      ),
    )
    .limit(2);
  if (!candidates.length) return null;
  if (candidates.length > 1)
    throw new BadRequestException(
      'Manifest menaungi beberapa surat jalan. Scan nomor PDS atau nomor DO yang spesifik.',
    );
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.id, candidates[0]!.id))
      .for('update');
    const flow = await readDeliveryFlow(tx, order!.id);
    if (!flow || flow.stage !== 'SHIPPED')
      throw new BadRequestException(
        'Barang belum berangkat melalui GI AII. Dokumen belum bisa ditandai diterima customer.',
      );
    const group = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.deliveryOrderId, order!.id))
      .orderBy(deliveries.id)
      .for('update');
    const first = group[0];
    if (!first) throw new NotFoundException('Loading list surat jalan tidak ditemukan');
    if (group.some((d) => !['SHIPPED', 'RECEIVED'].includes(d.status)))
      throw new BadRequestException('Status loading list perlu diperiksa.');
    const alreadyReceived = group.every((d) => d.status === 'RECEIVED');
    const now = alreadyReceived ? first.arrivedAt! : new Date();
    if (!alreadyReceived) {
      await tx
        .update(deliveries)
        .set({ status: 'RECEIVED', arrivedAt: now })
        .where(eq(deliveries.deliveryOrderId, order!.id));
      await tx.insert(scanEvents).values({
        plantId: first.plantId,
        kind: 'DELIVERY',
        rawCode: code,
        qty: 0,
        userId: principal?.kind === 'user' ? principal.sub : null,
        scannedAt: now,
        dedupeKey: `delivery-return-order:${order!.id}`,
        meta: {
          action: 'RECEIVE_RETURN',
          deliveryOrderId: order!.id,
          deliveryIds: group.map((d) => d.id),
        },
      });
    }
    return {
      id: first.id,
      documentNumber: order!.number!,
      customerName: order!.snapshot.customerName,
      deliveryDate: first.deliveryDate,
      status: 'RECEIVED' as const,
      receivedAt: now,
      alreadyReceived,
    };
  });
}
