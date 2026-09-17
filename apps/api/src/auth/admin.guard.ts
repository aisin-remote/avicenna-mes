import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const IS_ADMIN_ONLY = 'isAdminOnly';

/**
 * Menandai endpoint yang hanya boleh dipanggil ADMIN.
 *
 * Dipasang DI SERVER, bukan dengan menyembunyikan menunya saja. Menu yang tidak
 * tampak bukan pembatasan: alamat endpoint-nya ada di berkas JavaScript yang
 * dikirim ke setiap browser, dan siapa pun yang punya token bisa memanggilnya
 * langsung.
 */
export const AdminOnly = () => SetMetadata(IS_ADMIN_ONLY, true);

/**
 * Dijalankan SESUDAH JwtAuthGuard, jadi req.principal sudah terisi.
 *
 * Urutan itu ditegakkan oleh urutan pendaftaran APP_GUARD di app.module.ts —
 * kalau dibalik, guard ini akan selalu melihat principal kosong dan menolak
 * semua orang, termasuk admin.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const adminOnly = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!adminOnly) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const p = req.principal;

    if (!p) throw new UnauthorizedException('Token tidak ditemukan');

    /*
     * Device TIDAK pernah jadi admin.
     *
     * Token device berumur setahun dan tertanam di terminal yang berdiri di
     * lantai produksi — kalau satu saja bocor, seluruh pengaturan pengguna bisa
     * diubah dari situ, dan token itu tidak akan kedaluwarsa dengan sendirinya.
     */
    if (p.kind !== 'user' || p.roleKind !== 'ADMIN') {
      throw new ForbiddenException('Halaman ini hanya untuk administrator.');
    }
    return true;
  }
}
