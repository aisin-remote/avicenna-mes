import { Module } from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanController } from './scan.controller';
import { LoadingModule } from '../loading/loading.module';

@Module({
  // Direct pulling di lini FG memakai LoadingService yang sama dengan layar pulling.
  imports: [LoadingModule],
  controllers: [ScanController],
  providers: [ScanService],
  exports: [ScanService],
})
export class ScanModule {}
