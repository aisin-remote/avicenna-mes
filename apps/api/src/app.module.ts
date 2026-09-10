import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ScanModule } from './scan/scan.module';
import { MasterModule } from './master/master.module';
import { MqttModule } from './mqtt/mqtt.module';
import { SyncModule } from './sync/sync.module';
import { HealthController } from './health/health.controller';
import { loadEnv } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env tunggal di root repo, dipakai bersama api dan web.
      envFilePath: ['../../.env'],
      validate: loadEnv,
    }),
    DbModule,
    QueueModule,
    RealtimeModule,
    AuthModule,
    ScanModule,
    MasterModule,
    MqttModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    // Semua endpoint butuh token kecuali yang ditandai @Public().
    // Default aman: endpoint baru tidak akan tidak sengaja terbuka.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
