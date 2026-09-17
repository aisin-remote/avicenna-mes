import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { eq, and, or, like, ne, asc, count, isNull, type Database } from '@avicenna/db';
import { users, roles, plants } from '@avicenna/db';
import {
  userCreateSchema,
  userUpdateSchema,
  resetPasswordSchema,
  type UserRow,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { parseOrThrow } from '../common/validation-error';
import type { Principal } from '../auth/auth.types';

const MYSQL_DUP_ENTRY = 1062;

/**
 * Biaya bcrypt.
 *
 * 10 mengikuti hash yang sudah ada di seed; menaikkannya di sini tidak
 * memutuskan siapa pun — bcrypt menyimpan biayanya di dalam hash, jadi sandi
 * lama tetap bisa diperiksa. Yang dibatasi adalah waktu login di terminal
 * pabrik yang prosesornya lemah.
 */
const BCRYPT_ROUNDS = 10;

export interface ListUserParams {
  page: number;
  perPage: number;
  q?: string;
  roleId?: number;
  plantId?: number;
  aktif?: boolean;
}

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(params: ListUserParams) {
    const term = params.q ? `%${params.q}%` : undefined;
    const where = and(
      ...(term ? [or(like(users.npk, term), like(users.name, term), like(users.email, term))] : []),
      ...(params.roleId ? [eq(users.roleId, params.roleId)] : []),
      ...(params.plantId ? [eq(users.plantId, params.plantId)] : []),
      ...(params.aktif !== undefined ? [eq(users.isActive, params.aktif)] : []),
    );

    const offset = (params.page - 1) * params.perPage;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: users.id,
          npk: users.npk,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
          roleId: users.roleId,
          roleName: roles.name,
          roleLabel: roles.label,
          roleKind: roles.kind,
          plantId: users.plantId,
          plantCode: plants.code,
          isActive: users.isActive,
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .leftJoin(plants, eq(users.plantId, plants.id))
        .where(where)
        .orderBy(asc(users.npk))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(users).where(where),
    ]);

    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows.map(bersihkan),
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  async findOne(id: number): Promise<UserRow> {
    const [row] = await this.db
      .select({
        id: users.id,
        npk: users.npk,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        roleId: users.roleId,
        roleName: roles.name,
        roleLabel: roles.label,
        roleKind: roles.kind,
        plantId: users.plantId,
        plantCode: plants.code,
        isActive: users.isActive,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(plants, eq(users.plantId, plants.id))
      .where(eq(users.id, id))
      .limit(1);

    if (!row) throw new NotFoundException(`Pengguna #${id} tidak ditemukan`);
    return bersihkan(row);
  }

  async create(body: unknown): Promise<UserRow> {
    const input = parseOrThrow(userCreateSchema, body);
    await this.pastikanRoleAda(input.roleId);

    try {
      const hasil = await this.db.insert(users).values({
        npk: input.npk,
        name: input.name,
        email: input.email ?? null,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
        roleId: input.roleId,
        plantId: input.plantId ?? null,
        isActive: input.isActive,
      });
      const id = Number((hasil as unknown as Array<{ insertId: number }>)[0]?.insertId);
      return this.findOne(id);
    } catch (err) {
      throw this.terjemahkan(err, input.npk, input.email);
    }
  }

  async update(id: number, body: unknown, pelaku?: Principal): Promise<UserRow> {
    const input = parseOrThrow(userUpdateSchema, body);
    const lama = await this.findOne(id);

    if (input.roleId !== undefined) await this.pastikanRoleAda(input.roleId);

    /*
     * Admin tidak boleh mengunci dirinya sendiri.
     *
     * Dua tindakan yang mengunci: menonaktifkan akun sendiri, dan memindahkan
     * diri sendiri ke role bukan-ADMIN. Keduanya baru terasa akibatnya pada
     * permintaan berikutnya — saat layar pengaturan sudah tidak bisa dibuka
     * lagi oleh orang itu.
     */
    if (pelaku?.kind === 'user' && pelaku.sub === id) {
      if (input.isActive === false) {
        throw new BadRequestException('Tidak bisa menonaktifkan akun Anda sendiri.');
      }
      if (input.roleId !== undefined && input.roleId !== lama.roleId) {
        const [baru] = await this.db
          .select({ kind: roles.kind })
          .from(roles)
          .where(eq(roles.id, input.roleId))
          .limit(1);
        if (baru?.kind !== 'ADMIN') {
          throw new BadRequestException(
            'Tidak bisa memindahkan akun Anda sendiri ke role non-admin — ' +
              'Anda akan langsung kehilangan akses ke layar ini.',
          );
        }
      }
    }

    if (lama.roleKind === 'ADMIN' && (input.isActive === false || input.roleId !== lama.roleId)) {
      await this.pastikanBukanAdminTerakhir(id);
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.npk !== undefined) patch.npk = input.npk;
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email ?? null;
    if (input.roleId !== undefined) patch.roleId = input.roleId;
    if (input.plantId !== undefined) patch.plantId = input.plantId ?? null;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    if (Object.keys(patch).length === 0) return lama;

    try {
      await this.db.update(users).set(patch).where(eq(users.id, id));
    } catch (err) {
      throw this.terjemahkan(err, input.npk ?? lama.npk, input.email ?? lama.email ?? undefined);
    }
    return this.findOne(id);
  }

  /**
   * Mengganti kata sandi.
   *
   * Sandi lama TIDAK diminta: ini tindakan administrator atas akun orang lain,
   * yang justru dipakai ketika sandinya sudah tidak diketahui siapa pun.
   * Konsekuensinya admin bisa mengambil alih akun mana pun — memang begitu,
   * dan itulah kenapa endpoint ini terbatas ADMIN dan device tidak pernah
   * dianggap admin.
   */
  async resetPassword(id: number, body: unknown): Promise<{ id: number }> {
    const { password } = parseOrThrow(resetPasswordSchema, body);
    await this.findOne(id);
    await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) })
      .where(eq(users.id, id));
    return { id };
  }

  async setActive(id: number, aktif: boolean, pelaku?: Principal): Promise<UserRow> {
    return this.update(id, { isActive: aktif }, pelaku);
  }

  /* ── pembantu ────────────────────────────────────────────────────────────── */

  private async pastikanRoleAda(roleId: number): Promise<void> {
    const [row] = await this.db
      .select({ id: roles.id, isActive: roles.isActive, name: roles.name })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);

    if (!row) throw new BadRequestException(`Role #${roleId} tidak ditemukan`);
    if (!row.isActive) {
      // Role non-aktif masih menempel pada pengguna lama supaya riwayatnya
      // utuh, tetapi tidak boleh jadi pilihan baru.
      throw new BadRequestException(`Role "${row.name}" sudah tidak aktif.`);
    }
  }

  /**
   * Menjaga selalu ada SATU admin aktif yang punya kata sandi.
   *
   * Tanpa penjagaan ini, sistem bisa sampai pada keadaan yang tidak bisa
   * dipulihkan dari layar mana pun — dan pemulihannya menuntut menyunting
   * database produksi dengan tangan.
   */
  private async pastikanBukanAdminTerakhir(id: number): Promise<void> {
    const lain = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(
        and(
          eq(roles.kind, 'ADMIN'),
          eq(roles.isActive, true),
          eq(users.isActive, true),
          ne(users.id, id),
          // Akun tanpa kata sandi tidak bisa dipakai masuk — menghitungnya
          // sebagai "masih ada admin lain" sama saja dengan tidak menjaga apa pun.
          ne(users.passwordHash, ''),
        ),
      )
      .limit(1);

    if (lain.length === 0) {
      throw new ConflictException(
        'Ini satu-satunya administrator aktif yang bisa masuk. ' +
          'Buat atau aktifkan administrator lain lebih dulu.',
      );
    }
  }

  private terjemahkan(err: unknown, npk: string, email?: string | null): Error {
    const e = err as { errno?: number; message?: string; cause?: { errno?: number; message?: string } };
    const errno = e?.errno ?? e?.cause?.errno;
    if (errno === MYSQL_DUP_ENTRY) {
      const pesan = String(e?.message ?? e?.cause?.message ?? '');
      // Dibedakan: NPK dan email punya unique index masing-masing, dan
      // "sudah ada" tanpa menyebut yang mana membuat orang mengubah yang salah.
      if (pesan.includes('EMAIL') && email) {
        return new ConflictException(`Email "${email}" sudah dipakai pengguna lain.`);
      }
      return new ConflictException(`NPK "${npk}" sudah terdaftar.`);
    }
    return err as Error;
  }
}

/** Membuang hash sandi dari hasil, dan menandai akun yang tidak bisa masuk. */
function bersihkan(row: {
  passwordHash: string | null;
  [k: string]: unknown;
}): UserRow {
  const { passwordHash, ...sisa } = row;
  return { ...(sisa as unknown as Omit<UserRow, 'tanpaSandi'>), tanpaSandi: !passwordHash };
}
