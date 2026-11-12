import { Module } from '@nestjs/common';
import { KomponenController } from './komponen.controller';
import { KomponenService } from './komponen.service';
import { ScanModule } from '../scan/scan.module';

@Module({
  imports: [ScanModule],
  controllers: [KomponenController],
  providers: [KomponenService],
  exports: [KomponenService],
})
export class KomponenModule {}
