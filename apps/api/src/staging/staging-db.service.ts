import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as sql from 'mssql';
import {
  bacaStagingConfig,
  kekuranganConfig,
  keMssqlConfig,
  ringkasanConfig,
  type StagingConfig,
} from './staging.config';

/** Sekali gagal connect, jangan langsung dicoba lagi tiap detik. */
const JEDA_SETELAH_GAGAL_MS = 15_000;

export interface StatusStaging {
  terkonfigurasi: boolean;
  tersambung: boolean;
  kurang: string[];
  sejak: string | null;
  galatTerakhir: string | null;
  config: ReturnType<typeof ringkasanConfig>;
}

/**
 * Koneksi ke database jembatan (staging) SAP.
 *
 * ── Kenapa lazy, bukan connect saat start ───────────────────────────────────
 *
 * API tidak boleh gagal start hanya karena SQL Server pabrik sedang mati atau
 * belum dikonfigurasi. Kolam dibangun saat pertama kali dibutuhkan, dan
 * kegagalannya berhenti di worker — bukan merembet jadi seluruh aplikasi tidak
 * bisa dinyalakan. Di sistem lama, satu SQL Server yang tidak merespons
 * membuat seluruh request web ikut menggantung; itu yang dihindari di sini.
 *
 * ── Siapa yang boleh memakai ────────────────────────────────────────────────
 *
 * Hanya worker. Tidak ada controller yang menyentuh kolam ini di jalur request
 * pengguna, kecuali endpoint diagnostik yang memang dipakai orang untuk
 * memeriksa sambungan.
 */
@Injectable()
export class StagingDbService implements OnModuleDestroy {
  private readonly logger = new Logger(StagingDbService.name);
  private readonly config: StagingConfig = bacaStagingConfig();

  private pool?: sql.ConnectionPool;
  private penyambung?: Promise<sql.ConnectionPool>;
  private tersambungSejak: Date | null = null;
  private galatTerakhir: string | null = null;
  private bolehCobaLagiPada = 0;

  get cfg(): StagingConfig {
    return this.config;
  }

  get terkonfigurasi(): boolean {
    return kekuranganConfig(this.config).length === 0;
  }

  get dorongAktif(): boolean {
    return this.config.pushEnabled && this.terkonfigurasi;
  }

  get tarikAktif(): boolean {
    return this.config.pullEnabled && this.terkonfigurasi;
  }

  /**
   * Kolam siap pakai. Membangunnya bila belum ada.
   *
   * Beberapa pemanggil bersamaan berbagi SATU promise penyambungan — tanpa itu,
   * tiga job yang mulai berbarengan membuka tiga kolam ke server yang sama.
   */
  async kolam(): Promise<sql.ConnectionPool> {
    const kurang = kekuranganConfig(this.config);
    if (kurang.length > 0) {
      throw new Error(
        `Koneksi staging belum dikonfigurasi. Isi dulu di .env: ${kurang.join(', ')}`,
      );
    }

    if (this.pool?.connected) return this.pool;
    if (this.penyambung) return this.penyambung;

    if (Date.now() < this.bolehCobaLagiPada) {
      throw new Error(
        `Sambungan ke staging sedang gagal, menunggu sebelum mencoba lagi. ` +
          `Galat terakhir: ${this.galatTerakhir ?? 'tidak diketahui'}`,
      );
    }

    this.penyambung = this.sambung();
    try {
      return await this.penyambung;
    } finally {
      this.penyambung = undefined;
    }
  }

