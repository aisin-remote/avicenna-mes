import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { and, eq, gte, lte, type Database } from '@avicenna/db';
import { mutations, stockBalances } from '@avicenna/db';
import { summarizeMutations, previousDateKey, type MutationRow } from '@avicenna/domain';
import { RedisService } from './redis.service';
import { BackflushService } from '../backflush/backflush.service';
import { InjectDb } from '../db/db.module';
import { QUEUES, JOBS } from './queue.constants';

interface RecalcPayload {
  partId: number;
  locationId?: number | null;
  date: string;
}

/**
 * Menghitung ulang saldo stok harian dari buku besar mutasi.
 *
 * Berjalan di worker, bukan di request. Di bella hal ini dikerjakan trigger
 * MySQL (`create_trigger_update_production_stocks_table`) sehingga ketika
 * angkanya salah tidak ada log, tidak ada cara mengulang, dan tidak bisa
 * ditest. Di sini prosesnya eksplisit, bisa diulang, dan logikanya ada di
 * @avicenna/domain yang punya test sendiri.
 */
@Injectable()
export class StockWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    @InjectDb() private readonly db: Database,
    private readonly backflush: BackflushService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      QUEUES.STOCK,
      async (job: Job) => {
        if (job.name === JOBS.RECALC_STOCK_BALANCE) {
          return this.recalc(job.data as RecalcPayload);
        }
        if (job.name === JOBS.BACKFLUSH_CONSUMPTION) {
          const { scanEventId } = job.data as { scanEventId: number };
          const result = await this.backflush.run(scanEventId);
          this.logger.log(
            `backflush scan=${scanEventId}: ${result.consumed} komponen` +
              (result.shortages > 0 ? `, ${result.shortages} kurang stok` : '') +
              (result.noBom ? ' (tanpa BOM)' : ''),
          );
          return result;
        }
        this.logger.warn(`job tidak dikenal: ${job.name}`);
      },
      { connection: this.redis.client, concurrency: 4 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`job ${job?.name} (id=${job?.id}) gagal: ${err.message}`);
    });

    // Tanpa handler ini, error koneksi Redis muncul sebagai unhandled error
    // event dan bisa menjatuhkan proses saat Redis sedang tidak tersedia.
    this.worker.on('error', (err) => {
      this.logger.error(`worker error: ${err.message}`);
    });
  }

  private async recalc(payload: RecalcPayload): Promise<{ closingQty: number }> {
    const dayStart = new Date(`${payload.date}T00:00:00`);
    const dayEnd = new Date(`${payload.date}T23:59:59.999`);

    // Saldo penutup hari sebelumnya jadi saldo awal hari ini.
    const previous = await this.db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.partId, payload.partId),
          lte(stockBalances.balanceDate, previousDateKey(payload.date)),
        ),
      )
      .orderBy(stockBalances.balanceDate)
      .limit(1);

    const opening = Number(previous[0]?.closingQty ?? 0);

    const rows = await this.db
      .select({
        type: mutations.type,
        qty: mutations.qty,
        occurredAt: mutations.occurredAt,
      })
      .from(mutations)
      .where(
        and(
          eq(mutations.partId, payload.partId),
          gte(mutations.occurredAt, dayStart),
          lte(mutations.occurredAt, dayEnd),
        ),
      );

    // Kolom desimal dikembalikan driver sebagai string; diubah ke angka di
    // sini supaya logika domain tetap bekerja dengan angka biasa.
    const summary = summarizeMutations(
      opening,
      rows.map((r) => ({ ...r, qty: Number(r.qty) })) as MutationRow[],
    );

    await this.db
      .insert(stockBalances)
      .values({
        partId: payload.partId,
        locationId: payload.locationId ?? null,
        balanceDate: payload.date,
        openingQty: String(summary.openingQty),
        inQty: String(summary.inQty),
        outQty: String(summary.outQty),
        closingQty: String(summary.closingQty),
      })
      .onDuplicateKeyUpdate({
        set: {
          openingQty: String(summary.openingQty),
          inQty: String(summary.inQty),
          outQty: String(summary.outQty),
          closingQty: String(summary.closingQty),
        },
      });

    this.logger.log(
      `saldo part=${payload.partId} tgl=${payload.date} -> ${summary.closingQty}`,
    );
    return { closingQty: summary.closingQty };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}

