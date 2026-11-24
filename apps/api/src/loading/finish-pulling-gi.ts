import { and, eq, sapOutbox, type Database } from '@avicenna/db';
import { FINISH_PULLING_GI, GM_WAIT } from '../staging/delivery-gi-gate';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function queueFinishPullingGi(tx: Transaction, goodsMovementOutboxId: number) {
  const [source] = await tx
    .select()
    .from(sapOutbox)
    .where(
      and(
        eq(sapOutbox.id, goodsMovementOutboxId),
        eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
        eq(sapOutbox.docType, 'DELIVERY_GI_AIIA'),
        eq(sapOutbox.isSimulation, false),
      ),
    );
  if (!source) return;
  await tx
    .insert(sapOutbox)
    .values({
      plantId: source.plantId,
      sourceTable: 'TT_SAP_OUTBOX',
      sourceId: source.id,
      docType: FINISH_PULLING_GI,
      idempotencyKey: `finish-pulling-gi:${source.id}`,
      status: 'HELD',
      lastError: GM_WAIT,
      occurredAt: source.occurredAt,
      payload: {
        event: 'FINISH_PULLING',
        goodsMovementOutboxId: source.id,
        orderId: source.sourceId,
        state: 'WAITING_GOODS_MOVEMENT',
      },
    })
    .onConflictDoNothing();
}
