import { Module } from '@nestjs/common';
import { BackflushService } from './backflush.service';

@Module({ providers: [BackflushService], exports: [BackflushService] })
export class BackflushModule {}
