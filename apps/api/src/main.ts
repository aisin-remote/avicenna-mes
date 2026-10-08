import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { MAKS_UKURAN_FOTO, MAKS_UKURAN_IMPOR } from '@avicenna/contracts';
import { periksaMigrasi, cariFolderMigrasi, pesanPeriksaMigrasi } from '@avicenna/db';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/**
 * Menolak menyala bila skema database tidak cocok dengan kode ini.
 *
 * Dijalankan SEBELUM Nest membangun apa pun. Tanpa ini API menyala normal,
 * /health menjawab 200, dan kegagalannya baru muncul di halaman acak sebagai
 * 500 "Terjadi kesalahan pada server" — jauh dari sebabnya. Dua kali dalam
 * seminggu ini: sekali migrasi belum dijalankan (kode baru, DB lama), sekali
 * proses lama masih hidup setelah kolom dihapus (kode lama, DB baru).
 *
 * SKIP_MIGRATION_CHECK=true melewatinya — untuk keadaan darurat saja, dan
 * dicatat keras di log supaya tidak ada yang lupa mematikannya lagi.
 */
async function pastikanMigrasiCocok(logger: Logger): Promise<void> {
  if (process.env.SKIP_MIGRATION_CHECK === 'true') {
    logger.warn('SKIP_MIGRATION_CHECK aktif — skema database TIDAK diperiksa. Jangan biarkan ini di produksi.');
    return;
  }

  const folder = cariFolderMigrasi();
  if (!folder) {
    logger.warn('Folder migrasi tidak ditemukan — pemeriksaan skema dilewati. Set MIGRATIONS_DIR bila ini bukan lingkungan pengembangan.');
    return;
  }

  const hasil = await periksaMigrasi(folder);
  if (hasil.cocok) return;

  logger.error('API TIDAK menyala: skema database tidak cocok dengan kode.');
  for (const b of pesanPeriksaMigrasi(hasil)) logger.error(b);
  process.exit(1);
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  await pastikanMigrasiCocok(logger);

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  /*
   * Batas ukuran body dinaikkan dari bawaan Express yang 100 KB.
   *
   * Berkas di aplikasi ini dikirim sebagai base64 DI DALAM JSON — impor Excel
   * dan foto part. Dengan bawaan 100 KB, unggahan sekecil apa pun yang wajar
   * ditolak body-parser sebelum sampai ke controller, dan yang terlihat
   * pengguna hanya "Terjadi kesalahan pada server" tanpa petunjuk apa pun.
   *
   * Angkanya DITURUNKAN dari batas yang sudah kita umumkan ke pengguna, bukan
   * ditulis lepas: base64 membengkak sekitar sepertiga, ditambah ruang untuk
   * kolom lain dalam JSON yang sama. Dengan begitu batas di layar dan batas di
   * server tidak bisa menyimpang diam-diam.
   */
  const batasBody = Math.ceil((Math.max(MAKS_UKURAN_IMPOR, MAKS_UKURAN_FOTO) * 4) / 3) + 1024 * 1024;
  app.use(json({ limit: batasBody }));
  app.use(urlencoded({ limit: batasBody, extended: true }));

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000').split(','),
    credentials: true,
  });

  // SIGTERM dari Docker/systemd harus menutup koneksi DB, Redis, MQTT dengan
  // rapi. Tanpa ini, deploy ulang bisa memutus scan yang sedang diproses.
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  logger.log(`API siap di http://0.0.0.0:${port}`);
  logger.log(`SSE  : GET /realtime/line:DC-01`);
  logger.log(`Health: GET /health/ready`);
}

void bootstrap();
