import { Module } from '@nestjs/common';
import { ScanService } from './scan.service';
import { PapanService } from './papan.service';
import { ScanController } from './scan.controller';
import { LoadingModule } from '../loading/loading.module';

@Module({
  // Direct pulling di lini FG memakai LoadingService yang sama dengan layar pulling.
  imports: [LoadingModule],
  controllers: [ScanController],
  providers: [ScanService, PapanService],
  exports: [ScanService, PapanService],
})
export class ScanModule {}
