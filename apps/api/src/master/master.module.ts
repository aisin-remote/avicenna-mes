import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { MasterImportService } from './import.service';
import { FotoService } from './foto.service';
import { MasterController } from './master.controller';

@Module({
  controllers: [MasterController],
  providers: [MasterService, MasterImportService, FotoService],
  exports: [MasterService, MasterImportService],
})
export class MasterModule {}
