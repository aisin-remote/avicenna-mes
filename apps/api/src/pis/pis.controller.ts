import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  pisPlantSchema,
  pisScanSchema,
  pisConfirmSchema,
  pisContextSchema,
  pisResetSchema,
  pisUnlockSchema,
  type PisScanInput,
  type PisConfirmInput,
  type PisContextInput,
  type PisUnlockInput,
} from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TokenDariCookie } from '../auth/jwt-auth.guard';
import { PisService } from './pis.service';

@Controller('pis')
export class PisController {
  constructor(private readonly service: PisService) {}

  @Get()
  board(
    @Query(new ZodValidationPipe(pisPlantSchema)) query: { plantId?: number },
    @Req() req: Request,
  ) {
    return this.service.board(query.plantId, req.principal);
  }

  @Post('scan')
  @HttpCode(200)
  scan(@Body(new ZodValidationPipe(pisScanSchema)) body: PisScanInput, @Req() req: Request) {
    return this.service.scan(body, req.principal);
  }

  @Post('confirm')
  @HttpCode(200)
  confirm(
    @Body(new ZodValidationPipe(pisConfirmSchema)) body: PisConfirmInput,
    @Req() req: Request,
  ) {
    return this.service.confirm(body, req.principal);
  }

  @Post('context')
  @HttpCode(200)
  context(
    @Body(new ZodValidationPipe(pisContextSchema)) body: PisContextInput,
    @Req() req: Request,
  ) {
    return this.service.context(body, req.principal);
  }

  @Post('reset')
  @HttpCode(200)
  reset(
    @Body(new ZodValidationPipe(pisResetSchema)) body: { plantId: number },
    @Req() req: Request,
  ) {
    return this.service.reset(body.plantId, req.principal);
  }

  @Post('unlock')
  @HttpCode(200)
  unlock(@Body(new ZodValidationPipe(pisUnlockSchema)) body: PisUnlockInput, @Req() req: Request) {
    return this.service.unlock(body, req.principal);
  }

  @Get('image')
  @TokenDariCookie()
  async image(@Query() query: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const file = await this.service.image(query, req.principal);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(file.bytes);
  }
}
