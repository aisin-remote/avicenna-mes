import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import {
  and,
  asc,
  between,
  desc,
  eq,
  galatDuplikat,
  inArray,
  ne,
  sql,
  type Database,
  customers,
  deliveries,
  deliveryLines,
  deliverySyncs,
  parts,
  customerParts,
  plants,
  preparationSchedules,
  scanEvents,
  kanbans,
  kanbanEvents,
} from '@avicenna/db';
import {
  activePreparationScans,
  groupPreparationDocuments,
  preparationDateAt,
} from '@avicenna/domain';
import type {
  PreparationDetail,
  PreparationDocument,
  PreparationFilter,
  PreparationSchedule,
  PreparationScheduleInput,
  PreparationSnapshot,
} from '@avicenna/contracts';
import type { Principal } from '../auth/auth.types';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from '../staging/staging-db.service';
import { StagingPullService } from '../staging/staging-pull.service';

@Injectable()
export class PreparationService {
  private syncing = false;
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly staging: StagingDbService,
    private readonly pull: StagingPullService,
  ) {}

  private scope(principal?: Principal) {
    if (principal?.kind !== 'user')
      throw new ForbiddenException('Monitoring hanya untuk pengguna manusia');
    if (principal.roleKind === 'ADMIN') return undefined;
    if (!principal.plantId) throw new ForbiddenException('Pabrik pengguna belum ditentukan');
    return eq(deliveries.plantId, principal.plantId);
  }

  private admin(principal?: Principal) {
    this.scope(principal);
    if (principal?.kind !== 'user' || principal.roleKind !== 'ADMIN')
      throw new ForbiddenException(
        'Hanya administrator yang boleh mengubah master atau sinkronisasi',
      );
  }

  private async documents(
    filters: PreparationFilter,
    principal?: Principal,
    id?: number,
  ): Promise<PreparationDocument[]> {
    const docs = await this.db
      .select({
        id: deliveries.id,
        plantId: deliveries.plantId,
        plantCode: plants.code,
        customerId: deliveries.customerId,
        customerName: customers.name,
        customerCode: customers.code,
        documentNumber: deliveries.documentNumber,
        manifestNumber: deliveries.manifestNumber,
        pdsNumber: deliveries.pdsNumber,
        deliveryDate: deliveries.deliveryDate,
        cycle: deliveries.cycle,
        destination: sql<string>`coalesce(${deliveries.dock}, '')`,
        status: deliveries.status,
        truckStatus: deliveries.truckStatus,
        truckPickedAt: deliveries.truckPickedAt,
        lineCount: sql<number>`count(${deliveryLines.id})`.mapWith(Number),
        plannedKanban: sql<number>`coalesce(sum(${deliveryLines.plannedKanban}),0)`.mapWith(Number),
        pickedKanban: sql<number>`coalesce(sum(${deliveryLines.pickedKanban}),0)`.mapWith(Number),
        missingKanban:
          sql<number>`coalesce(sum(greatest(${deliveryLines.plannedKanban}-${deliveryLines.pickedKanban},0)),0)`.mapWith(
            Number,
          ),
        invalidLines:
          sql<number>`count(${deliveryLines.id}) filter (where ${deliveryLines.plannedKanban} <= 0 or ${deliveryLines.qtyPerKanban} <= 0)`.mapWith(
            Number,
          ),
        loadedKanban: sql<number>`coalesce(sum(${deliveryLines.actualKanban}),0)`.mapWith(Number),
        plannedQty: sql<number>`coalesce(sum(${deliveryLines.plannedQty}),0)`.mapWith(Number),
        pickedQty: sql<number>`coalesce(sum(${deliveryLines.pickedQty}),0)`.mapWith(Number),
      })
      .from(deliveries)
      .innerJoin(customers, eq(customers.id, deliveries.customerId))
      .innerJoin(plants, eq(plants.id, deliveries.plantId))
      .leftJoin(deliveryLines, eq(deliveryLines.deliveryId, deliveries.id))
      .where(
        and(
          this.scope(principal),
          ne(deliveries.status, 'CANCELLED'),
          id ? eq(deliveries.id, id) : between(deliveries.deliveryDate, filters.from, filters.to),
          filters.customerId ? eq(deliveries.customerId, filters.customerId) : undefined,
          filters.cycle ? eq(deliveries.cycle, filters.cycle) : undefined,
        ),
      )
      .groupBy(deliveries.id, customers.id, plants.id)
      .orderBy(asc(deliveries.deliveryDate), asc(customers.name), asc(deliveries.cycle));
    const latest = new Map<number, string>();
    const traced = new Map<number, number>();
    // Fold the append-only ledger, including undo; an undone scan is not a completion timestamp.
    for (let i = 0; i < docs.length; i += 500) {
      const events = await this.db
        .select({
          id: scanEvents.id,
          at: scanEvents.scannedAt,
          deliveryId: deliveryLines.deliveryId,
          lineId: deliveryLines.id,
          phase: sql<string>`${scanEvents.meta}->>'phase'`,
          action: sql<string | null>`${scanEvents.meta}->>'action'`,
        })
        .from(scanEvents)
        .innerJoin(
          deliveryLines,
          and(
            sql`${scanEvents.meta}->>'deliveryLineId' = ${deliveryLines.id}::text`,
            sql`${scanEvents.meta}->>'deliveryId' = ${deliveryLines.deliveryId}::text`,
          ),
        )
        .where(
          and(
            eq(scanEvents.kind, 'DELIVERY'),
            sql`${scanEvents.meta}->>'phase' = 'PULLING'`,
            inArray(
              deliveryLines.deliveryId,
              docs.slice(i, i + 500).map((d) => d.id),
            ),
          ),
        )
        .orderBy(asc(scanEvents.id));
      for (const e of activePreparationScans(events)) {
        traced.set(e.deliveryId, (traced.get(e.deliveryId) ?? 0) + 1);
        const at = e.at.toISOString();
        if (at > (latest.get(e.deliveryId) ?? '')) latest.set(e.deliveryId, at);
      }
    }
    return docs.map((d) => ({
      ...d,
      truckPickedAt: d.truckPickedAt?.toISOString() ?? null,
      latestPullingAt:
        (traced.get(d.id) ?? 0) >= d.pickedKanban ? (latest.get(d.id) ?? null) : null,
    }));
  }

  private async schedules(): Promise<PreparationSchedule[]> {
    const rows = await this.db
      .select({ schedule: preparationSchedules, customerName: customers.name })
      .from(preparationSchedules)
      .innerJoin(customers, eq(customers.id, preparationSchedules.customerId))
      .orderBy(asc(customers.name), asc(preparationSchedules.cycle));
    return rows.map(({ schedule: s, customerName }) => ({
      ...s,
      customerName,
      syncedAt: s.syncedAt?.toISOString() ?? null,
    }));
  }

  async snapshot(filters: PreparationFilter, principal?: Principal): Promise<PreparationSnapshot> {
    this.scope(principal);
    const [documents, schedules, customerOptions, syncs] = await Promise.all([
      this.documents(
        {
          ...filters,
          from: preparationDateAt(filters.from, '12:00', -15).slice(0, 10),
          to: preparationDateAt(filters.to, '12:00', 14).slice(0, 10),
        },
        principal,
      ),
      this.schedules(),
      this.db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(eq(customers.isActive, true))
        .orderBy(asc(customers.name)),
      this.db
        .select()
        .from(deliverySyncs)
        .where(between(deliverySyncs.operationalDate, filters.from, filters.to))
        .orderBy(desc(deliverySyncs.syncedAt)),
    ]);
    const now = new Date();
    const viewStart = Date.parse(preparationDateAt(filters.from, '00:00'));
    const viewEnd = Date.parse(preparationDateAt(filters.to, '00:00', 1));
    const visible = (g: ReturnType<typeof groupPreparationDocuments>[number]) =>
      (g.deliveryDate >= filters.from && g.deliveryDate <= filters.to) ||
      (g.preparationStartAt !== null &&
        g.deadlineAt !== null &&
        Date.parse(g.preparationStartAt) < viewEnd &&
        Date.parse(g.deadlineAt) > viewStart) ||
      (g.truckEtaAt !== null &&
        Date.parse(g.truckEtaAt) >= viewStart &&
        Date.parse(g.truckEtaAt) < viewEnd);
    const matches = (g: ReturnType<typeof groupPreparationDocuments>[number]) =>
      (filters.status === 'ALL' ||
        (filters.status === 'COMPLETE'
          ? g.completed
          : filters.status === 'INCOMPLETE'
            ? !g.completed
            : ['OVERDUE', 'COMPLETE_LATE'].includes(g.status))) &&
      (!filters.q ||
        [
          g.customerName,
          ...g.pdsNumbers,
          ...g.documents.flatMap((d) => [d.documentNumber, d.manifestNumber ?? '']),
        ]
          .join(' ')
          .toLowerCase()
          .includes(filters.q.toLowerCase()));
    return {
      filters,
      asOf: now.toISOString(),
      pdsGroups: groupPreparationDocuments(documents, schedules, 'PDS', now).filter(
        (g) => visible(g) && matches(g),
      ),
      cycleGroups: groupPreparationDocuments(documents, schedules, 'CYCLE', now).filter(
        (g) => visible(g) && matches(g),
      ),
      customers: customerOptions,
      schedules,
      source: {
        configured: this.staging.terkonfigurasi,
        readOnly: true,
        message: this.staging.terkonfigurasi
          ? 'SAP staging → cache MES. Refresh layar tidak menulis ke SAP.'
          : 'Koneksi STAGING_* belum lengkap; data cache MES tetap dapat dilihat.',
      },
      syncs: syncs.map((s) => ({
        date: s.operationalDate,
        syncedAt: s.syncedAt.toISOString(),
        result: s.result,
      })),
    };
  }

  async detail(id: number, principal?: Principal): Promise<PreparationDetail> {
    const document = (
      await this.documents(
        { from: '2000-01-01', to: '2000-01-01', q: '', status: 'ALL' },
        principal,
        id,
      )
    )[0];
    if (!document)
      throw new NotFoundException('Loading list tidak ditemukan atau di luar pabrik pengguna');
    const lines = await this.db
      .select({
        id: deliveryLines.id,
        partId: parts.id,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        name: parts.name,
        customerPartNumber: sql<
          string | null
        >`coalesce(${deliveryLines.customerPartNumberSource},${customerParts.customerPartNumber})`,
        customerBackNumber: customerParts.customerBackNumber,
        plannedKanban: deliveryLines.plannedKanban,
        pickedKanban: deliveryLines.pickedKanban,
        loadedKanban: deliveryLines.actualKanban,
        qtyPerKanban: deliveryLines.qtyPerKanban,
        plannedQty: deliveryLines.plannedQty,
        pickedQty: deliveryLines.pickedQty,
      })
      .from(deliveryLines)
      .innerJoin(parts, eq(parts.id, deliveryLines.partId))
      .leftJoin(customerParts, eq(customerParts.id, deliveryLines.customerPartId))
      .where(eq(deliveryLines.deliveryId, id));
    const schedules = await this.schedules();
    const production = alias(scanEvents, 'production_trace');
    const serial = sql`coalesce(nullif(${scanEvents.meta}->>'internalSerial',''), ${scanEvents.serialNumber})`;
    const events = await this.db
      .select({
        id: scanEvents.id,
        lineId: deliveryLines.id,
        partId: deliveryLines.partId,
        at: scanEvents.scannedAt,
        qty: scanEvents.qty,
        serial: scanEvents.serialNumber,
        customerSerial: sql<string | null>`${scanEvents.meta}->>'customerSerial'`,
        internalSerial: sql<string | null>`${scanEvents.meta}->>'internalSerial'`,
        action: sql<string | null>`${scanEvents.meta}->>'action'`,
        phase: sql<string>`${scanEvents.meta}->>'phase'`,
        producedAt: sql<string | null>`greatest(
        (select max(${production.scannedAt}) from ${scanEvents} AS "production_trace" where ${production.kind} = 'PRODUCTION'
          and ${production.plantId} = ${scanEvents.plantId} and ${production.partId} = ${deliveryLines.partId}
          and ${production.serialNumber} = ${serial} and ${production.scannedAt} <= ${scanEvents.scannedAt}),
        (select max(${kanbanEvents.occurredAt}) from ${kanbanEvents} join ${kanbans} on ${kanbans.id} = ${kanbanEvents.kanbanId}
          where ${kanbanEvents.type} = 'PRODUCED' and ${kanbans.plantId} = ${scanEvents.plantId}
          and ${kanbans.partId} = ${deliveryLines.partId} and ${kanbans.serialNumber} = ${serial}
          and ${kanbanEvents.occurredAt} <= ${scanEvents.scannedAt}))::text`,
      })
      .from(scanEvents)
      .innerJoin(
        deliveryLines,
        and(
          sql`${scanEvents.meta}->>'deliveryLineId' = ${deliveryLines.id}::text`,
          sql`${scanEvents.meta}->>'deliveryId' = ${deliveryLines.deliveryId}::text`,
        ),
      )
      .where(
        and(
          eq(deliveryLines.deliveryId, id),
          eq(scanEvents.kind, 'DELIVERY'),
          sql`${scanEvents.meta}->>'phase' in ('PULLING','LOADING')`,
        ),
      )
      .orderBy(desc(scanEvents.id))
      .limit(1001);
    return {
      document,
      group: groupPreparationDocuments([document], schedules, 'PDS')[0]!,
      lines,
      scans: activePreparationScans(events.slice(0, 1000)).map((e) => ({
        ...e,
        at: e.at.toISOString(),
        producedAt: e.producedAt ? new Date(e.producedAt).toISOString() : null,
      })),
      historyTruncated: events.length > 1000,
    };
  }

  async saveSchedule(id: number | null, input: PreparationScheduleInput, principal?: Principal) {
    this.admin(principal);
    if (
      !(
        await this.db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, input.customerId))
          .limit(1)
      )[0]
    )
      throw new BadRequestException('Customer tidak ditemukan');
    try {
      const rows = id
        ? await this.db
            .update(preparationSchedules)
            .set(input)
            .where(eq(preparationSchedules.id, id))
            .returning()
        : await this.db.insert(preparationSchedules).values(input).returning();
      if (!rows[0]) throw new NotFoundException('Master cycle tidak ditemukan');
      return { id: rows[0].id };
    } catch (e) {
      if (galatDuplikat(e))
        throw new ConflictException('Customer, destination, gate, dan cycle sudah terdaftar');
      throw e;
    }
  }

  async deleteSchedule(id: number, principal?: Principal) {
    this.admin(principal);
    const rows = await this.db
      .delete(preparationSchedules)
      .where(eq(preparationSchedules.id, id))
      .returning({ id: preparationSchedules.id });
    if (!rows[0]) throw new NotFoundException('Master cycle tidak ditemukan');
    return { id };
  }

  async sync(date: string, principal?: Principal) {
    this.admin(principal);
    if (!this.staging.terkonfigurasi)
      throw new BadRequestException('Isi koneksi read-only STAGING_* di .env terlebih dahulu');
    if (this.syncing) throw new ConflictException('Sinkronisasi preparation masih berjalan');
    this.syncing = true;
    try {
      const results = [];
      // Same 3-day sync as PPIC; source remains SELECT-only, actual scans stay owned by MES.
      for (let offset = 0; offset < 3; offset++)
        results.push(
          await this.pull.tarikPengiriman(
            new Date(preparationDateAt(date, '12:00', offset)),
            false,
            true,
          ),
        );
      results.push(await this.pull.tarikJadwalPreparation());
      return { results };
    } catch {
      throw new ServiceUnavailableException(
        'Gagal membaca staging SAP. Periksa koneksi dan log server; cache sebelumnya tetap tersedia.',
      );
    } finally {
      this.syncing = false;
    }
  }
}
