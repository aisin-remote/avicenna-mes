import { Module } from '@nestjs/common';
import { LoadingService } from './loading.service';
import { LoadingController } from './loading.controller';

@Module({ controllers: [LoadingController], providers: [LoadingService] })
export class LoadingModule {}
