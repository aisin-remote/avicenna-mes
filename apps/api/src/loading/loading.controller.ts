import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { loadingScanSchema, type LoadingScanInput } from '@avicenna/contracts';
import { LoadingService } from './loading.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const truckStatusSchema = z.object({
  truckStatus: z.enum(['PENDING', 'ARRIVED', 'LOADING', 'DEPARTED']),
});
type TruckStatusInput = z.infer<typeof truckStatusSchema>;

const returnedDocumentSchema = z.object({
  code: z.string().trim().min(1, 'Barcode surat jalan kosong').max(128),
});
type ReturnedDocumentInput = z.infer<typeof returnedDocumentSchema>;
const undoSchema = z.object({ reason: z.string().trim().min(3).max(255) });

@Controller('loading')
export class LoadingController {
  constructor(private readonly loading: LoadingService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('date') date?: string,
    @Query('all') all?: string,
    @Query('q') query?: string,
    @Query('attention') attention?: string,
  ) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date harus berformat YYYY-MM-DD');
    }
    return this.loading.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
      operationalDate: date,
      all: all === '1' || all === 'true',
      query: query?.trim().slice(0, 128),
      attention: attention === 'only' ? 'only' : attention === 'all' ? 'all' : undefined,
    });
  }

  /** Cari loading list dari barcode manifest atau nomor loading list. */
  @Get('resolve')
  resolve(@Query('code') code?: string) {
    return this.loading.resolveDocument(code ?? '');
  }

  /** Status sinkronisasi terakhir; tetap JSON saat tanggal belum pernah disinkronkan. */
  @Get('sync-status')
  async syncStatus(@Query('date') date?: string) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('date harus berformat YYYY-MM-DD');
    return { data: await this.loading.syncStatus(date) };
  }

  /** Scan surat jalan yang kembali sebagai bukti barang diterima customer. */
  @Post('receive')
  receive(
    @Body(new ZodValidationPipe(returnedDocumentSchema)) body: ReturnedDocumentInput,
    @Req() req: Request,
  ) {
    return this.loading.receiveReturnedDocument(body.code, req.principal);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.loading.findOne(id);
  }

  @Get(':id/history')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.loading.history(id);
  }

  /** Scan satu kanban saat muat barang. */
  @Post('scan')
  scan(
    @Body(new ZodValidationPipe(loadingScanSchema)) body: LoadingScanInput,
    @Req() req: Request,
  ) {
    return this.loading.scan(body, req.principal);
  }

  /** Batalkan satu kanban terakhir pada sebuah baris, pada tahap yang disebut. */
  @Post(':id/lines/:lineId/undo')
  undo(
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Req() req: Request,
    @Body(new ZodValidationPipe(undoSchema)) body: z.infer<typeof undoSchema>,
    @Query('phase') phase?: string,
  ) {
    return this.loading.undoScan(
      id,
      lineId,
      phase === 'PULLING' ? 'PULLING' : 'LOADING',
      req.principal,
      body.reason,
    );
  }

  /** Tutup pulling: barang berpindah dari gudang finish good ke staging. */
  @Post(':id/pick')
  pick(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.loading.completePicking(id, req.principal);
  }

  /** Tutup dokumen: barang berangkat, stok berkurang. */
  @Post(':id/ship')
  ship(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.loading.ship(id, req.principal);
  }

  @Patch(':id/truck')
  truck(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(truckStatusSchema)) body: TruckStatusInput,
    @Req() req: Request,
  ) {
    return this.loading.setTruckStatus(id, body.truckStatus, req.principal);
  }
}
