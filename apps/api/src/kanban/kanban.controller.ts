import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { cetakKanbanSchema, type CetakKanbanInput } from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { KanbanCetakService } from './kanban-cetak.service';

/** Master kanban dan pencetakannya — layar OMD. */
@Controller('kanban-master')
export class KanbanController {
  constructor(private readonly cetak: KanbanCetakService) {}

  @Get('part')
  part() {
    return this.cetak.partBisaDicetak();
  }

  @Get('rentang/:partId')
  rentang(@Param('partId') partId: string) {
    return this.cetak.rentangTerpakai(Number(partId));
  }

  @Post('pratinjau')
  pratinjau(@Body(new ZodValidationPipe(cetakKanbanSchema)) body: CetakKanbanInput) {
    return this.cetak.pratinjau(body);
  }

  @Post('buat')
  buat(
    @Body(new ZodValidationPipe(cetakKanbanSchema)) body: CetakKanbanInput,
    @Req() req: Request,
  ) {
    return this.cetak.buat(body, req.principal);
  }

  @Post('daftar')
  daftar(@Body(new ZodValidationPipe(cetakKanbanSchema)) body: CetakKanbanInput) {
    return this.cetak.daftarCetak(body);
  }
}
