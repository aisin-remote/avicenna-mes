import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { and, or, like, eq, asc, desc, count, sql, type Database } from '@avicenna/db';
import { getMasterTable } from '@avicenna/db';
import {
  getEntityDef,
  buildCreateSchema,
  buildUpdateSchema,
  type MasterEntity,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';

/** Kode galat MySQL yang perlu diterjemahkan jadi pesan yang bisa dipahami pengguna. */
const MYSQL = {
  DUP_ENTRY: 1062,
  ROW_IS_REFERENCED: 1451,
  NO_REFERENCED_ROW: 1452,
} as const;

export interface ListParams {
  page: number;
  perPage: number;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
}

/**
 * CRUD untuk seluruh entitas master.
 *
 * Satu layanan menangani sembilan entitas, dituntun definisi di
 * @avicenna/contracts. Menambah entitas master baru cukup menambah satu entri
 * di registry dan satu baris pemetaan tabel — tanpa menulis service, controller,
 * maupun halaman baru.
 */
@Injectable()
export class MasterService {
  constructor(@InjectDb() private readonly db: Database) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private table(entity: MasterEntity): any {
    return getMasterTable(entity);
  }

  /** Kolom yang boleh dipakai mengurutkan — mencegah nama kolom sembarang masuk query. */
  private sortColumn(entity: MasterEntity, sort?: string) {
    const def = getEntityDef(entity);
    const table = this.table(entity);
    const allowed = new Set([...def.fields.map((f) => f.name), 'id']);
    const name = sort && allowed.has(sort) ? sort : def.defaultSort;
    return table[name] ?? table.id;
  }

  private searchCondition(entity: MasterEntity, q?: string) {
    if (!q) return undefined;
    const def = getEntityDef(entity);
    const table = this.table(entity);
    const term = `%${q}%`;
    const parts = def.searchFields
      .map((f) => table[f])
      .filter(Boolean)
      .map((col) => like(col, term));
    return parts.length > 0 ? or(...parts) : undefined;
  }

  async list(entity: MasterEntity, params: ListParams) {
    const table = this.table(entity);
    const where = this.searchCondition(entity, params.q);
    const order = params.dir === 'desc' ? desc : asc;
    const offset = (params.page - 1) * params.perPage;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(table)
        .where(where)
        .orderBy(order(this.sortColumn(entity, params.sort)))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(table).where(where),
    ]);

    const total = totalRows[0]?.value ?? 0;
    return {
      data: rows,
      meta: {
        page: params.page,
        perPage: params.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.perPage)),
      },
    };
  }

  async findOne(entity: MasterEntity, id: number) {
    const table = this.table(entity);
    const rows = await this.db.select().from(table).where(eq(table.id, id)).limit(1);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`${getEntityDef(entity).singular} dengan id ${id} tidak ditemukan`);
    }
    return row;
  }

  /**
   * Daftar ringkas untuk mengisi pilihan dropdown pada kolom bertipe referensi.
   *
   * Hanya mengembalikan id dan label, dan hanya baris aktif — supaya data yang
   * sudah dinonaktifkan tidak bisa dipilih lagi pada entri baru, sementara data
   * lama yang sudah terlanjur memakainya tetap utuh.
   */
  async options(entity: MasterEntity) {
    const table = this.table(entity);
    const def = getEntityDef(entity);
    const hasActive = def.fields.some((f) => f.name === 'isActive');

    const rows = await this.db
      .select()
      .from(table)
      .where(hasActive ? eq(table.isActive, true) : undefined)
      .orderBy(asc(this.sortColumn(entity)))
      .limit(500);

    return rows.map((r: Record<string, unknown>) => ({
      value: Number(r.id),
      label: labelOf(r),
      // Label ringkas untuk sel tabel. Label panjang membantu saat memilih di
      // dropdown, tapi merusak lebar kolom kalau dipakai di daftar.
      short: shortLabelOf(r),
    }));
  }

  async create(entity: MasterEntity, body: unknown) {
    const parsed = buildCreateSchema(entity).safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const table = this.table(entity);
    try {
      const result = await this.db.insert(table).values(parsed.data);
      // mysql2 mengembalikan insertId pada elemen pertama.
      const insertId = Number((result as unknown as Array<{ insertId: number }>)[0]?.insertId);
      return this.findOne(entity, insertId);
    } catch (err) {
      throw translateDbError(err, entity);
    }
  }

  async update(entity: MasterEntity, id: number, body: unknown) {
    const parsed = buildUpdateSchema(entity).safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    // Buang field yang tidak dikirim, supaya PATCH tidak mengosongkan kolom
    // yang memang tidak sedang diubah.
    const values = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(values).length === 0) return this.findOne(entity, id);

    const table = this.table(entity);
    await this.findOne(entity, id);

    try {
      await this.db.update(table).set(values).where(eq(table.id, id));
      return this.findOne(entity, id);
    } catch (err) {
      throw translateDbError(err, entity);
    }
  }

  async remove(entity: MasterEntity, id: number) {
    const table = this.table(entity);
    await this.findOne(entity, id);

    try {
      await this.db.delete(table).where(eq(table.id, id));
      return { deleted: true, id };
    } catch (err) {
      throw translateDbError(err, entity);
    }
  }

  /** Menonaktifkan alih-alih menghapus — jalur aman untuk data yang sudah terpakai. */
  async setActive(entity: MasterEntity, id: number, isActive: boolean) {
    const def = getEntityDef(entity);
    if (!def.fields.some((f) => f.name === 'isActive')) {
      throw new BadRequestException(`${def.label} tidak punya status aktif`);
    }
    const table = this.table(entity);
    await this.findOne(entity, id);
    await this.db.update(table).set({ isActive }).where(eq(table.id, id));
    return this.findOne(entity, id);
  }
}

