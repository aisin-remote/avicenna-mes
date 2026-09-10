import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { transferCreateSchema, type TransferCreateInput } from '@avicenna/contracts';
import { TransferService } from './transfer.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('transfer')
export class TransferController {
  constructor(private readonly transfer: TransferService) {}

  /** Stok tercatat sebuah part, dirinci per lot. */
  @Get('availability')
  availability(@Query('partId') partId: string) {
    return this.transfer.availability(Number(partId));
  }

  @Get()
  list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.transfer.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.transfer.findOne(id);
  }

  // Pipe di level parameter, bukan @UsePipes — @UsePipes menerapkannya juga
  // pada @Param dan @Req sehingga body yang benar ikut ditolak.
  @Post()
  create(
    @Body(new ZodValidationPipe(transferCreateSchema)) body: TransferCreateInput,
    @Req() req: Request,
  ) {
    return this.transfer.create(body, req.principal);
  }
}
