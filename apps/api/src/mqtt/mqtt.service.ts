import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import mqtt, { type MqttClient } from 'mqtt';
import { eq, type Database } from '@avicenna/db';
import { machineEvents, machines } from '@avicenna/db';
import { InjectDb } from '../db/db.module';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Penerima event mesin lewat MQTT.
 *
 * Berjalan di proses API yang hidup terus — bukan di request web. Di bella,
 * php-mqtt/client hanya bisa dipakai lewat command yang dijadwalkan, sehingga
 * event mesin selalu tertunda sampai polling berikutnya.
 *
 * Format topic yang diharapkan: <prefix>/<kode mesin>/<jenis event>
 * Aktifkan dengan MQTT_ENABLED=true.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client?: MqttClient;
  private readonly machineCache = new Map<string, number>();

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    if (process.env.MQTT_ENABLED !== 'true') {
      this.logger.log('MQTT dimatikan (MQTT_ENABLED != true)');
      return;
    }

    const url = process.env.MQTT_URL ?? 'mqtt://127.0.0.1:1883';
    const topic = process.env.MQTT_TOPIC_PREFIX ?? 'aiia/+/machine';

    this.client = mqtt.connect(url, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      reconnectPeriod: 5000,
      clientId: `avicenna-api-${process.pid}`,
    });

    this.client.on('connect', () => {
      this.logger.log(`MQTT tersambung ke ${url}`);
      this.client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) this.logger.error(`gagal subscribe ${topic}: ${err.message}`);
        else this.logger.log(`menyimak topic ${topic}`);
      });
    });

    this.client.on('error', (err) => this.logger.error(`MQTT error: ${err.message}`));
    this.client.on('message', (t, payload) => {
      void this.handleMessage(t, payload).catch((err) =>
        this.logger.error(`gagal memproses pesan dari ${t}: ${String(err)}`),
      );
    });
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(payload.toString()) as Record<string, unknown>;
    } catch {
      this.logger.warn(`payload bukan JSON dari topic ${topic}`);
      return;
    }

    const machineCode = String(body.machineCode ?? topic.split('/')[1] ?? '');
    if (!machineCode) return;

    const machine = await this.resolveMachine(machineCode);
    if (!machine) {
      this.logger.warn(`mesin ${machineCode} belum terdaftar di master`);
      return;
    }

    const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();

    await this.db.insert(machineEvents).values({
      plantId: machine.plantId,
      machineId: machine.id,
      type: (body.type as never) ?? 'STATUS_CHANGE',
      source: 'MQTT',
      status: body.status ? String(body.status) : null,
      shotCount: typeof body.shotCount === 'number' ? body.shotCount : null,
      occurredAt,
      dedupeKey: body.messageId ? `mqtt:${String(body.messageId)}` : null,
      payload: body,
    });

    await this.realtime.publish(`machine:${machineCode}`, 'machine-event', {
      machineCode,
      type: body.type ?? 'STATUS_CHANGE',
      status: body.status ?? null,
      occurredAt: occurredAt.toISOString(),
    });
  }

  private async resolveMachine(code: string) {
    const cached = this.machineCache.get(code);
    if (cached) {
      const rows = await this.db.select().from(machines).where(eq(machines.id, cached)).limit(1);
      if (rows[0]) return rows[0];
    }
    const rows = await this.db.select().from(machines).where(eq(machines.code, code)).limit(1);
    if (rows[0]) this.machineCache.set(code, rows[0].id);
    return rows[0];
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.endAsync().catch(() => undefined);
  }
}
