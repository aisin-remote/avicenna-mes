import { Global, Module } from '@nestjs/common';
import { ProcessTypeService } from './process-type.service';

/**
 * Global: katalog jenis proses dibutuhkan di jalur scan, rute, NG, dan SAP.
 * Mengimpornya satu per satu di tiap modul hanya memindahkan daftar yang sama
 * ke lima tempat, dan yang keenam pasti lupa.
 */
@Global()
@Module({
  providers: [ProcessTypeService],
  exports: [ProcessTypeService],
})
export class ProcessTypeModule {}
