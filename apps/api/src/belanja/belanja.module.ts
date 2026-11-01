import { Module } from '@nestjs/common';
import { BelanjaController } from './belanja.controller';
import { BelanjaService } from './belanja.service';

@Module({
  controllers: [BelanjaController],
  providers: [BelanjaService],
  // Scan produksi memakainya untuk interlock dan untuk melepas kartu WIP.
  exports: [BelanjaService],
})
export class BelanjaModule {}
