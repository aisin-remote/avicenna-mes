import { Module } from '@nestjs/common';
import { KomponenController } from './komponen.controller';
import { KomponenService } from './komponen.service';

@Module({
  controllers: [KomponenController],
  providers: [KomponenService],
  exports: [KomponenService],
})
export class KomponenModule {}
