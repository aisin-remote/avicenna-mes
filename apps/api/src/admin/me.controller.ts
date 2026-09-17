import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { eq, type Database } from '@avicenna/db';
import { users, roles, plants } from '@avicenna/db';
import { halamanAwal } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';
import { MenuService } from './menu.service';

/**
 * Milik pengguna yang sedang masuk — BUKAN @AdminOnly.
 *
 * Sidebar setiap orang memanggil ini, jadi jawabannya harus selalu berupa
 * daftar miliknya sendiri: hak tidak pernah dibaca dari parameter, melainkan
 * dari token. Endpoint yang menerima id pengguna sebagai parameter akan bisa
 * dipakai siapa pun untuk melihat menu orang lain.
 */
@Controller('me')
export class MeController {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly menu: MenuService,
  ) {}

  /**
   * Siapa saya SEKARANG — dibaca dari database, bukan dari isi token.
   *
   * ── Kenapa tidak cukup membaca token ────────────────────────────────────
   *
   * Token memuat salinan jabatan pada saat login dan berlaku delapan jam.
   * Salinan itu basi dalam dua keadaan yang dua-duanya nyata: role orangnya
   * diubah siang ini, atau token diterbitkan oleh API versi lama yang belum
   * menyertakan jabatan sama sekali.
   *
   * Yang kedua pernah terjadi tepat setelah jabatan ditambahkan ke token:
   * administrator sungguhan dibawa kembali ke dashboard setiap kali membuka
   * layar pengaturan, karena token di browsernya tidak menyebut jabatan apa
   * pun — dan tidak ada satu pesan pun yang menjelaskan sebabnya.
   *
   * Sidebar sudah membaca haknya dari database (lihat /me/menus). Endpoint ini
   * membuat penjagaan halaman memakai sumber yang SAMA, sehingga keduanya tidak
   * mungkin lagi berselisih.
   */
  @Get()
  async profil(@Req() req: Request) {
    const p = req.principal;
    if (!p || p.kind !== 'user') throw new UnauthorizedException('Bukan sesi pengguna');

    const [row] = await this.db
      .select({
        id: users.id,
        npk: users.npk,
        name: users.name,
        isActive: users.isActive,
        roleName: roles.name,
        roleLabel: roles.label,
        roleKind: roles.kind,
        roleProcessGroup: roles.processGroup,
        roleActive: roles.isActive,
        plantId: users.plantId,
        plantCode: plants.code,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(plants, eq(users.plantId, plants.id))
      .where(eq(users.id, p.sub))
      .limit(1);

    /*
     * Akun yang dihapus atau dinonaktifkan sementara tokennya masih berlaku.
     * Ditolak di sini, bukan dibiarkan lewat sebagai "tanpa jabatan" — yang
     * terakhir akan terlihat seperti orangnya kehilangan hak, bukan seperti
     * akunnya memang sudah tidak berlaku.
     */
    if (!row || !row.isActive) {
      throw new UnauthorizedException('Akun sudah tidak aktif. Silakan masuk kembali.');
    }

    // Role yang dinonaktifkan tidak lagi memberi jabatan apa pun.
    const kind = row.roleActive ? row.roleKind : null;

    return {
      id: row.id,
      npk: row.npk,
      name: row.name,
      role: row.roleName,
      roleLabel: row.roleLabel,
      roleKind: kind,
      roleProcessGroup: row.roleProcessGroup,
      plantId: row.plantId,
      plantCode: row.plantCode,
      landing: halamanAwal({
        kind: kind ?? 'VIEW',
        processGroup: row.roleProcessGroup ?? null,
      }),
    };
  }

  /**
   * Menu yang boleh dilihat orang ini.
   *
   * Dibaca dari database setiap kali, bukan dari token: hak yang dicabut siang
   * ini harus hilang siang ini juga, bukan menunggu token delapan jam habis.
   */
  @Get('menus')
  menus(@Req() req: Request) {
    return this.menu.untukPrincipal(req.principal);
  }
}
