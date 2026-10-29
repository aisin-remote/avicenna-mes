import { Global, Module } from '@nestjs/common';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';

/**
 * Global, dengan alasan yang sama seperti ProcessTypeModule: saklar sistem
 * ditanyakan di jalur staging, SAP, dan sinkronisasi mesin. Mengimpornya satu
 * per satu di tiap modul hanya memindahkan daftar yang sama ke beberapa
 * tempat, dan yang terakhir pasti lupa.
 */
@Global()
@Module({
  controllers: [SettingController],
  providers: [SettingService],
  exports: [SettingService],
})
export class SettingModule {}
