import { Body, Controller, Get, Param, Post, Query, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { scanInputSchema, scanBatchSchema,
  mulaiBerhentiSchema,
  selesaiBerhentiSchema,
  type MulaiBerhentiInput,
  type SelesaiBerhentiInput,
} from '@avicenna/contracts';
import type { ScanInput, ScanBatchInput } from '@avicenna/contracts';
import { ScanService } from './scan.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  /** Lini pada sebuah grup proses — isi modal pemilih lini. */
  @Get('proses/:grup/lines')
  liniGrup(@Param('grup') grup: string, @Req() req: Request) {
    return this.scan.liniGrup(grup, req.principal);
  }

  /** Membuka lini dari barcode yang discan operator. */
  @Post('proses/:grup/open')
  bukaLini(
    @Param('grup') grup: string,
    @Body() body: { code?: string },
    @Req() req: Request,
  ) {
    return this.scan.bukaLini(String(body?.code ?? ''), grup, req.principal);
  }

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

  /**
   * Periksa satu scan TANPA menulis — jawabannya berbentuk sama dengan station.
   *
   * Layar FG per barang menahan part sampai box penuh, baru men-scan kartu.
   * Part yang ditahan diperiksa di sini dengan aturan yang persis sama
   * (barcode, part, rute, duplikat), supaya penolakan muncul saat part
   * dipegang — bukan setelah tiga part dan satu kartu terlanjur discan.
   */
  @Post('station/periksa')
  @UsePipes(new ZodValidationPipe(scanInputSchema))
  async periksaStation(@Body() body: ScanInput, @Req() req: Request) {
    return this.scan.station(body, req.principal, { ujiSaja: true });
  }

  /** Kartu per lini untuk papan monitor di lantai produksi. */
  @Get('dashboard')
  async dashboard(@Query('plant') plant?: string) {
    return this.scan.dashboard(plant?.trim() || undefined);
  }

  /**
   * Operator menekan tombol berhenti (Problem / Setup / QC Cek).
   *
   * Satu lini hanya boleh punya satu baris terbuka; menekan dua kali
   * mengembalikan baris yang sudah ada, bukan membuat catatan bertumpuk.
   */
  @Post('berhenti')
  @UsePipes(new ZodValidationPipe(mulaiBerhentiSchema))
  async mulaiBerhenti(@Body() body: MulaiBerhentiInput, @Req() req: Request) {
    return this.scan.mulaiBerhenti(body, req.principal);
  }

  /** Operator menekan "Mulai" — menutup berhenti yang sedang berlangsung. */
  @Post('berhenti/selesai')
  @UsePipes(new ZodValidationPipe(selesaiBerhentiSchema))
  async selesaiBerhenti(@Body() body: SelesaiBerhentiInput) {
    return this.scan.selesaiBerhenti(body.lineCode, 'TOMBOL');
  }

  /** Master sample di lini per-kanban: part apa, dan boleh di lini ini? */
  @Get('sample')
  async sample(@Query('code') code: string, @Query('line') line: string) {
    return this.scan.periksaSample(String(code ?? ''), String(line ?? ''));
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
