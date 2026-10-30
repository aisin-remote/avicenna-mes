import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  loadingScanSchema,
  loadingRfidBatchSchema,
  type LoadingScanInput,
  type LoadingRfidBatchInput,
  type LoadingRfidBatchResult,
} from '@avicenna/contracts';
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

  @Get(':id/internal-kanbans')
  internalKanbans(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') query: string | undefined,
    @Req() req: Request,
  ) {
    if (query !== undefined && typeof query !== 'string')
      throw new BadRequestException('q harus berupa teks pencarian.');
    return this.loading.internalKanbans(id, query, req.principal);
  }

  @Get(':id/delivery-order')
  deliveryOrder(@Param('id', ParseIntPipe) id: number) {
    return this.loading.deliveryOrder(id);
  }

  @Get(':id/intercompany')
  intercompany(@Param('id', ParseIntPipe) id: number) {
    return this.loading.intercompanyFlow(id);
  }

  @Get('driver-status/:id')
  driverStatus(@Param('id', ParseIntPipe) id: number) {
    return this.loading.driverStatus(id);
  }

  /** Batch tag kanban customer dari aplikasi RFID eksternal. */
  @Post('rfid/batch')
  @HttpCode(200)
  rfidBatch(
    @Body(new ZodValidationPipe(loadingRfidBatchSchema)) body: LoadingRfidBatchInput,
    @Req() req: Request,
  ): Promise<LoadingRfidBatchResult> {
    return this.loading.scanRfidBatch(body, req.principal);
  }

  /** Scan satu pasangan kanban melalui alur barcode biasa. */
  @Post('scan')
  async scan(
    @Body(new ZodValidationPipe(loadingScanSchema)) body: LoadingScanInput,
    @Req() req: Request,
  ) {
    await this.loading.authorizeScan(body.deliveryId, req.principal);
    return this.loading.scan(body, req.principal);
  }

  /** Batalkan satu kanban terakhir pada sebuah baris, pada tahap yang disebut. */
  @Post(':id/lines/:lineId/undo')
  async undo(
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Req() req: Request,
    @Body(new ZodValidationPipe(undoSchema)) body: z.infer<typeof undoSchema>,
    @Query('phase') phase?: string,
  ) {
    await this.loading.authorizeScan(id, req.principal);
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
  async pick(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.loading.authorizeScan(id, req.principal);
    return this.loading.completePicking(id, req.principal);
  }

  /** Tutup dokumen: barang berangkat, stok berkurang. */
  @Post(':id/ship')
  async ship(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.loading.authorizeScan(id, req.principal);
    return this.loading.ship(id, req.principal);
  }

  @Patch(':id/truck')
  async truck(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(truckStatusSchema)) body: TruckStatusInput,
    @Req() req: Request,
  ) {
    await this.loading.authorizeScan(id, req.principal);
    return this.loading.setTruckStatus(id, body.truckStatus, req.principal);
  }
}
