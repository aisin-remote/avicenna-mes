import { Controller, Get, Query } from '@nestjs/common';
import { TraceService } from './trace.service';
import { TraceabilityService } from './traceability.service';

@Controller('trace')
export class TraceController {
  constructor(
    private readonly trace: TraceService,
    private readonly traceability: TraceabilityService,
  ) {}

  /** Trace Part: QR unit, atau nomor/back number part. */
  @Get('part')
  part(@Query('q') q?: string) {
    return this.traceability.part((q ?? '').slice(0, 300));
  }

  /** Trace Kanban: isi QR kartu, "BACK SERI", atau back/nomor part. */
  @Get('kanban')
  kanban(@Query('q') q?: string) {
    return this.traceability.kanban((q ?? '').slice(0, 300));
  }

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
