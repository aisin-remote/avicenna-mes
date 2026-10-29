import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PENGATURAN } from '@avicenna/contracts';
import { AdminOnly } from '../auth/admin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SettingService } from './setting.service';

const ubahSchema = z.object({
  nilai: z.boolean({
    required_error: 'Nilai wajib diisi',
    invalid_type_error: 'Nilai harus benar atau salah',
  }),
});

/**
 * Pengaturan sistem.
 *
 * @AdminOnly di TINGKAT CONTROLLER, mengikuti AdminController: endpoint baru
 * ikut terlindungi tanpa harus diingat. Saklar di sini menentukan apakah
 * sistem menulis ke SAP — membukanya ke sembarang pemegang token berarti siapa
 * pun bisa menghentikan aliran dokumen ke SAP tanpa jejak di layar mana pun.
 */
@Controller('setting')
@AdminOnly()
export class SettingController {
  constructor(private readonly setting: SettingService) {}

  /**
   * Definisi DAN nilai yang berlaku, dalam satu balasan.
   *
   * Digabung supaya layar tidak perlu dua permintaan lalu mencocokkannya
   * sendiri — dan supaya label beserta peringatannya tidak bisa tertinggal
   * versi lama saat registry berubah.
   */
  @Get()
  async daftar() {
    return { definisi: PENGATURAN, nilai: await this.setting.daftar() };
  }

  @Patch(':key')
  async ubah(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(ubahSchema)) body: { nilai: boolean },
    @Req() req: Request,
  ) {
    const p = req.principal;
    const npk = p && p.kind === 'user' ? p.npk : null;
    return { nilai: await this.setting.ubah(key, body.nilai, npk) };
  }
}
