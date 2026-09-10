import { z } from 'zod';

/**
 * Konfigurasi divalidasi saat proses start, bukan saat dipakai.
 *
 * Kalau ada yang salah, API gagal start dengan pesan jelas — bukan meledak
 * jam 2 pagi saat worker pertama kali menyentuh variabel yang kosong.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3001),
  TZ: z.string().default('Asia/Jakarta'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  REDIS_URL: z.string().min(1, 'REDIS_URL wajib diisi'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET minimal 16 karakter'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  DEVICE_JWT_EXPIRES_IN: z.string().default('365d'),

  MQTT_ENABLED: z.coerce.boolean().default(false),
  MQTT_URL: z.string().default('mqtt://127.0.0.1:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('aiia/+/machine'),

  MSSQL_SYNC_ENABLED: z.coerce.boolean().default(false),
  MSSQL_HOST: z.string().optional(),
  MSSQL_PORT: z.coerce.number().optional(),
  MSSQL_DATABASE: z.string().optional(),
  MSSQL_USER: z.string().optional(),
  MSSQL_PASSWORD: z.string().optional(),

  WEB_ORIGIN: z.string().default('http://127.0.0.1:3000'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${detail}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
