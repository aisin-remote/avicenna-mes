import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { RedisService } from './redis.service';
import { QUEUES, type QueueName } from './queue.constants';
import { withTimeout } from '../common/with-timeout';

/**
 * Titik masuk untuk semua pekerjaan berat.
 *
 * ATURAN PROYEK: apa pun yang butuh lebih dari ~200ms dan bukan bagian dari
 * merender balasan HTTP harus lewat sini, bukan dikerjakan di dalam request.
 *
 * Ini yang dulu hilang: kedua sistem lama memakai QUEUE_DRIVER=sync sehingga
 * export Excel dan sync SQL Server berjalan di dalam request dan menahan
 * worker web sampai selesai.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly redis: RedisService) {}

  get(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.redis.client,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 24 * 3600 },
        },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /**
   * Memasukkan job ke antrean, dengan batas waktu.
   *
   * BullMQ mewajibkan koneksi Redis-nya memakai `maxRetriesPerRequest: null`,
   * yang artinya perintah akan mengantre selamanya ketika Redis mati — `add()`
   * tidak melempar error, ia menggantung. Tanpa batas waktu di sini, satu
   * insiden Redis akan menahan request scanner sampai time-out HTTP.
   *
   * Melewati batas waktu dianggap kegagalan yang bisa ditoleransi: pemanggil
   * memutuskan sendiri apakah itu fatal. Untuk scan, tidak — datanya sudah
   * tersimpan dan job-nya bisa dijalankan ulang.
   */
  async add(
    queue: QueueName,
    jobName: string,
    payload: Record<string, unknown>,
    options?: JobsOptions,
    timeoutMs = 2000,
  ): Promise<string | undefined> {
    const job = await withTimeout(
      this.get(queue).add(jobName, payload, options),
      timeoutMs,
      `enqueue ${jobName} ke ${queue}`,
    );
    this.logger.debug(`job ${jobName} masuk antrean ${queue} (id=${job.id})`);
    return job.id;
  }

  /**
   * Job berulang — pengganti 29 artisan command terjadwal dari kedua sistem lama.
   *
   * BullMQ 6 memakai job scheduler, bukan opsi `repeat` seperti versi lama.
   * `schedulerId` bersifat idempoten: memanggil ulang dengan id yang sama akan
   * memperbarui jadwal, bukan membuat jadwal kedua yang berjalan paralel.
   *
   * @param pattern pola cron, mis. '*\/5 * * * *' untuk tiap 5 menit
   */
  async addRepeating(
    queue: QueueName,
    jobName: string,
    payload: Record<string, unknown>,
    pattern: string,
  ): Promise<void> {
    await this.get(queue).upsertJobScheduler(
      `repeat:${jobName}`,
      { pattern, tz: process.env.TZ ?? 'Asia/Jakarta' },
      { name: jobName, data: payload },
    );
    this.logger.log(`jadwal ${jobName} diset: ${pattern}`);
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      await queue.close().catch(() => undefined);
    }
  }
}

export { QUEUES };
