import { Controller, Get, Query } from '@nestjs/common';
import { PER_HALAMAN } from '@avicenna/contracts';
import { RoutingService } from './routing.service';
import { ProcessTypeService } from '../master/process-type.service';

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

  /** Daftar rute per part, sebentuk dengan tabel rute PPIC. */
  @Get('rute')
  rute(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('plantId') plantId?: string,
    @Query('project') project?: string,
    @Query('kelengkapan') kelengkapan?: string,
  ) {
    const minta = Number(perPage);
    return this.routing.daftarRute({
      page: Math.max(1, Number(page) || 1),
      perPage: (PER_HALAMAN as readonly number[]).includes(minta) ? minta : PER_HALAMAN[0],
      q,
      plantId: Number(plantId) || undefined,
      project: project || undefined,
      perluDilengkapi: kelengkapan === 'kurang',
    });
  }
}
