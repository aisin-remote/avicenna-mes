import { Module } from '@nestjs/common';
import { StagingDbService } from './staging-db.service';
import { StagingSchemaService } from './staging-schema.service';
import { StagingPushService } from './staging-push.service';
import { StagingPullService } from './staging-pull.service';
import { StagingController } from './staging.controller';

/**
 * Database jembatan antara Avicenna dan SAP.
 *
 * Seluruh urusan MS SQL berhenti di modul ini. SapModule tetap memegang
 * PEMBENTUKAN dokumen — apa yang layak dikirim, movement type-nya apa,
 * dikelompokkan bagaimana — dan tidak tahu apa pun soal cara dokumen itu
 * sampai ke seberang. Pemisahan itu yang membuat pengumpulan dokumen tetap
 * berjalan saat SQL Server pabrik mati.
 *
 * Tidak ada penjadwalan di sini; jadwalnya milik SapWorker, supaya urutan
 * kumpulkan -> dorong -> baca balasan berada di satu tempat dan tidak bisa
 * berjalan saling mendahului.
 */
@Module({
  controllers: [StagingController],
  providers: [StagingDbService, StagingSchemaService, StagingPushService, StagingPullService],
  exports: [StagingDbService, StagingSchemaService, StagingPushService, StagingPullService],
})
export class StagingModule {}
