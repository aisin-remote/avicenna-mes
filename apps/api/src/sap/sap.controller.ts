import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SapOutboxService } from './sap-outbox.service';
import { StagingPushService } from '../staging/staging-push.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminOnly } from '../auth/admin.guard';
import { SettingService } from '../setting/setting.service';

const retrySchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Pilih minimal satu dokumen'),
});
type RetryInput = z.infer<typeof retrySchema>;

const simulateSchema = z.object({
  id: z.coerce.number().int().positive(),
  outcome: z.enum(['CONFIRMED', 'REJECTED', 'PENDING']),
});
type SimulateInput = z.infer<typeof simulateSchema>;

@Controller('sap')
export class SapController {
  constructor(
    private readonly outbox: SapOutboxService,
    private readonly push: StagingPushService,
    private readonly setting: SettingService,
  ) {}

  /** Ringkasan antrean, untuk kartu di layar pemantauan. */
  @Get('summary')
  async summary() {
    return {
      ...(await this.outbox.summary()),
      pengirimanAktif: this.push.aktif,
      simulasiAktif: this.simulasiAktif,
    };
  }

  @Get('outbox')
  list(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.outbox.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
      status,
    });
  }

  /**
   * NG yang belum sampai ke SAP padahal hasil produksinya sudah.
   *
   * Dibuka sebagai endpoint sendiri, bukan diselipkan ke /sap/summary, supaya
   * jelas ini DAFTAR PEKERJAAN orang — koreksi PP-PE-06 dikerjakan manual di
   * SAP — bukan angka antrean yang akan beres sendiri.
   */
  @Get('ng-perlu-koreksi')
  ngPerluKoreksi(@Query('limit') limit?: string) {
    return this.outbox.ngPerluKoreksi(Math.min(500, Math.max(1, Number(limit) || 200)));
  }

  /** Mengumpulkan sekarang juga, tanpa menunggu putaran berikutnya. */
  @Post('collect')
  async collect() {
    const hasil = await this.outbox.collect();
    const lepas = await this.outbox.releaseHeld();
    return { ...hasil, ...lepas };
  }

  @Post('retry')
  retry(@Body(new ZodValidationPipe(retrySchema)) body: RetryInput) {
    return this.outbox.retry(body.ids);
  }

  /**
   * Mengembalikan dokumen yang DITOLAK SAP ke antrean.
   *
   * Dipisah dari retry() karena penyebabnya berbeda: retry untuk kegagalan
   * teknis saat mendorong, ini untuk penolakan dari SAP. Mendorong ulang tanpa
   * memperbaiki datanya hanya akan ditolak lagi, jadi tombolnya pun berbeda.
   */
  @Post('resend')
  resend(@Body(new ZodValidationPipe(retrySchema)) body: RetryInput) {
    return this.push.dorongUlang(body.ids);
  }

  /** Trial lokal/UAT. Tidak pernah tersedia ketika push staging nyata aktif. */
  @Post('simulate')
  @AdminOnly()
  simulate(@Body(new ZodValidationPipe(simulateSchema)) body: SimulateInput) {
    if (!this.simulasiAktif) {
      throw new BadRequestException(
        'Simulasi SAP tidak aktif. Set SAP_SIMULATION_ENABLED=true saat push staging mati.',
      );
    }
    return this.outbox.simulateDelivery(body.id, body.outcome);
  }

  /*
   * Dua syarat, bukan satu — dan keduanya kini dibaca dari pengaturan sistem
   * supaya cocok dengan apa yang tampil di layar Pengaturan.
   *
   * Simulasi hanya boleh jalan saat dorong ke staging MATI. Kalau tidak,
   * dokumen yang sudah benar-benar dikirim ke SAP bisa dipalsukan balasannya
   * dari layar, dan status di sini tidak lagi mencerminkan keadaan di SAP.
   */
  private get simulasiAktif(): boolean {
    return (
      !this.push.aktif &&
      !this.setting.aktifSekarang('STAGING_PUSH_ENABLED') &&
      this.setting.aktifSekarang('SAP_SIMULATION_ENABLED')
    );
  }
}
