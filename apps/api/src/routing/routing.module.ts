import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { RoutingController } from './routing.controller';

/**
 * Rute proses per part.
 *
 * Berdiri sendiri, bukan menumpang MasterModule: rute punya aturan yang tidak
 * dimiliki master biasa — urutannya bermakna, dan penyimpanannya mengganti
 * seluruh rute satu part sekaligus, bukan baris per baris.
 */
@Module({
  controllers: [RoutingController],
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
