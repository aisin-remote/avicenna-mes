import { Module } from '@nestjs/common';
import { StagingModule } from '../staging/staging.module';
import { PreparationController } from './preparation.controller';
import { PreparationService } from './preparation.service';
@Module({
  imports: [StagingModule],
  controllers: [PreparationController],
  providers: [PreparationService],
})
export class PreparationModule {}
