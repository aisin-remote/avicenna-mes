import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { ProcessTypeModule } from './master/process-type.module';
import { SettingModule } from './setting/setting.module';
import { KomponenModule } from './komponen/komponen.module';
import { BelanjaModule } from './belanja/belanja.module';
import { KanbanModule } from './kanban/kanban.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AdminGuard } from './auth/admin.guard';
import { ScanModule } from './scan/scan.module';
import { NgModule } from './ng/ng.module';
import { AdminModule } from './admin/admin.module';
import { MasterModule } from './master/master.module';
import { ReceivingModule } from './receiving/receiving.module';
import { TraceModule } from './trace/trace.module';
import { TransferModule } from './transfer/transfer.module';
import { LoadingModule } from './loading/loading.module';
import { PisModule } from './pis/pis.module';
import { KanbanCropModule } from './kanban-crop/kanban-crop.module';
import { SapModule } from './sap/sap.module';
import { StagingModule } from './staging/staging.module';
import { PreparationModule } from './preparation/preparation.module';
import { RoutingModule } from './routing/routing.module';
import { BomModule } from './bom/bom.module';
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
    ProcessTypeModule,
    SettingModule,
    KomponenModule,
    BelanjaModule,
    KanbanModule,
    QueueModule,
    RealtimeModule,
    AuthModule,
    ScanModule,
    NgModule,
    AdminModule,
    MasterModule,
    ReceivingModule,
    TraceModule,
    TransferModule,
    LoadingModule,
    PisModule,
    KanbanCropModule,
    SapModule,
    StagingModule,
    PreparationModule,
    RoutingModule,
    BomModule,
    MqttModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    // Semua endpoint butuh token kecuali yang ditandai @Public().
    // Default aman: endpoint baru tidak akan tidak sengaja terbuka.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    /*
     * URUTAN PENTING: AdminGuard membaca req.principal yang baru diisi
     * JwtAuthGuard. Dibalik, ia selalu melihat principal kosong dan menolak
     * semua orang — termasuk admin.
     */
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
})
export class AppModule {}
