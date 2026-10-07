import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, type Database } from '@avicenna/db';
import { customers, kanbanCropProfiles } from '@avicenna/db';
import type { KanbanCropProfile, KanbanCropProfileInput } from '@avicenna/contracts';
import { normalisasiGarisPotong } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

const DEFAULT_PROFILE = {
  horizontalLines: [1 / 3, 2 / 3],
  verticalLines: [],
} as const;

@Injectable()
export class KanbanCropService {
  constructor(@InjectDb() private readonly db: Database) {}

  async list(): Promise<KanbanCropProfile[]> {
    const rows = await this.db
      .select({
        id: kanbanCropProfiles.id,
        customerId: customers.id,
        customerCode: customers.code,
        customerName: customers.name,
        horizontalLines: kanbanCropProfiles.horizontalLines,
        verticalLines: kanbanCropProfiles.verticalLines,
      })
      .from(customers)
      .leftJoin(kanbanCropProfiles, eq(kanbanCropProfiles.customerId, customers.id))
      .where(eq(customers.isActive, true))
      .orderBy(asc(customers.name));

    return rows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      customerCode: row.customerCode,
      customerName: row.customerName,
      configured: row.id !== null,
      horizontalLines: normalisasiGarisPotong(
        row.horizontalLines ?? [...DEFAULT_PROFILE.horizontalLines],
      ),
      verticalLines: normalisasiGarisPotong(
        row.verticalLines ?? [...DEFAULT_PROFILE.verticalLines],
      ),
    }));
  }

  async find(customerId: number): Promise<KanbanCropProfile | null> {
    const rows = await this.list();
    return rows.find((row) => row.customerId === customerId) ?? null;
  }

  async save(input: KanbanCropProfileInput, principal?: Principal): Promise<KanbanCropProfile> {
    const customer = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    if (!customer[0]) throw new NotFoundException('Customer tidak ditemukan.');

    const values = {
      customerId: input.customerId,
      horizontalLines: normalisasiGarisPotong(input.horizontalLines),
      verticalLines: normalisasiGarisPotong(input.verticalLines),
      updatedById: principal?.kind === 'user' ? principal.sub : null,
    };
    await this.db.insert(kanbanCropProfiles).values(values).onDuplicateKeyUpdate({ set: values });

    const saved = await this.find(input.customerId);
    if (!saved) throw new NotFoundException('Profil potong Kanban gagal dibaca kembali.');
    return saved;
  }
}