  private async sambung(): Promise<sql.ConnectionPool> {
    // Kolam lama yang setengah mati dibuang dulu; menyambung ulang di atasnya
    // menghasilkan galat "Connection is closed" yang menyesatkan.
    await this.tutupDiam();

    const pool = new sql.ConnectionPool(keMssqlConfig(this.config));

    /*
     * Handler 'error' WAJIB ada. ConnectionPool adalah EventEmitter, dan
     * emitter yang memancarkan 'error' tanpa pendengar akan MEMATIKAN proses
     * Node — jadi satu kabel jaringan tercabut bisa menjatuhkan API.
     */
    pool.on('error', (err: Error) => {
      this.galatTerakhir = err.message;
      this.tersambungSejak = null;
      this.logger.error(`kolam staging bermasalah: ${err.message}`);
    });

    try {
      await pool.connect();
      this.pool = pool;
      this.tersambungSejak = new Date();
      this.galatTerakhir = null;
      this.bolehCobaLagiPada = 0;
      const r = ringkasanConfig(this.config);
      this.logger.log(
        `tersambung ke staging ${r.host}${r.instance ? '\\' + r.instance : ':' + r.port} / ${r.database}`,
      );
      return pool;
    } catch (err) {
      const pesan = err instanceof Error ? err.message : String(err);
      this.galatTerakhir = pesan;
      this.tersambungSejak = null;
      this.bolehCobaLagiPada = Date.now() + JEDA_SETELAH_GAGAL_MS;
      await pool.close().catch(() => undefined);
      throw new Error(`Gagal menyambung ke staging: ${pesan}`);
    }
  }

  /**
   * Menjalankan query dengan parameter bernama.
   *
   * SELALU lewat parameter, tidak pernah dengan merangkai string. Nilai yang
   * datang dari payload dokumen bisa memuat tanda kutip, dan merangkainya ke
   * dalam SQL berarti satu nomor lot bertanda kutip merusak seluruh perintah.
   */
  async query<T = Record<string, unknown>>(
    perintah: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const pool = await this.kolam();
    const req = pool.request();
    for (const [nama, nilai] of Object.entries(params)) {
      req.input(nama, nilai === undefined ? null : nilai);
    }
    const hasil = await req.query<T>(perintah);
    return hasil.recordset ?? [];
  }

  /** Transaksi di sisi staging — dipakai saat satu dokumen menulis kepala + baris. */
  async transaksi<T>(jalankan: (tx: sql.Transaction) => Promise<T>): Promise<T> {
    const pool = await this.kolam();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const hasil = await jalankan(tx);
      await tx.commit();
      return hasil;
    } catch (err) {
      // rollback bisa ikut gagal bila sambungan sudah putus; galat aslinya
      // yang harus sampai ke pemanggil, bukan galat rollback-nya.
      await tx.rollback().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Keadaan terakhir yang DIKETAHUI, tanpa menyentuh jaringan.
   *
   * Dipakai layar pemantauan. Memakai cek() di sana berarti halaman /sap
   * menggantung selama batas waktu koneksi setiap kali SQL Server pabrik mati —
   * layar yang gunanya justru memberitahu bahwa ada yang mati, malah ikut mati.
   */
  keadaan(): StatusStaging {
    const kurang = kekuranganConfig(this.config);
    return {
      terkonfigurasi: kurang.length === 0,
      tersambung: Boolean(this.pool?.connected),
      kurang,
      sejak: this.tersambungSejak?.toISOString() ?? null,
      galatTerakhir: this.galatTerakhir,
      config: ringkasanConfig(this.config),
    };
  }

  /** Uji sambungan sungguhan. Menyentuh jaringan — hanya saat diminta orang. */
  async cek(): Promise<StatusStaging> {
    const kurang = kekuranganConfig(this.config);
    if (kurang.length > 0) {
      return {
        terkonfigurasi: false,
        tersambung: false,
        kurang,
        sejak: null,
        galatTerakhir: null,
        config: ringkasanConfig(this.config),
      };
    }

    try {
      // Paksa coba lagi: orang yang menekan tombol "uji sambungan" tidak perlu
      // menunggu jeda mundur yang dipasang untuk worker.
      this.bolehCobaLagiPada = 0;
      await this.query('SELECT 1 AS ok');
      return {
        terkonfigurasi: true,
        tersambung: true,
        kurang: [],
        sejak: this.tersambungSejak?.toISOString() ?? null,
        galatTerakhir: null,
        config: ringkasanConfig(this.config),
      };
    } catch (err) {
      return {
        terkonfigurasi: true,
        tersambung: false,
        kurang: [],
        sejak: null,
        galatTerakhir: err instanceof Error ? err.message : String(err),
        config: ringkasanConfig(this.config),
      };
    }
  }

  private async tutupDiam(): Promise<void> {
    if (!this.pool) return;
    const lama = this.pool;
    this.pool = undefined;
    this.tersambungSejak = null;
    await lama.close().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.tutupDiam();
  }
}
