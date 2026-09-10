import { Module } from '@nestjs/common';
import { J922SyncService } from './j922-sync.service';

@Module({ providers: [J922SyncService], exports: [J922SyncService] })
export class SyncModule {}
