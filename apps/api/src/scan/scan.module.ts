import { Module } from '@nestjs/common';
import { ScanService } from './scan.service';
import { PapanService } from './papan.service';
import { MoldScanService } from './mold-scan.service';
import { ScanController } from './scan.controller';
import { LoadingModule } from '../loading/loading.module';
import { BelanjaModule } from '../belanja/belanja.module';

@Module({
  // Direct pulling di lini FG memakai LoadingService yang sama dengan layar pulling.
  // BelanjaModule: interlock belanja dan pelepasan kartu WIP saat assembling
  // memakai pasangannya.
  imports: [LoadingModule, BelanjaModule],
  controllers: [ScanController],
  providers: [ScanService, PapanService, MoldScanService],
  exports: [ScanService, PapanService, MoldScanService],
})
export class ScanModule {}
