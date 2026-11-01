import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  preparationFilterSchema,
  preparationScheduleSchema,
  type PreparationFilter,
  type PreparationScheduleInput,
} from '@avicenna/contracts';
import { PreparationService } from './preparation.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminOnly } from '../auth/admin.guard';

const syncSchema = z.object({ date: preparationFilterSchema.innerType().shape.from });
@Controller('preparation')
export class PreparationController {
  constructor(private readonly service: PreparationService) {}
  @Get()
  snapshot(
    @Query(new ZodValidationPipe(preparationFilterSchema)) filters: PreparationFilter,
    @Req() req: Request,
  ) {
    return this.service.snapshot(filters, req.principal);
  }
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.detail(id, req.principal);
  }
  @Post('cycles')
  @AdminOnly()
  create(
    @Body(new ZodValidationPipe(preparationScheduleSchema)) input: PreparationScheduleInput,
    @Req() req: Request,
  ) {
    return this.service.saveSchedule(null, input, req.principal);
  }
  @Put('cycles/:id')
  @AdminOnly()
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(preparationScheduleSchema)) input: PreparationScheduleInput,
    @Req() req: Request,
  ) {
    return this.service.saveSchedule(id, input, req.principal);
  }
  @Delete('cycles/:id')
  @AdminOnly()
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.service.deleteSchedule(id, req.principal);
  }
  @Post('sync')
  @AdminOnly()
  sync(
    @Body(new ZodValidationPipe(syncSchema)) input: z.infer<typeof syncSchema>,
    @Req() req: Request,
  ) {
    return this.service.sync(input.date, req.principal);
  }
}
