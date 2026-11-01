import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { deliveryDocumentUploadSchema, type DeliveryDocumentUpload } from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeliveryDocumentsService } from './delivery-documents.service';

@Controller('delivery-documents')
export class DeliveryDocumentsController {
  constructor(private readonly documents: DeliveryDocumentsService) {}
  @Get()
  list(@Query('deliveryId', ParseIntPipe) deliveryId: number, @Req() req: Request) {
    return this.documents.list(deliveryId, req.principal);
  }
  @Post()
  upload(
    @Body(new ZodValidationPipe(deliveryDocumentUploadSchema)) input: DeliveryDocumentUpload,
    @Req() req: Request,
  ) {
    return this.documents.upload(input, req.principal);
  }
  @Get(':id/file')
  async file(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response) {
    const file = await this.documents.file(id, req.principal);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  }
  @Get(':id')
  metadata(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.documents.metadata(id, req.principal);
  }
}
