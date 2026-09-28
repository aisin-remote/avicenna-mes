import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { and, eq, gte, lt, isNull, desc, type Database } from '@avicenna/db';
import { mutations, stockBalances, scanEvents } from '@avicenna/db';
import { summarizeMutations, productionDayWindow, type MutationRow } from '@avicenna/domain';
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
          // Komponen ditulis setelah scan. Hitung ulang saldo komponen di sini,
          // sesudah backflush selesai, bukan mengandalkan job scan yang bisa
          // berjalan lebih dulu pada worker dengan concurrency > 1.
          const [scan] = await this.db.select({ scannedAt: scanEvents.scannedAt })
            .from(scanEvents).where(eq(scanEvents.id, scanEventId)).limit(1);
          if (scan) {
            const tanggal = productionDayWindow(scan.scannedAt).key;
            const komponen = await this.db.selectDistinct({ partId: mutations.partId })
              .from(mutations).where(and(
                eq(mutations.sourceTable, 'TT_HISTORY_SCAN'),
                eq(mutations.sourceId, scanEventId),
                eq(mutations.type, 'CONSUMPTION_OUT'),
              ));
            for (const k of komponen) await this.recalc({ partId: k.partId, date: tanggal });
          }
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
    const rentang = productionDayWindow(new Date(`${payload.date}T12:00:00`));
    const dayStart = rentang.start;
    const dayEnd = rentang.end;

    // Satu transfer mengubah DUA SLOC. Job dari scan hanya menyebut part,
    // maka saldo setiap lokasi yang punya mutasi dihitung ulang bersama total.
    const tempat = payload.locationId
      ? [payload.locationId]
      : (await this.db.selectDistinct({ id: mutations.locationId }).from(mutations)
          .where(eq(mutations.partId, payload.partId)))
          .map((r) => r.id).filter((id): id is number => id !== null);

    const total = await this.recalcSatu(payload.partId, null, payload.date, dayStart, dayEnd);
    for (const id of tempat) await this.recalcSatu(payload.partId, id, payload.date, dayStart, dayEnd);
    return { closingQty: total };
  }

  private async recalcSatu(
    partId: number, locationId: number | null, date: string, dayStart: Date, dayEnd: Date,
  ): Promise<number> {
    const lokasi = locationId === null ? isNull(stockBalances.locationId) : eq(stockBalances.locationId, locationId);
    const lokasiMutasi = locationId === null ? undefined : eq(mutations.locationId, locationId);

    // Saldo penutup hari sebelumnya jadi saldo awal hari ini.
    const previous = locationId === null ? [] : await this.db
      .select()
      .from(stockBalances)
      .where(
        and(
          eq(stockBalances.partId, partId),
          lokasi,
          lt(stockBalances.balanceDate, date),
        ),
      )
      .orderBy(desc(stockBalances.balanceDate))
      .limit(1);

    let opening = Number(previous[0]?.closingQty ?? 0);
    if (previous.length === 0) {
      // Belum ada cache sebelumnya: bangun saldo awal dari ledger agar
      // pemasangan fitur pada data lama tidak memulai setiap SLOC dari nol.
      const lama = await this.db.select({ type: mutations.type, qty: mutations.qty,
        occurredAt: mutations.occurredAt }).from(mutations)
        .where(and(eq(mutations.partId, partId), lokasiMutasi, lt(mutations.occurredAt, dayStart)));
      opening = summarizeMutations(0, lama.map((r) => ({ ...r, qty: Number(r.qty) })) as MutationRow[]).closingQty;
    }

    const rows = await this.db
      .select({
        type: mutations.type,
        qty: mutations.qty,
        occurredAt: mutations.occurredAt,
      })
      .from(mutations)
      .where(
        and(
          eq(mutations.partId, partId),
          lokasiMutasi,
          gte(mutations.occurredAt, dayStart),
          lt(mutations.occurredAt, dayEnd),
        ),
      );

    // Kolom desimal dikembalikan driver sebagai string; diubah ke angka di
    // sini supaya logika domain tetap bekerja dengan angka biasa.
    const summary = summarizeMutations(
      opening,
      rows.map((r) => ({ ...r, qty: Number(r.qty) })) as MutationRow[],
    );

    // MySQL membolehkan banyak NULL pada unique(part, location, date).
    // Karena itu total tanpa SLOC dihitung dari ledger dan tidak di-upsert
    // sebagai cache: onDuplicateKeyUpdate justru membuat baris total ganda.
    if (locationId !== null) await this.db
      .insert(stockBalances)
      .values({
        partId,
        locationId,
        balanceDate: date,
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
      `saldo part=${partId} SLOC=${locationId ?? 'TOTAL'} tgl=${date} -> ${summary.closingQty}`,
    );
    return summary.closingQty;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
