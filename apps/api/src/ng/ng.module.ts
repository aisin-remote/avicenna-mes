import { Module } from '@nestjs/common';
import { NgService } from './ng.service';
import { NgController } from './ng.controller';
import { ScanModule } from '../scan/scan.module';

@Module({
  // Pengenalan part dipinjam dari ScanService supaya jalurnya sama persis
  // dengan scan produksi — lihat komentar kenaliPart().
  imports: [ScanModule],
  controllers: [NgController],
  providers: [NgService],
  exports: [NgService],
})
export class NgModule {}
