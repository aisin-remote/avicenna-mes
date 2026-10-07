import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { RedisService } from '../queue/redis.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import { SapOutboxService } from './sap-outbox.service';
import { StagingPushService } from '../staging/staging-push.service';
import { StagingPullService } from '../staging/staging-pull.service';

/** Sesering apa perpindahan barang dikumpulkan, didorong, dan dicek balasannya. */
const POLA_TRANSAKSI = '* * * * *';

/**
 * Master tidak berubah tiap menit.
 *
 * Menariknya sesering transaksi hanya membebani SQL Server dan memperbesar
 * jendela di mana seseorang sedang menyunting master lalu tulisannya tertimpa
 * hasil tarik di tengah pekerjaan.
 */
const POLA_MASTER = '*/15 * * * *';

/** Rencana pengiriman bisa berubah selama hari berjalan. */
const POLA_PENGIRIMAN = '*/5 * * * *';

/**
 * Menjalankan percakapan dengan database jembatan secara berkala.
 *
 * Lima langkah, sengaja dipisah menjadi job tersendiri:
 *
 *   kumpulkan  mutasi -> dokumen di outbox        (MySQL saja)
 *   dorong     outbox -> staging                  (butuh MS SQL)
 *   balasan    flag di staging -> tutup dokumen   (butuh MS SQL)
 *   tarik      master di staging -> master kita   (butuh MS SQL)
 *   pengiriman loading list hari aktif -> MES     (butuh MS SQL)
 *
 * Yang pertama hanya menyentuh MySQL dan selalu bisa jalan; tiga sisanya
 * bergantung pada MS SQL yang bisa saja mati. Menyatukannya berarti gangguan
 * jaringan ke MS SQL ikut menghentikan pencatatan dokumen — dan tunggakannya
 * jadi tidak terlihat di mana pun.
 *
 * Concurrency 1 menjaga urutannya: dorong tidak pernah berjalan mendahului
 * kumpulkan pada putaran yang sama, dan baca balasan tidak pernah memeriksa
 * dokumen yang baru separuh terdorong.
 */
@Injectable()
export class SapWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SapWorker.name);
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly outbox: SapOutboxService,
    private readonly push: StagingPushService,
    private readonly pull: StagingPullService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUES.SYNC,
      async (job: Job) => {
        switch (job.name) {
          case JOBS.COLLECT_SAP_OUTBOX: {
            const hasil = await this.outbox.collect();
            // Dokumen yang tertahan dicoba lepas tiap putaran: begitu movement
            // type-nya diisi, tunggakannya jalan sendiri tanpa perlu disentuh.
            await this.outbox.releaseHeld();
            return hasil;
          }
          case JOBS.FLUSH_SAP_OUTBOX:
            return this.push.dorong();
          case JOBS.ACK_SAP_STAGING:
            return this.push.ambilBalasan();
          case JOBS.PULL_SAP_MASTER:
            // Sungguhan, bukan uji coba — saklarnya sendiri yang menjaga.
            return this.pull.tarikSemua(false);
          case JOBS.PULL_SAP_DELIVERIES:
            return this.pull.tarikPengiriman(new Date(), false);
          default:
            return undefined;
        }
      },
      { connection: this.redis.client, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`job ${job?.name} gagal: ${err.message}`);
    });

    // upsertJobScheduler bersifat idempoten: restart tidak menghasilkan
    // jadwal kedua yang berjalan paralel.
    for (const name of [
      JOBS.COLLECT_SAP_OUTBOX,
      JOBS.FLUSH_SAP_OUTBOX,
      JOBS.ACK_SAP_STAGING,
    ]) {
      await this.queue.addRepeating(QUEUES.SYNC, name, {}, POLA_TRANSAKSI);
    }
    /*
     * Tarik master hanya dijadwalkan bila memang aktif.
     *
     * Menjadwalkannya saat mati berarti job yang tidak mengerjakan apa pun
     * berjalan 96 kali sehari, dan catatannya memenuhi log dengan keadaan yang
     * tidak bisa diperbaiki siapa pun sampai konfigurasinya masuk. Menyalakan
     * saklarnya perlu restart — sama seperti perubahan .env lainnya.
     */
    if (this.pull.aktif) {
      await this.queue.addRepeating(QUEUES.SYNC, JOBS.PULL_SAP_MASTER, {}, POLA_MASTER);
      await this.queue.addRepeating(
        QUEUES.SYNC,
        JOBS.PULL_SAP_DELIVERIES,
        {},
        POLA_PENGIRIMAN,
      );
    }

    const bagian: string[] = ['pengumpul outbox SAP berjalan tiap menit'];
    if (!this.push.aktif) bagian.push('dorong ke staging belum dinyalakan');
    if (!this.pull.aktif) bagian.push('tarik master/pengiriman belum dinyalakan');
    this.logger.log(bagian.join(' — '));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
