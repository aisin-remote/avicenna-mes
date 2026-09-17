import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { StagingModule } from '../staging/staging.module';
import { SapOutboxService } from './sap-outbox.service';
import { SapController } from './sap.controller';
import { SapWorker } from './sap.worker';

@Module({
  imports: [QueueModule, StagingModule],
  controllers: [SapController],
  providers: [SapOutboxService, SapWorker],
  exports: [SapOutboxService],
})
export class SapModule {}
