import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, and, inArray, asc, type Database } from '@avicenna/db';
import { menus, roleMenus, roles, users } from '@avicenna/db';
import { MENU_ITEMS, type MenuRow } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

/**
 * Menjaga TM_MENU tetap sama dengan katalog di kode, dan menjawab
 * "menu apa yang boleh dilihat orang ini".
 */
@Injectable()
export class MenuService implements OnModuleInit {
  private readonly logger = new Logger(MenuService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Disalin saat API menyala.
   *
   * Bukan lewat migrasi: katalog menu ikut berubah setiap kali ada halaman
   * baru, dan menulis migrasi untuk tiap penambahan berarti daftar kedua yang
   * pasti akan tertinggal. Yang di kode adalah kebenarannya; tabel hanya
   * bayangannya, supaya TM_ROLE_MENU punya baris untuk ditunjuk.
   *
   * Kegagalan di sini TIDAK menjatuhkan API. Menu yang belum tersalin membuat
   * sebagian layar tidak terlihat — mengganggu, tapi bisa diperbaiki dengan
   * menyalakan ulang. API yang menolak menyala menghentikan seluruh pabrik.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.sinkron();
    } catch (err) {
      this.logger.error(
        `gagal menyalin katalog menu ke TM_MENU: ${String(err)}. ` +
          'Sebagian menu mungkin tidak muncul sampai API dinyalakan ulang.',
      );
    }
  }

  async sinkron(): Promise<{ ditambah: number; diperbarui: number; dinonaktifkan: number }> {
    const adaSekarang = await this.db.select().from(menus);
    const perKunci = new Map(adaSekarang.map((m) => [m.key, m]));

    let ditambah = 0;
    let diperbarui = 0;

    for (const item of MENU_ITEMS) {
      const lama = perKunci.get(item.key);
      const nilai = {
        label: item.label,
        href: item.href,
        icon: item.icon,
        menuGroup: item.group,
        sortOrder: item.sortOrder,
        adminOnly: Boolean(item.adminOnly),
        isActive: true,
      };

      if (!lama) {
        await this.db.insert(menus).values({ key: item.key, ...nilai });
        ditambah += 1;
        continue;
      }

      const berubah =
        lama.label !== nilai.label ||
        lama.href !== nilai.href ||
        lama.icon !== nilai.icon ||
        lama.menuGroup !== nilai.menuGroup ||
        lama.sortOrder !== nilai.sortOrder ||
        lama.adminOnly !== nilai.adminOnly ||
        lama.isActive !== nilai.isActive;

      if (berubah) {
        await this.db.update(menus).set(nilai).where(eq(menus.id, lama.id));
        diperbarui += 1;
      }
    }

    /*
     * Menu yang hilang dari kode dinonaktifkan, TIDAK dihapus.
     *
     * Menghapusnya ikut menghapus pemberian haknya (ON DELETE CASCADE). Halaman
     * yang sempat dipindah lalu dikembalikan akan kehilangan seluruh daftar role
     * yang dulu boleh membukanya, dan tidak ada yang akan ingat siapa saja.
     */
    const kunciSah = new Set(MENU_ITEMS.map((m) => m.key));
    const usang = adaSekarang.filter((m) => !kunciSah.has(m.key) && m.isActive);
    if (usang.length > 0) {
      await this.db
        .update(menus)
        .set({ isActive: false })
        .where(inArray(menus.id, usang.map((m) => m.id)));
      this.logger.warn(
        `${usang.length} menu tidak ada lagi di katalog dan dinonaktifkan: ` +
          usang.map((m) => m.key).join(', '),
      );
    }

    if (ditambah || diperbarui || usang.length) {
      this.logger.log(
        `katalog menu: +${ditambah} baru, ${diperbarui} diperbarui, ${usang.length} dinonaktifkan`,
      );
    }
    return { ditambah, diperbarui, dinonaktifkan: usang.length };
  }

  /** Seluruh menu yang masih berlaku — isi daftar centang di layar role. */
  async katalog(): Promise<MenuRow[]> {
    const rows = await this.db
      .select()
      .from(menus)
      .where(eq(menus.isActive, true))
      .orderBy(asc(menus.menuGroup), asc(menus.sortOrder));

    return rows.map((m) => ({
      key: m.key,
      label: m.label,
      href: m.href,
      icon: m.icon,
      group: m.menuGroup,
      sortOrder: m.sortOrder,
      adminOnly: m.adminOnly,
    }));
  }

  /** Kunci menu milik sebuah role. */
  async kunciRole(roleId: number): Promise<string[]> {
    const rows = await this.db
      .select({ key: menus.key })
      .from(roleMenus)
      .innerJoin(menus, eq(roleMenus.menuId, menus.id))
      .where(and(eq(roleMenus.roleId, roleId), eq(menus.isActive, true)));
    return rows.map((r) => r.key);
  }

  /**
   * Menu yang tampil di sidebar orang yang sedang masuk.
   *
   * Dibaca dari database SETIAP KALI, bukan dari token. Hak yang dicabut siang
   * ini harus hilang siang ini juga — token berumur delapan jam, dan menunggu
   * sampai kedaluwarsa berarti orang yang baru dipindah tugas tetap membuka
   * layar yang bukan lagi urusannya sampai besok pagi.
   */
  async untukPrincipal(principal?: Principal): Promise<MenuRow[]> {
    const semua = await this.katalog();
    if (!principal || principal.kind !== 'user') return [];

    /*
     * ADMIN melihat semuanya.
     *
     * Bukan kemudahan: kalau hak admin ikut bergantung pada TM_ROLE_MENU, satu
     * kali salah simpan bisa menghilangkan layar pengaturan role dari SEMUA
     * orang, dan sistemnya tidak bisa diperbaiki lagi tanpa menyunting
     * database langsung.
     */
    const [aku] = await this.db
      .select({ roleId: users.roleId, kind: roles.kind })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, principal.sub))
      .limit(1);

    if (aku?.kind === 'ADMIN') return semua;
    if (!aku?.roleId) return [];

    const boleh = new Set(await this.kunciRole(aku.roleId));
    return semua.filter((m) => !m.adminOnly && boleh.has(m.key));
  }
}
