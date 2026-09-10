import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '@avicenna/db';
import { InjectDb } from '../db/db.module';
import { RedisService } from '../queue/redis.service';
import { Public } from '../auth/jwt-auth.guard';
import { withTimeout } from '../common/with-timeout';

// Load balancer dan monitoring pabrik tidak membawa token, jadi endpoint ini
// harus terbuka. Isinya sengaja tidak memuat detail koneksi apa pun.
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly redis: RedisService,
  ) {}

  @Get()
  live() {
    return { status: 'ok', at: new Date().toISOString() };
  }

  /**
   * Cek dependensi. Dipakai load balancer & monitoring pabrik untuk tahu
   * apakah instance ini benar-benar bisa melayani, bukan sekadar hidup.
   */
  @Get('ready')
  async ready() {
    const checks: Record<string, string> = {};
    let healthy = true;

    // Setiap pemeriksaan dibatasi waktu. Probe kesehatan yang menggantung lebih
    // buruk daripada probe yang melaporkan gagal: monitoring hanya melihat
    // time-out, tanpa tahu komponen mana yang bermasalah.
    try {
      await withTimeout(this.db.execute(sql`SELECT 1`), 3000, 'ping database');
      checks.database = 'ok';
    } catch (err) {
      checks.database = err instanceof Error ? err.message : 'error';
      healthy = false;
    }

    try {
      await withTimeout(this.redis.client.ping(), 2000, 'ping redis');
      checks.redis = 'ok';
    } catch (err) {
      checks.redis = err instanceof Error ? err.message : 'error';
      healthy = false;
    }

    return { status: healthy ? 'ok' : 'degraded', checks, at: new Date().toISOString() };
  }
}
