import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Satu koneksi Redis dipakai bersama untuk perintah biasa, plus koneksi
 * terpisah untuk subscriber.
 *
 * Redis tidak mengizinkan koneksi yang sedang SUBSCRIBE menjalankan perintah
 * lain, jadi memakai satu koneksi untuk keduanya akan gagal saat pertama kali
 * dashboard realtime dibuka.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private subscriber?: Redis;

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    this.client = new Redis(url, { maxRetriesPerRequest: null });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  /** Koneksi khusus subscribe, dibuat sekali saat pertama dibutuhkan. */
  getSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.client.duplicate();
      this.subscriber.on('error', (err) =>
        this.logger.error(`Redis subscriber error: ${err.message}`),
      );
    }
    return this.subscriber;
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    await this.client.quit().catch(() => undefined);
  }
}
