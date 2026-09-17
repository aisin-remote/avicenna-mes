import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, inArray, asc, count, type Database } from '@avicenna/db';
import { roles, users, menus, roleMenus } from '@avicenna/db';
import {
  roleCreateSchema,
  roleUpdateSchema,
  roleMenusSchema,
  isMenuKey,
  type RoleRow,
} from '@avicenna/contracts';
import { halamanAwal } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';
import { parseOrThrow } from '../common/validation-error';
import { MenuService } from './menu.service';

const MYSQL_DUP_ENTRY = 1062;

@Injectable()
export class RolesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly menu: MenuService,
  ) {}

  async list(): Promise<RoleRow[]> {
    const rows = await this.db.select().from(roles).orderBy(asc(roles.name));

    // Jumlah pengguna dihitung sekali untuk semua role, bukan satu query per
    // baris: daftar role dibuka tiap kali layar dimuat, dan N+1 di sini
    // menumpuk tanpa memberi apa pun.
    const jumlah = await this.db
      .select({ roleId: users.roleId, n: count() })
      .from(users)
      .groupBy(users.roleId);
    const perRole = new Map(jumlah.map((j) => [j.roleId, Number(j.n)]));

    const tautan = await this.db
      .select({ roleId: roleMenus.roleId, key: menus.key })
      .from(roleMenus)
      .innerJoin(menus, eq(roleMenus.menuId, menus.id))
      .where(eq(menus.isActive, true));
    const menuPerRole = new Map<number, string[]>();
    for (const t of tautan) {
      const daftar = menuPerRole.get(t.roleId) ?? [];
      daftar.push(t.key);
      menuPerRole.set(t.roleId, daftar);
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      label: r.label,
      kind: r.kind,
      processGroup: r.processGroup,
      isActive: r.isActive,
      userCount: perRole.get(r.id) ?? 0,
      menuKeys: menuPerRole.get(r.id) ?? [],
      // Ditampilkan supaya orang yang mengatur role tahu ke mana pemegangnya
      // akan dibawa sesudah login — aturannya diturunkan, bukan diketik.
      landing: halamanAwal({ kind: r.kind, processGroup: r.processGroup }),
    }));
  }

  async findOne(id: number): Promise<RoleRow> {
    const semua = await this.list();
    const row = semua.find((r) => r.id === id);
    if (!row) throw new NotFoundException(`Role #${id} tidak ditemukan`);
    return row;
  }

  async create(body: unknown): Promise<RoleRow> {
    const input = parseOrThrow(roleCreateSchema, body);
    this.periksaKunciMenu(input.menuKeys);

    let id: number;
    try {
      const hasil = await this.db.insert(roles).values({
        name: input.name,
        label: input.label ?? null,
        kind: input.kind,
        processGroup: input.processGroup ?? null,
        isActive: input.isActive,
      });
      id = Number((hasil as unknown as Array<{ insertId: number }>)[0]?.insertId);
    } catch (err) {
      throw this.terjemahkan(err, input.name);
    }

    await this.simpanMenu(id, input.menuKeys);
    return this.findOne(id);
  }

  async update(id: number, body: unknown): Promise<RoleRow> {
    const input = parseOrThrow(roleUpdateSchema, body);
    const [lama] = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!lama) throw new NotFoundException(`Role #${id} tidak ditemukan`);

    if (input.menuKeys) this.periksaKunciMenu(input.menuKeys);

    const patch: Partial<typeof roles.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.label !== undefined) patch.label = input.label ?? null;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.processGroup !== undefined) patch.processGroup = input.processGroup ?? null;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    /*
     * Role ADMIN terakhir tidak boleh kehilangan jabatannya.
     *
     * Menurunkan satu-satunya role admin menjadi VIEW mengunci semua orang di
     * luar layar pengaturan, dan satu-satunya jalan kembali adalah menyunting
     * database langsung.
     */
    if (lama.kind === 'ADMIN' && patch.kind && patch.kind !== 'ADMIN') {
      await this.pastikanBukanAdminTerakhir(id, 'menurunkan jabatannya dari ADMIN');
    }
    if (lama.kind === 'ADMIN' && patch.isActive === false) {
      await this.pastikanBukanAdminTerakhir(id, 'menonaktifkannya');
    }

    if (Object.keys(patch).length > 0) {
      try {
        await this.db.update(roles).set(patch).where(eq(roles.id, id));
      } catch (err) {
        throw this.terjemahkan(err, input.name ?? lama.name);
      }
    }

    if (input.menuKeys) await this.simpanMenu(id, input.menuKeys);
    return this.findOne(id);
  }

  /** Mengganti SELURUH daftar menu sebuah role. */
  async setMenus(id: number, body: unknown): Promise<RoleRow> {
    const { menuKeys } = parseOrThrow(roleMenusSchema, body);
    const [ada] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.id, id)).limit(1);
    if (!ada) throw new NotFoundException(`Role #${id} tidak ditemukan`);

    this.periksaKunciMenu(menuKeys);
    await this.simpanMenu(id, menuKeys);
    return this.findOne(id);
  }

  async remove(id: number): Promise<{ id: number }> {
    const [row] = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Role #${id} tidak ditemukan`);

    /*
     * Role yang masih dipegang orang TIDAK dihapus.
     *
     * Menghapusnya membuat INT_ROLE_ID mereka menggantung — orangnya tetap bisa
     * masuk tapi tanpa jabatan apa pun, tanpa satu menu pun, dan tanpa pesan
     * yang menjelaskan apa yang terjadi. Yang benar adalah memindahkan mereka
     * lebih dulu, atau menonaktifkan rolenya.
     */
    const [dipakai] = await this.db
      .select({ n: count() })
      .from(users)
      .where(eq(users.roleId, id));

    if (Number(dipakai?.n ?? 0) > 0) {
      throw new ConflictException(
        `Role "${row.name}" masih dipegang ${dipakai?.n} pengguna. ` +
          'Pindahkan mereka ke role lain dulu, atau nonaktifkan rolenya.',
      );
    }

    if (row.kind === 'ADMIN') {
      await this.pastikanBukanAdminTerakhir(id, 'menghapusnya');
    }

    await this.db.delete(roles).where(eq(roles.id, id));
    return { id };
  }

  /* ── pembantu ────────────────────────────────────────────────────────────── */

  /**
   * Menolak kunci menu yang tidak ada di katalog.
   *
   * Tanpa ini, salah ketik akan tersimpan sebagai hak atas menu yang tidak
   * pernah ada: layarnya tidak muncul, tidak ada pesan apa pun, dan yang
   * mengaturnya yakin sudah memberikannya.
   */
  private periksaKunciMenu(keys: string[]): void {
    const asing = keys.filter((k) => !isMenuKey(k));
    if (asing.length > 0) {
      throw new BadRequestException(`Menu tidak dikenal: ${asing.join(', ')}`);
    }
  }

  private async simpanMenu(roleId: number, keys: string[]): Promise<void> {
    /*
     * Hapus lalu tulis ulang, dalam satu transaksi.
     *
     * Membandingkan selisih terlihat lebih hemat, tetapi centang yang DICABUT
     * adalah setengah dari gunanya layar ini — dan pembandingan yang hanya
     * menambah akan diam-diam melewatkan pencabutan.
     */
    await this.db.transaction(async (tx) => {
      await tx.delete(roleMenus).where(eq(roleMenus.roleId, roleId));
      if (keys.length === 0) return;

      const baris = await tx
        .select({ id: menus.id })
        .from(menus)
        .where(and(inArray(menus.key, keys), eq(menus.isActive, true)));

      if (baris.length === 0) return;
      await tx
        .insert(roleMenus)
        .values(baris.map((m) => ({ roleId, menuId: m.id })));
    });
  }

  private async pastikanBukanAdminTerakhir(roleId: number, tindakan: string): Promise<void> {
    const lain = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.kind, 'ADMIN'), eq(roles.isActive, true)));

    const tersisa = lain.filter((r) => r.id !== roleId);
    if (tersisa.length === 0) {
      throw new ConflictException(
        `Ini satu-satunya role ADMIN yang aktif. ${tindakan[0]?.toUpperCase()}${tindakan.slice(1)} ` +
          'akan mengunci semua orang di luar pengaturan sistem. Buat role ADMIN lain dulu.',
      );
    }
  }

  private terjemahkan(err: unknown, name: string): Error {
    const e = err as { errno?: number; cause?: { errno?: number } };
    if (e?.errno === MYSQL_DUP_ENTRY || e?.cause?.errno === MYSQL_DUP_ENTRY) {
      return new ConflictException(`Role "${name}" sudah ada.`);
    }
    return err as Error;
  }
}
