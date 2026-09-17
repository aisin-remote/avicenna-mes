import type { RoleKind, ProcessGroup } from '@avicenna/contracts';

/** Isi token untuk pengguna manusia. */
export interface UserPrincipal {
  kind: 'user';
  sub: number;
  npk: string;
  name: string;
  role: string | null;
  /**
   * Jabatan dan lingkup proses, ikut di dalam token.
   *
   * Tanpa keduanya server tidak bisa menegakkan siapa boleh men-scan di lini
   * mana — pemeriksaannya akan jatuh ke sisi web, tempat siapa pun bisa
   * memanggil endpoint-nya langsung.
   */
  roleKind: RoleKind | null;
  roleProcessGroup: ProcessGroup | null;
  plantId: number | null;
}

/** Isi token untuk terminal/scanner. Sengaja dibedakan dari user. */
export interface DevicePrincipal {
  kind: 'device';
  sub: number;
  code: string;
  plantId: number | null;
}

export type Principal = UserPrincipal | DevicePrincipal;

declare module 'express' {
  interface Request {
    principal?: Principal;
  }
}
