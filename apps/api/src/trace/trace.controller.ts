import { Controller, Get, Query } from '@nestjs/common';
import { TraceService } from './trace.service';

@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  /** Unit ini terbuat dari apa. */
  @Get('backward')
  backward(@Query('serial') serial: string) {
    return this.trace.backward(serial ?? '');
  }

  /** Lot ini masuk ke unit mana saja. */
  @Get('forward')
  forward(@Query('lot') lot: string, @Query('limit') limit?: string) {
    return this.trace.forward(lot ?? '', limit ? Number(limit) : 200);
  }
}
