import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../queue/redis.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import { SapOutboxService } from './sap-outbox.service';
import { SapWriterService } from './sap-writer.service';

/** Sesering apa perpindahan barang dikumpulkan dan dikirim. */
const POLA_CRON = '* * * * *';

/**
 * Menjalankan pengumpulan dan pengiriman dokumen SAP secara berkala.
 *
 * Dua langkah dipisah dengan sengaja. Pengumpulan hanya menyentuh MySQL dan
 * selalu bisa jalan; pengiriman bergantung pada MS SQL yang bisa saja mati.
 * Menyatukannya berarti gangguan jaringan ke MS SQL ikut menghentikan
 * pencatatan dokumen — dan tunggakannya jadi tidak terlihat di mana pun.
 */
@Injectable()
export class SapWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SapWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly outbox: SapOutboxService,
    private readonly writer: SapWriterService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUES.SYNC,
      async (job: Job) => {
        if (job.name === JOBS.COLLECT_SAP_OUTBOX) {
          const hasil = await this.outbox.collect();
          // Dokumen yang tertahan dicoba lepas tiap putaran: begitu movement
          // type-nya diisi, tunggakannya jalan sendiri tanpa perlu disentuh.
          await this.outbox.releaseHeld();
          return hasil;
        }
        if (job.name === JOBS.FLUSH_SAP_OUTBOX) {
          return this.writer.flush();
        }
        return undefined;
      },
      { connection: this.redis.client, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`job ${job?.name} gagal: ${err.message}`);
    });

    // upsertJobScheduler bersifat idempoten: restart tidak menghasilkan
    // jadwal kedua yang berjalan paralel.
    for (const name of [JOBS.COLLECT_SAP_OUTBOX, JOBS.FLUSH_SAP_OUTBOX]) {
      await this.queue.addRepeating(QUEUES.SYNC, name, {}, POLA_CRON);
    }

    this.logger.log(
      'pengumpul outbox SAP berjalan tiap menit' +
        (this.writer.aktif ? '' : ' — pengiriman ke MS SQL belum dinyalakan'),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
