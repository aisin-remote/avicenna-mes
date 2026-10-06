import { Module } from '@nestjs/common';
import { ReceivingService } from './receiving.service';
import { ReceivingController } from './receiving.controller';
import { ReceivingSessionService } from './receiving-session.service';

@Module({
  controllers: [ReceivingController],
  providers: [ReceivingService, ReceivingSessionService],
  exports: [ReceivingService],
})
export class ReceivingModule {}
