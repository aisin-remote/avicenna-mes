import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { receiptCreateSchema, type ReceiptCreateInput } from '@avicenna/contracts';
import { ReceivingService } from './receiving.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('receiving')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  /** Mencari part dari barcode yang discan di meja penerimaan. */
  @Get('resolve')
  resolve(@Query('code') code: string) {
    return this.receiving.resolve(code ?? '');
  }

  @Get()
  list(@Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.receiving.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.receiving.findOne(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(receiptCreateSchema))
  create(@Body() body: ReceiptCreateInput, @Req() req: Request) {
    return this.receiving.create(body, req.principal);
  }
}
