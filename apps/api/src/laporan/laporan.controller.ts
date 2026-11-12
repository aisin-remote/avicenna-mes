import { Controller, Get, Query } from '@nestjs/common';
import { LaporanService } from './laporan.service';

@Controller('laporan')
export class LaporanController {
  constructor(private readonly laporan: LaporanService) {}

  /** Dashboard efisiensi satu shift: per line, per jam, RIL/ROL. */
  @Get('efisiensi')
  efisiensi(
    @Query('plant') plant?: string,
    @Query('tanggal') tanggal?: string,
    @Query('shift') shift?: string,
    @Query('proses') proses?: string,
  ) {
    return this.laporan.dashboard({ plant, tanggal, shift, proses });
  }

  /** Laporan produksi per tanggal × shift × line × part. */
  @Get('produksi')
  produksi(
    @Query('plant') plant?: string,
    @Query('dari') dari?: string,
    @Query('sampai') sampai?: string,
  ) {
    return this.laporan.laporan({ plant, dari, sampai });
  }
}
