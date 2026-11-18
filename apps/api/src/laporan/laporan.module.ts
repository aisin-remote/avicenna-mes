import { Module } from '@nestjs/common';
import { LaporanController } from './laporan.controller';
import { LaporanService } from './laporan.service';

/** Dashboard efisiensi dan laporan produksi — hanya membaca. */
@Module({ controllers: [LaporanController], providers: [LaporanService] })
export class LaporanModule {}
