import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq, and, type Database } from '@avicenna/db';
import { users, roles, devices } from '@avicenna/db';
import type { LoginInput, LoginResponse, DeviceLoginInput } from '@avicenna/contracts';
import { halamanAwal, type RoleKind } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';
import type { UserPrincipal, DevicePrincipal } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  async login(input: LoginInput): Promise<LoginResponse> {
    const rows = await this.db
      .select({
        id: users.id,
        npk: users.npk,
        name: users.name,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
        plantId: users.plantId,
        roleName: roles.name,
        roleKind: roles.kind,
        roleProcessGroup: roles.processGroup,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.npk, input.npk))
      .limit(1);

    const user = rows[0];

    // Tetap jalankan bcrypt walau user tidak ada, supaya waktu respons tidak
    // membocorkan NPK mana yang terdaftar.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const passwordOk = await bcrypt.compare(input.password, hash);

    if (!user || !passwordOk || !user.isActive) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'NPK atau password salah',
      });
    }

    const principal: UserPrincipal = {
      kind: 'user',
      sub: user.id,
      npk: user.npk,
      name: user.name,
      role: user.roleName ?? null,
      roleKind: (user.roleKind ?? null) as RoleKind | null,
      roleProcessGroup: user.roleProcessGroup ?? null,
      plantId: user.plantId ?? null,
    };

    return {
      accessToken: await this.jwt.signAsync(principal, {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as JwtSignOptions['expiresIn'],
      }),
      user: {
        id: user.id,
        npk: user.npk,
        name: user.name,
        role: user.roleName ?? null,
        roleKind: user.roleKind ?? null,
        roleProcessGroup: user.roleProcessGroup ?? null,
        /*
         * Halaman awal dikirim server, bukan ditentukan browser.
         *
         * Aturannya ada di satu tempat (@avicenna/domain) dan ikut teruji.
         * Menyalinnya ke sisi web berarti dua tempat yang harus dijaga sama,
         * dan yang tertinggal akan mengirim orang ke halaman yang keliru.
         */
        landing: halamanAwal({
          kind: (user.roleKind ?? 'VIEW') as RoleKind,
          processGroup: user.roleProcessGroup ?? null,
        }),
        plantId: user.plantId ?? null,
      },
    };
  }

  /**
   * Login terminal lapangan.
   *
   * Token device berumur panjang karena scanner tidak bisa diminta login tiap
   * shift. Konsekuensinya token harus bisa dicabut: kolom `is_active` pada
   * devices dicek setiap kali, bukan hanya saat penerbitan token.
   */
  async deviceLogin(input: DeviceLoginInput): Promise<{ accessToken: string }> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.code, input.deviceCode), eq(devices.isActive, true)))
      .limit(1);

    const device = rows[0];
    const hash = device?.tokenHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const tokenOk = await bcrypt.compare(input.token, hash);

    if (!device || !tokenOk) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Device tidak dikenal atau token salah',
      });
    }

    const principal: DevicePrincipal = {
      kind: 'device',
      sub: device.id,
      code: device.code,
      plantId: device.plantId ?? null,
    };

    return {
      accessToken: await this.jwt.signAsync(principal, {
        expiresIn: (process.env.DEVICE_JWT_EXPIRES_IN ?? '365d') as JwtSignOptions['expiresIn'],
      }),
    };
  }
}
