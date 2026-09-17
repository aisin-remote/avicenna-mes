import { z } from 'zod';

/**
 * Boolean dari environment variable.
 *
 * JANGAN memakai `z.coerce.boolean()` untuk ini: fungsi itu memakai aturan
 * truthy JavaScript, sehingga string "false" — dan juga "0" — menghasilkan
 * `true`. Efeknya diperparah oleh @nestjs/config yang menulis hasil validasi
 * kembali ke `process.env`, jadi MQTT_ENABLED=false berubah menjadi "true"
 * dan servis yang seharusnya mati justru menyala.
 */
const envBoolean = (bawaan: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(bawaan)
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      return ['true', '1', 'yes', 'y', 'on'].includes(v.trim().toLowerCase());
    });

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

  MQTT_ENABLED: envBoolean(false),
  MQTT_URL: z.string().default('mqtt://127.0.0.1:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('aiia/+/machine'),

  MSSQL_SYNC_ENABLED: envBoolean(false),
  MSSQL_HOST: z.string().optional(),
  MSSQL_PORT: z.coerce.number().optional(),
  MSSQL_DATABASE: z.string().optional(),
  MSSQL_USER: z.string().optional(),
  MSSQL_PASSWORD: z.string().optional(),

  /*
   * Database jembatan (staging) ke SAP.
   *
   * Dua saklar, bukan satu. Arah dorong bisa dinyalakan lebih dulu tanpa ikut
   * menyalakan tarik master — begitu tarik aktif, apa pun yang diketik orang di
   * layar master akan tertimpa isi staging pada putaran berikutnya, dan itu
   * keputusan tersendiri.
   *
   * Nilainya TIDAK diwajibkan di sini. Lingkungan dev tidak punya akses ke SQL
   * Server pabrik, dan mewajibkannya berarti tidak ada yang bisa menjalankan
   * API di laptopnya. Yang menolak jalan dengan pesan jelas adalah
   * StagingDbService saat koneksinya benar-benar dibutuhkan.
   */
  STAGING_PUSH_ENABLED: envBoolean(false),
  STAGING_PULL_ENABLED: envBoolean(false),
  STAGING_HOST: z.string().optional(),
  STAGING_PORT: z.coerce.number().optional(),
  STAGING_INSTANCE: z.string().optional(),
  STAGING_DATABASE: z.string().optional(),
  STAGING_USER: z.string().optional(),
  STAGING_PASSWORD: z.string().optional(),
  STAGING_ENCRYPT: envBoolean(false),
  STAGING_TRUST_CERT: envBoolean(true),

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
