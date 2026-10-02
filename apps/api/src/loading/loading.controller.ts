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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.loading.findOne(id);
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
    @Query('phase') phase?: string,
  ) {
    return this.loading.undoScan(id, lineId, phase === 'PULLING' ? 'PULLING' : 'LOADING');
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
