import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, asc, sql, inArray, sapOutbox, type Database } from '@avicenna/db';
import type { DeliveryOrderSnapshot } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from './staging-db.service';
import { GOODS_MOVEMENT } from './staging-tables';
import {
  FINISH_PULLING_GI,
  GM_WAIT,
  checkGoodsMovementUpload,
  type GoodsMovementUpload,
} from './delivery-gi-gate';
import { queueFinishPullingGi } from '../loading/finish-pulling-gi';

function tableName(name: string) {
  const parts = name.replace(/[\[\]]/g, '').split('.');
  if (parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(part)))
    throw new Error('Nama tabel Goods Movement tidak valid.');
  return parts.map((part) => `[${part}]`).join('.');
}

@Injectable()
export class DeliveryGiService {
  private readonly logger = new Logger(DeliveryGiService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly staging: StagingDbService,
  ) {}

  async checkPending() {
    await this.collectPending();
    let cursor = 0;
    let checked = 0;
    let ready = 0;
    let failed = 0;
    // Keyset pagination keeps an old waiting request from blocking newer requests.
    while (true) {
      const batch = await this.db
        .select({ id: sapOutbox.id })
        .from(sapOutbox)
        .where(
          and(
            eq(sapOutbox.docType, FINISH_PULLING_GI),
            eq(sapOutbox.sourceTable, 'TT_SAP_OUTBOX'),
            eq(sapOutbox.status, 'HELD'),
            eq(sapOutbox.isSimulation, false),
            gt(sapOutbox.id, cursor),
          ),
        )
        .orderBy(asc(sapOutbox.id))
        .limit(100);
      if (!batch.length) break;
      for (const { id } of batch) {
        try {
          if (await this.checkRequest(id)) ready++;
          checked++;
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Pemeriksaan Goods Movement untuk antrean GI ${id} gagal: ${message}`);
        }
      }
      cursor = batch[batch.length - 1]!.id;
    }
    return { checked, ready, failed };
  }

  private async collectPending() {
    let cursor = 0;
    while (true) {
      const batch = await this.db
        .select({ id: sapOutbox.id })
        .from(sapOutbox)
        .where(
          and(
            eq(sapOutbox.sourceTable, 'TT_DELIVERY_ORDER'),
            eq(sapOutbox.docType, 'DELIVERY_GI_AIIA'),
            eq(sapOutbox.isSimulation, false),
            inArray(sapOutbox.status, ['HELD', 'PENDING', 'SENT', 'FAILED']),
            gt(sapOutbox.id, cursor),
            sql`NOT EXISTS (SELECT 1 FROM sap."TT_SAP_OUTBOX" gi
          WHERE gi."CHR_SOURCE_TABLE" = 'TT_SAP_OUTBOX'
          AND gi."INT_SOURCE_ID" = ${sapOutbox.id} AND gi."CHR_DOC_TYPE" = ${FINISH_PULLING_GI})`,
          ),
        )
        .orderBy(asc(sapOutbox.id))
        .limit(100);
      if (!batch.length) break;
      for (const { id } of batch) await this.db.transaction((tx) => queueFinishPullingGi(tx, id));
      cursor = batch[batch.length - 1]!.id;
    }
  }

  async checkRequest(id: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(sapOutbox)
        .where(
          and(
            eq(sapOutbox.id, id),
            eq(sapOutbox.docType, FINISH_PULLING_GI),
            eq(sapOutbox.sourceTable, 'TT_SAP_OUTBOX'),
            eq(sapOutbox.status, 'HELD'),
            eq(sapOutbox.isSimulation, false),
          ),
        )
        .for('update');
      if (!job) return false;
      const [source] = await tx.select().from(sapOutbox).where(eq(sapOutbox.id, job.sourceId));
      let state = 'WAITING_GOODS_MOVEMENT';
      let reason = GM_WAIT;
      let items: GoodsMovementUpload[] = [];
      let ready = false;
      if (
        !source ||
        source.sourceTable !== 'TT_DELIVERY_ORDER' ||
        source.docType !== 'DELIVERY_GI_AIIA' ||
        source.isSimulation
      ) {
        reason = 'Antrean GI tidak memiliki request Finish Pulling nyata yang sesuai.';
      } else if (source.status === 'SENT' && source.stagingNumber != null) {
        state = 'WAITING_UPLOAD';
        if (!this.staging.terkonfigurasi) {
          reason = 'Koneksi staging belum dikonfigurasi; CHR_UPLOAD belum dapat diperiksa.';
        } else {
          try {
            items = await this.staging.query<GoodsMovementUpload>(
              `SELECT H.INT_NUMBER AS number, H.CHR_TYPE_TRANS AS typeTrans,
                 H.CHR_VALIDATE AS validate, L.INT_NUMBER_ITEM AS itemNumber,
                 L.CHR_UPLOAD AS upload, L.CHR_PART_NO AS partNumber, L.INT_TOTAL_QTY AS qty
               FROM ${tableName(GOODS_MOVEMENT.kepala)} H
               INNER JOIN ${tableName(GOODS_MOVEMENT.baris)} L ON L.INT_NUMBER = H.INT_NUMBER
               WHERE H.INT_NUMBER = @number`,
              { number: source.stagingNumber },
            );
            const payload = source.payload as {
              snapshot?: DeliveryOrderSnapshot;
              goodsMovement?: { number: number; itemNumbers: number[] };
            };
            const receipt = payload?.goodsMovement;
            if (
              receipt &&
              (receipt.number !== source.stagingNumber ||
                receipt.itemNumbers.length !== items.length ||
                items.some((item) => !receipt.itemNumbers.includes(Number(item.itemNumber))))
            ) {
              throw new Error('Identitas item Goods Movement berubah dari hasil insert.');
            }
            const result = checkGoodsMovementUpload(
              source.stagingNumber,
              payload?.snapshot?.lines ?? [],
              items,
            );
            ready = result.ready;
            reason = result.reason;
            if (ready) state = 'WAITING_GI_TABLE';
          } catch (error) {
            reason = `Gagal membaca CHR_UPLOAD; akan diperiksa ulang: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      } else if (source.status !== 'SENT') {
        reason = `${GM_WAIT} Status request: ${source.status}.`;
      }
      // X permits the next write only; it does not confirm GI/GR or issue a DO.
      await tx
        .update(sapOutbox)
        .set({
          status: 'HELD',
          lastError: reason.slice(0, 1000),
          payload: {
            event: 'FINISH_PULLING',
            goodsMovementOutboxId: job.sourceId,
            orderId: source?.sourceId ?? null,
            goodsMovementNumber: source?.stagingNumber ?? null,
            state,
            checkedAt: new Date().toISOString(),
            items,
          },
        })
        .where(eq(sapOutbox.id, job.id));
      return ready;
    });
  }
}
