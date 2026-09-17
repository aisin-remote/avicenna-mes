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
import { ReceivingModule } from './receiving/receiving.module';
import { TraceModule } from './trace/trace.module';
import { TransferModule } from './transfer/transfer.module';
import { LoadingModule } from './loading/loading.module';
import { SapModule } from './sap/sap.module';
import { StagingModule } from './staging/staging.module';
import { RoutingModule } from './routing/routing.module';
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
    ReceivingModule,
    TraceModule,
    TransferModule,
    LoadingModule,
    SapModule,
    StagingModule,
    RoutingModule,
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