/** Menebak kolom mana yang paling layak jadi label pilihan. */
function labelOf(row: Record<string, unknown>): string {
  const code = row.code ?? row.partNumber;
  const name = row.name;
  if (code && name) return `${String(code)} — ${String(name)}`;
  return String(name ?? code ?? row.id);
}

/** Versi pendek: kode saja bila ada, jika tidak baru nama. */
function shortLabelOf(row: Record<string, unknown>): string {
  return String(row.code ?? row.partNumber ?? row.name ?? row.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validationError(error: any) {
  return new BadRequestException({
    statusCode: 400,
    error: 'ValidationError',
    message: 'Data yang dikirim tidak valid',
    details: error.issues.map((i: { path: unknown[]; message: string }) => ({
      field: i.path.join('.'),
      message: i.message,
    })),
  });
}

/**
 * Menerjemahkan galat database menjadi pesan yang berarti bagi pengguna.
 *
 * Tanpa ini, menghapus pabrik yang masih punya line akan memunculkan
 * "ER_ROW_IS_REFERENCED_2" di layar operator — tidak memberi tahu apa pun
 * tentang apa yang harus dilakukan.
 */
function translateDbError(err: unknown, entity: MasterEntity): Error {
  const e = err as { errno?: number; cause?: { errno?: number } };
  const errno = e?.errno ?? e?.cause?.errno;
  const def = getEntityDef(entity);

  if (errno === MYSQL.DUP_ENTRY) {
    return new ConflictException(
      `${def.singular} dengan kode tersebut sudah ada. Gunakan kode lain.`,
    );
  }
  if (errno === MYSQL.ROW_IS_REFERENCED) {
    return new ConflictException(
      `${def.singular} ini masih dipakai data lain sehingga tidak bisa dihapus. Nonaktifkan saja agar riwayatnya tetap utuh.`,
    );
  }
  if (errno === MYSQL.NO_REFERENCED_ROW) {
    return new BadRequestException(
      `Referensi yang dipilih tidak ditemukan. Muat ulang halaman lalu coba lagi.`,
    );
  }
  return err as Error;
}
