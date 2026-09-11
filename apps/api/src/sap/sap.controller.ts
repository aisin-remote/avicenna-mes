import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SapOutboxService } from './sap-outbox.service';
import { SapWriterService } from './sap-writer.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const retrySchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Pilih minimal satu dokumen'),
});
type RetryInput = z.infer<typeof retrySchema>;

@Controller('sap')
export class SapController {
  constructor(
    private readonly outbox: SapOutboxService,
    private readonly writer: SapWriterService,
  ) {}

  /** Ringkasan antrean, untuk kartu di layar pemantauan. */
  @Get('summary')
  async summary() {
    return { ...(await this.outbox.summary()), pengirimanAktif: this.writer.aktif };
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
}
