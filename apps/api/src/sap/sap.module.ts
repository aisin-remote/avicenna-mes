import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SapOutboxService } from './sap-outbox.service';
import { SapWriterService } from './sap-writer.service';
import { SapController } from './sap.controller';
import { SapWorker } from './sap.worker';

@Module({
  imports: [QueueModule],
  controllers: [SapController],
  providers: [SapOutboxService, SapWriterService, SapWorker],
  exports: [SapOutboxService],
})
export class SapModule {}
