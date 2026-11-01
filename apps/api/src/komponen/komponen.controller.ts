import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { scanKomponenSchema, type ScanKomponenInput } from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { KomponenService } from './komponen.service';

/**
 * Stasiun kanban di lantai.
 *
 * Tidak @AdminOnly: yang memakainya operator dan leader lini. Pembatasannya
 * lewat hak menu seperti stasiun scan lainnya — bukan lewat peran admin, yang
 * justru tidak ada di lantai.
 */
@Controller('komponen')
export class KomponenController {
  constructor(private readonly komponen: KomponenService) {}

  @Get('stasiun/:pabrik')
  stasiun(@Param('pabrik') pabrik: string) {
    return this.komponen.stasiun(pabrik);
  }

  @Post('scan')
  scan(
    @Body(new ZodValidationPipe(scanKomponenSchema)) body: ScanKomponenInput,
    @Req() req: Request,
  ) {
    return this.komponen.scan(body, req.principal);
  }
}
