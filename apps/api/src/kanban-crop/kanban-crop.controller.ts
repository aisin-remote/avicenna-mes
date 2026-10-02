import { Body, Controller, Get, Param, ParseIntPipe, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { kanbanCropProfileSchema, type KanbanCropProfileInput } from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { KanbanCropService } from './kanban-crop.service';

@Controller('kanban-crops')
export class KanbanCropController {
  constructor(private readonly profiles: KanbanCropService) {}

  @Get()
  list() {
    return this.profiles.list();
  }

  @Get(':customerId')
  find(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.profiles.find(customerId);
  }

  @Put(':customerId')
  save(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body(new ZodValidationPipe(kanbanCropProfileSchema)) body: KanbanCropProfileInput,
    @Req() req: Request,
  ) {
    return this.profiles.save({ ...body, customerId }, req.principal);
  }
}
