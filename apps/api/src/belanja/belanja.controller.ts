import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  batalBelanjaSchema,
  scanBelanjaSchema,
  simpanBelanjaSchema,
  type BatalBelanjaInput,
  type ScanBelanjaInput,
  type SimpanBelanjaInput,
} from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BelanjaService } from './belanja.service';

/**
 * Stasiun belanja di lantai.
 *
 * Tidak @AdminOnly: yang memakainya orang yang mengambil box dari rak.
 * Pembatasannya lewat hak menu seperti stasiun scan lainnya.
 */
@Controller('belanja')
export class BelanjaController {
  constructor(private readonly belanja: BelanjaService) {}

  @Get('stasiun/:pabrik')
  stasiun(@Param('pabrik') pabrik: string) {
    return this.belanja.stasiun(pabrik);
  }

  @Post('scan')
  scan(@Body(new ZodValidationPipe(scanBelanjaSchema)) body: ScanBelanjaInput) {
    return this.belanja.scan(body);
  }

  @Post('simpan')
  simpan(
    @Body(new ZodValidationPipe(simpanBelanjaSchema)) body: SimpanBelanjaInput,
    @Req() req: Request,
  ) {
    return this.belanja.simpan(body, req.principal);
  }

  @Post('batal')
  batal(
    @Body(new ZodValidationPipe(batalBelanjaSchema)) body: BatalBelanjaInput,
    @Req() req: Request,
  ) {
    return this.belanja.batal(body, req.principal);
  }
}
