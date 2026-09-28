import { Module } from '@nestjs/common';
import { MasterService } from './master.service';
import { MasterImportService } from './import.service';
import { MasterController } from './master.controller';

@Module({
  controllers: [MasterController],
  providers: [MasterService, MasterImportService],
  exports: [MasterService, MasterImportService],
})
export class MasterModule {}
