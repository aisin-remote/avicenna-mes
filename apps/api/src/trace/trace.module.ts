import { Module } from '@nestjs/common';
import { TraceService } from './trace.service';
import { TraceController } from './trace.controller';
import { TraceabilityService } from './traceability.service';

/** Telusur silsilah (lama) dan menu Traceability: Trace Part & Trace Kanban. */
@Module({ controllers: [TraceController], providers: [TraceService, TraceabilityService] })
export class TraceModule {}
