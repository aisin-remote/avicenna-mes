import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SapOutboxService } from './sap-outbox.service';
import { StagingPushService } from '../staging/staging-push.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminOnly } from '../auth/admin.guard';

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

  private get simulasiAktif(): boolean {
    return (
      !this.push.aktif &&
      (process.env.STAGING_PUSH_ENABLED ?? '').trim().toLowerCase() !== 'true' &&
      (process.env.SAP_SIMULATION_ENABLED ?? '').trim().toLowerCase() === 'true'
    );
  }
}
