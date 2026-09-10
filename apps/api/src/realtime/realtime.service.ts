import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, filter, map, merge, interval } from 'rxjs';
import { RedisService } from '../queue/redis.service';
import { withTimeout } from '../common/with-timeout';

export interface RealtimeEvent {
  channel: string;
  type: string;
  payload: unknown;
  at: string;
}

const REDIS_CHANNEL = 'avicenna:events';

/**
 * Penyiaran event ke semua klien yang sedang menonton.
 *
 * Lewat Redis pub/sub supaya tetap benar ketika API dijalankan lebih dari satu
 * instance: scan yang masuk ke instance A tetap sampai ke dashboard yang
 * tersambung ke instance B.
 *
 * Kenapa ini menyelesaikan masalah lama: di PHP-FPM, tiap koneksi SSE memakai
 * satu proses PHP penuh, jadi 30 layar andon yang terbuka bisa menghabiskan
 * pool. Node menahan koneksi menganggur di satu event loop — biayanya hanya
 * memori per koneksi, bukan satu proses per koneksi.
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly stream$ = new Subject<RealtimeEvent>();

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    const sub = this.redis.getSubscriber();
    void sub.subscribe(REDIS_CHANNEL, (err) => {
      if (err) this.logger.error(`gagal subscribe: ${err.message}`);
      else this.logger.log(`menyimak channel ${REDIS_CHANNEL}`);
    });

    sub.on('message', (channel, raw) => {
      if (channel !== REDIS_CHANNEL) return;
      try {
        this.stream$.next(JSON.parse(raw) as RealtimeEvent);
      } catch (err) {
        this.logger.warn(`pesan tidak bisa dibaca: ${String(err)}`);
      }
    });
  }

  /**
   * Menyiarkan event ke seluruh instance API.
   *
   * Dibatasi waktu: koneksi Redis milik BullMQ memakai `maxRetriesPerRequest:
   * null`, jadi publish akan mengantre tanpa batas ketika Redis mati, bukan
   * gagal. Pemanggil yang berada di jalur request (mis. scan) harus tetap bisa
   * menyelesaikan pekerjaannya.
   */
  async publish(channel: string, type: string, payload: unknown, timeoutMs = 1000): Promise<void> {
    const event: RealtimeEvent = { channel, type, payload, at: new Date().toISOString() };
    await withTimeout(
      this.redis.client.publish(REDIS_CHANNEL, JSON.stringify(event)),
      timeoutMs,
      `siaran ke ${channel}`,
    );
  }

  /**
   * Aliran event untuk satu channel.
   *
   * Heartbeat tiap 25 detik penting: nginx dan proxy pabrik biasanya memutus
   * koneksi yang diam lebih dari 30-60 detik, dan browser akan menyambung ulang
   * terus-menerus kalau itu terjadi.
   */
  subscribe(channel: string): Observable<{ data: RealtimeEvent | { type: 'ping' } }> {
    const events$ = this.stream$.pipe(
      filter((e) => e.channel === channel || channel === '*'),
      map((e) => ({ data: e })),
    );

    const heartbeat$ = interval(25_000).pipe(map(() => ({ data: { type: 'ping' as const } })));

    return merge(events$, heartbeat$);
  }
}
