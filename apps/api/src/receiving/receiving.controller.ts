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
  receivingOpenSchema,
  receivingScanSchema,
  receivingCloseSchema,
  receivingCancelSchema,
} from '@avicenna/contracts';
import { ReceivingService } from './receiving.service';
import { ReceivingSessionService } from './receiving-session.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminOnly } from '../auth/admin.guard';

@Controller('receiving')
export class ReceivingController {
  constructor(
    private readonly receiving: ReceivingService,
    private readonly sessions: ReceivingSessionService,
  ) {}

  @Post('open')
  open(
    @Body(new ZodValidationPipe(receivingOpenSchema)) body: { code: string; locationId: number },
    @Req() req: Request,
  ) {
    return this.sessions.open(body, req.principal);
  }

  @Get(':id/session')
  session(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.sessions.get(id, req.principal);
  }

  @Post(':id/scan')
  scan(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(receivingScanSchema)) body: { code: string; clientRef: string },
    @Req() req: Request,
  ) {
    return this.sessions.scan(id, body, req.principal);
  }

  @Post(':id/close')
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(receivingCloseSchema)) body: { reason?: string },
    @Req() req: Request,
  ) {
    return this.sessions.close(id, body.reason, req.principal);
  }

  @Post(':id/cancel')
  @AdminOnly()
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(receivingCancelSchema)) body: { reason: string },
    @Req() req: Request,
  ) {
    return this.sessions.cancel(id, body.reason, req.principal);
  }

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
  list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.receiving.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
      status,
      plantId:
        req.principal?.kind === 'user' && req.principal.roleKind === 'ADMIN'
          ? undefined
          : (req.principal?.plantId ?? -1),
    });
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const receipt = await this.receiving.findOne(id);
    if (receipt.aresOrderId) await this.sessions.get(id, req.principal);
    return receipt;
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
