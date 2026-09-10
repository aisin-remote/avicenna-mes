import { Module } from '@nestjs/common';
import { TraceService } from './trace.service';
import { TraceController } from './trace.controller';

@Module({ controllers: [TraceController], providers: [TraceService] })
export class TraceModule {}
