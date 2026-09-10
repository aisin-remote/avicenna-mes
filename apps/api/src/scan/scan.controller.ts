import { Body, Controller, Get, Post, Query, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { scanInputSchema, scanBatchSchema } from '@avicenna/contracts';
import type { ScanInput, ScanBatchInput } from '@avicenna/contracts';
import { ScanService } from './scan.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  /** Satu scan — jalur normal dari scanner saat jaringan normal. */
  @Post()
  @UsePipes(new ZodValidationPipe(scanInputSchema))
  async one(@Body() body: ScanInput, @Req() req: Request) {
    return this.scan.ingest([body], req.principal);
  }

  /** Batch — dipakai device yang menumpuk antrean saat offline. */
  @Post('batch')
  @UsePipes(new ZodValidationPipe(scanBatchSchema))
  async batch(@Body() body: ScanBatchInput, @Req() req: Request) {
    return this.scan.ingest(body.scans, req.principal);
  }

  /**
   * Satu scan dari layar stasiun operator.
   *
   * Dipisah dari POST /scan yang melayani device: layar butuh satu jawaban
   * lengkap (status, pesan, identitas part, penghitung) agar tidak perlu
   * request kedua di antara dua scan yang bisa datang beruntun.
   */
  @Post('station')
  @UsePipes(new ZodValidationPipe(scanInputSchema))
  async station(@Body() body: ScanInput, @Req() req: Request) {
    return this.scan.station(body, req.principal);
  }

  /** Identitas line, hitungan hari ini, dan scan terakhir — untuk memuat layar. */
  @Get('summary')
  async summary(@Query('line') line: string, @Query('limit') limit?: string) {
    return this.scan.summary(line, limit ? Number(limit) : 10);
  }

  @Get('recent')
  async recent(@Query('line') line: string, @Query('limit') limit?: string) {
    return this.scan.recent(line, limit ? Number(limit) : 50);
  }
}
