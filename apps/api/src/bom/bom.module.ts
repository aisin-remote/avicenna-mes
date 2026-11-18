import { Module } from '@nestjs/common';
import { RoutingModule } from '../routing/routing.module';
import { StagingModule } from '../staging/staging.module';
import { BomController } from './bom.controller';
import { BomService } from './bom.service';

@Module({
  imports: [StagingModule, RoutingModule],
  controllers: [BomController],
  providers: [BomService],
})
export class BomModule {}
