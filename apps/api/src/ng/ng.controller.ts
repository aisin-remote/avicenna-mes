import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UsePipes, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ngInlineInputSchema, ngOutlineInputSchema, ngCancelInputSchema, ngKoreksiInputSchema,
} from '@avicenna/contracts';
import type {
  NgInlineInput, NgOutlineInput, NgCancelInput, NgResult, NgKoreksiInput,
} from '@avicenna/contracts';
import { NgService, NgRejected } from './ng.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('ng')
export class NgController {
  constructor(private readonly ng: NgService) {}

  /** Jenis NG untuk sebuah grup proses — isi tombol di layar operator. */
  @Get('jenis')
  jenis(@Query('grup') grup: string | undefined, @Req() req: Request) {
    return this.ng.jenis(grup, req.principal);
  }

  /** Barang + NG yang sudah menempel padanya, dibaca sebelum jenisnya dipilih. */
  @Get('unit')
  async unit(
    @Query('code') code: string,
    @Query('line') line: string | undefined,
    @Req() req: Request,
  ) {
    if (!code?.trim()) throw new BadRequestException('Barcode kosong');
    try {
      return await this.ng.periksaUnit(code, line, req.principal);
    } catch (err) {
      throw petakan(err);
    }
  }

  /** NG inline — ketemu di lini, barangnya di tangan operator. */
  @Post('inline')
  @UsePipes(new ZodValidationPipe(ngInlineInputSchema))
  async inline(@Body() body: NgInlineInput, @Req() req: Request): Promise<NgResult> {
    try {
      return await this.ng.inline(body, req.principal);
    } catch (err) {
      throw petakan(err);
    }
  }

  /** NG outline — ketemu di luar lini, lewat part code atau lewat kanban. */
  @Post('outline')
  @UsePipes(new ZodValidationPipe(ngOutlineInputSchema))
  async outline(@Body() body: NgOutlineInput, @Req() req: Request): Promise<NgResult> {
    try {
      return await this.ng.outline(body, req.principal);
    } catch (err) {
      throw petakan(err);
    }
  }

  /** Membatalkan catatan NG. Barisnya tidak dihapus, hanya ditandai. */
  @Post('batal')
  @UsePipes(new ZodValidationPipe(ngCancelInputSchema))
  async batal(@Body() body: NgCancelInput, @Req() req: Request) {
    try {
      return await this.ng.batal(body, req.principal);
    } catch (err) {
      throw petakan(err);
    }
  }

  /** Daftar NG untuk layar Koreksi NG, beserta keadaan SAP dan riwayatnya. */
  @Get('koreksi')
  koreksiDaftar(@Query('q') q: string | undefined, @Req() req: Request) {
    return this.ng.daftarKoreksi({ q }, req.principal);
  }

  /** Koreksi qty/jenis NG, atau batalkan (qty 0). Hak: menu Koreksi NG. */
  @Post(':id/koreksi')
  async koreksi(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ngKoreksiInputSchema)) body: NgKoreksiInput,
    @Req() req: Request,
  ) {
    try {
      return await this.ng.koreksi(id, body, req.principal);
    } catch (err) {
      throw petakan(err);
    }
  }
}

/**
 * NgRejected -> 400 dengan pesannya utuh.
 *
 * Tanpa ini Nest memperlakukannya sebagai Error biasa dan mengirim 500 "Terjadi
 * kesalahan pada server" — padahal sebabnya jelas dan tindakannya ada di tangan
 * operator. Kesalahan yang sama pernah terjadi pada penolakan buka lini.
 */
function petakan(err: unknown): unknown {
  if (err instanceof NgRejected) {
    return new BadRequestException({ message: err.message, reason: err.reason });
  }
  return err;
}
