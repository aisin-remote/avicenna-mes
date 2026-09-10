import {
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
import {
  receiptCreateSchema,
  receiptUpdateSchema,
  type ReceiptCreateInput,
  type ReceiptUpdateInput,
} from '@avicenna/contracts';
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

  /** Resolve banyak part sekaligus — dipakai saat impor tempelan. */
  @Post('resolve-bulk')
  async resolveBulk(@Body() body: { partNumbers?: string[] }) {
    const map = await this.receiving.resolveBulk(body?.partNumbers ?? []);
    return Object.fromEntries(map);
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

  /*
   * Pipe dipasang di parameter @Body(), BUKAN lewat @UsePipes di level method.
   *
   * @UsePipes menerapkan pipe ke SELURUH parameter — termasuk @Param('id')
   * yang berupa string dan @Req() yang berupa objek request. Schema Zod untuk
   * body lalu dijalankan atas keduanya dan menolak dengan "Expected object,
   * received string", padahal body-nya sendiri sudah benar.
   */
  @Post()
  create(
    @Body(new ZodValidationPipe(receiptCreateSchema)) body: ReceiptCreateInput,
    @Req() req: Request,
  ) {
    return this.receiving.create(body, req.principal);
  }

  /** Mengubah penerimaan yang sudah tercatat; selisihnya dicatat sebagai koreksi. */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(receiptUpdateSchema)) body: ReceiptUpdateInput,
    @Req() req: Request,
  ) {
    return this.receiving.update(id, body, req.principal);
  }
}
