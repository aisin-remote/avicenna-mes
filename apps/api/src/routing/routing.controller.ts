import { Body, Controller, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { processTypeSchema } from '@avicenna/contracts';
import { RoutingService } from './routing.service';
import { ProcessTypeService } from '../master/process-type.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const ruteSchema = z.object({
  /** Terurut sesuai jalannya barang. Kosong berarti rutenya dihapus. */
  proses: z.array(processTypeSchema).max(20),
});
type RuteInput = z.infer<typeof ruteSchema>;

@Controller('routing')
export class RoutingController {
  constructor(
    private readonly routing: RoutingService,
    private readonly processTypeService: ProcessTypeService,
  ) {}

  /**
   * Katalog jenis proses untuk layar.
   *
   * Dibuka di sini, bukan lewat /master/process-types, karena dua hal berbeda:
   * yang itu CRUD berpaginasi dan berhak admin, yang ini daftar utuh terurut
   * untuk mengisi label kolom dan pilihan — dibutuhkan setiap layar yang
   * menyebut nama proses, termasuk oleh pengguna yang tidak boleh menyunting
   * masternya.
   *
   * Termasuk yang nonaktif: riwayat lama tetap harus bisa disebut namanya.
   * Yang menyusun rute baru menyaring sendiri lewat `isActive`.
   */
  @Get('process-types')
  async processTypes() {
    const katalog = await this.processTypeService.katalog();
    return { data: katalog.daftar.map((j) => ({ ...j })) };
  }


  /** Matriks part × proses — bentuk yang sama dengan tabel rute di lapangan. */
  @Get('matrix')
  matriks(@Query('plantId') plantId?: string) {
    const id = Number(plantId);
    return this.routing.matriks(Number.isFinite(id) && id > 0 ? id : undefined);
  }

  @Get('lines')
  lines() {
    return this.routing.liniPerProses();
  }

  /*
   * Tidak ada lagi endpoint pengaturan SAP per langkah part. Pengaturannya per
   * PROSES, dikelola lewat master generik: /master/route-processes.
   */

  /** Mengganti seluruh rute satu part sekaligus. */
  @Put('part/:partId')
  simpan(
    @Param('partId', ParseIntPipe) partId: number,
    @Body(new ZodValidationPipe(ruteSchema)) body: RuteInput,
  ) {
    return this.routing.simpanRute(partId, body.proses);
  }
}
