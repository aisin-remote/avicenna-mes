import type { config as MssqlConfig } from 'mssql';

/**
 * Konfigurasi koneksi ke database jembatan (staging) SAP.
 *
 * ── Kenapa terpisah dari MSSQL_* ────────────────────────────────────────────
 *
 * MSSQL_* menunjuk J922 dengan user baca-saja untuk MENARIK data mesin.
 * STAGING_* menunjuk database jembatan: kita boleh MENULIS transaksi ke sana
 * dan MEMBACA master dari sana. Dua peran berbeda, dua kredensial berbeda.
 * Menyatukannya berarti memberi hak tulis pada koneksi yang seharusnya hanya
 * membaca — hak yang tidak akan dicabut lagi setelah terlanjur diberikan.
 *
 * ── Kenapa dua saklar, bukan satu ───────────────────────────────────────────
 *
 * STAGING_PUSH_ENABLED dan STAGING_PULL_ENABLED berdiri sendiri supaya arah
 * dorong bisa dinyalakan lebih dulu tanpa ikut menyalakan tarik master. Master
 * kita masih bisa di-CRUD sekarang; begitu tarik dinyalakan, apa pun yang
 * diketik orang di layar master akan tertimpa isi staging pada putaran
 * berikutnya. Itu keputusan tersendiri, bukan efek samping.
 */
export interface StagingConfig {
  host: string;
  port?: number;
  instance?: string;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  poolMax: number;
  poolMin: number;
  pushEnabled: boolean;
  pullEnabled: boolean;
}

const angka = (v: string | undefined, bawaan: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : bawaan;
};

const saklar = (v: string | undefined): boolean =>
  ['true', '1', 'yes', 'y', 'on'].includes((v ?? '').trim().toLowerCase());

export function bacaStagingConfig(env: NodeJS.ProcessEnv = process.env): StagingConfig {
  return {
    host: (env.STAGING_HOST ?? '').trim(),
    port: env.STAGING_PORT ? angka(env.STAGING_PORT, 1433) : undefined,
    instance: (env.STAGING_INSTANCE ?? '').trim() || undefined,
    database: (env.STAGING_DATABASE ?? '').trim(),
    user: (env.STAGING_USER ?? '').trim(),
    password: env.STAGING_PASSWORD ?? '',

    /*
     * Bawaan dibuat untuk SQL Server on-prem di jaringan pabrik: sambungan
     * tidak terenkripsi, sertifikat tidak diverifikasi. Itu bawaan yang WAJIB
     * diubah bila databasenya ada di luar jaringan pabrik.
     */
    encrypt: saklar(env.STAGING_ENCRYPT),
    trustServerCertificate: env.STAGING_TRUST_CERT === undefined ? true : saklar(env.STAGING_TRUST_CERT),

    connectionTimeoutMs: angka(env.STAGING_CONNECT_TIMEOUT_MS, 15_000),

    /*
     * Batas waktu query sengaja pendek. Worker ini berjalan tiap menit; query
     * yang menggantung lebih lama dari satu putaran berarti putaran berikutnya
     * menumpuk di belakangnya. Lebih baik gagal, dicatat, lalu dicoba lagi.
     */
    requestTimeoutMs: angka(env.STAGING_REQUEST_TIMEOUT_MS, 30_000),

    // Hanya worker yang memakai koneksi ini, dan concurrency-nya 1.
    // Kolam besar tidak berguna dan hanya menahan sesi di sisi SQL Server.
    poolMax: angka(env.STAGING_POOL_MAX, 4),
    poolMin: angka(env.STAGING_POOL_MIN, 0),

    pushEnabled: saklar(env.STAGING_PUSH_ENABLED),
    pullEnabled: saklar(env.STAGING_PULL_ENABLED),
  };
}

/** Apa saja yang masih kosong. Dipakai untuk menolak start dengan pesan jelas. */
export function kekuranganConfig(c: StagingConfig): string[] {
  const kurang: string[] = [];
  if (!c.host) kurang.push('STAGING_HOST');
  if (!c.database) kurang.push('STAGING_DATABASE');
  if (!c.user) kurang.push('STAGING_USER');
  if (!c.password) kurang.push('STAGING_PASSWORD');
  return kurang;
}

/**
 * Bentuk konfigurasi yang dimengerti paket `mssql`.
 *
 * PENTING soal named instance: kalau `instanceName` diisi, `port` HARUS
 * dikosongkan. Tedious menghubungi SQL Browser di UDP 1434 untuk menanyakan
 * port instance tersebut, dan mengisi keduanya membuat port tetap yang salah
 * dipakai — gejalanya timeout tanpa pesan yang menjelaskan apa pun.
 */
export function keMssqlConfig(c: StagingConfig): MssqlConfig {
  const pakaiInstance = Boolean(c.instance);

  return {
    server: c.host,
    ...(pakaiInstance ? {} : { port: c.port ?? 1433 }),
    database: c.database,
    user: c.user,
    password: c.password,
    connectionTimeout: c.connectionTimeoutMs,
    requestTimeout: c.requestTimeoutMs,
    pool: {
      max: c.poolMax,
      min: c.poolMin,
      idleTimeoutMillis: 30_000,
    },
    options: {
      ...(pakaiInstance ? { instanceName: c.instance } : {}),
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      // Angka besar dari SQL Server (BIGINT, DECIMAL) dikembalikan apa adanya
      // sebagai string bila melebihi jangkauan Number, bukan dibulatkan diam-diam.
      useUTC: false,
      enableArithAbort: true,
    },
  };
}

/** Ringkasan aman untuk log dan layar pemantauan — tanpa kata sandi. */
export function ringkasanConfig(c: StagingConfig) {
  return {
    host: c.host || null,
    port: c.instance ? null : (c.port ?? 1433),
    instance: c.instance ?? null,
    database: c.database || null,
    user: c.user || null,
    encrypt: c.encrypt,
    dorongAktif: c.pushEnabled,
    tarikAktif: c.pullEnabled,
  };
}
