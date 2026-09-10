import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { QueueService } from './queue.service';
import { StockWorker } from './stock.worker';
import { BackflushModule } from '../backflush/backflush.module';

/**
 * Producer (QueueService) dan worker (StockWorker) hidup di proses yang sama
 * saat development supaya `pnpm dev` cukup satu perintah.
 *
 * Di produksi, jalankan proses terpisah dengan WORKER_ONLY=1 agar lonjakan
 * pekerjaan berat tidak memakan CPU yang melayani scanner. Lihat README.
 */
@Global()
@Module({
  imports: [BackflushModule],
  providers: [RedisService, QueueService, StockWorker],
  exports: [RedisService, QueueService],
})
export class QueueModule {}
