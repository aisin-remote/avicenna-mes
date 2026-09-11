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
import {
  loadingCreateSchema,
  loadingScanSchema,
  type LoadingCreateInput,
  type LoadingScanInput,
} from '@avicenna/contracts';
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
  list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.loading.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
    });
  }

  /** Part yang bisa dimuat untuk sebuah customer, beserta penomoran customer-nya. */
  @Get('catalog')
  catalog(@Query('customerId') customerId: string, @Query('plantId') plantId?: string) {
    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('customerId wajib diisi');
    }
    return this.loading.customerCatalog(id, plantId ? Number(plantId) : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.loading.findOne(id);
  }

  // Pipe di level parameter, bukan @UsePipes — @UsePipes menerapkannya juga
  // pada @Param dan @Req sehingga body yang benar ikut ditolak.
  @Post()
  create(
    @Body(new ZodValidationPipe(loadingCreateSchema)) body: LoadingCreateInput,
    @Req() req: Request,
  ) {
    return this.loading.create(body, req.principal);
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

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.loading.cancel(id);
  }
}
