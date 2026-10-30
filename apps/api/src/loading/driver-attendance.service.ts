import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  deliveries,
  deliveryOrders,
  driverDestinations,
  driverAttendances,
  driverAttendanceOrders,
  plants,
  galatDuplikat,
  type Database,
} from '@avicenna/db';
import {
  driverAttendanceStartSchema,
  type DriverAttendanceBoard,
  type DriverAttendanceHistory,
  type DriverAttendanceOrder,
  type DriverAttendanceRow,
  type DriverAttendanceStart,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';
import { FotoService } from '../master/foto.service';
import { readDeliveryFlow, recordDriverDeparture } from './delivery-flow';

type Entry = typeof driverAttendances.$inferSelect;
export interface AttendanceFilter {
  plantId?: number;
  from: string;
  to: string;
  page: number;
}

@Injectable()
export class DriverAttendanceService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly photos: FotoService,
  ) {}

  private user(principal?: Principal) {
    if (principal?.kind !== 'user')
      throw new ForbiddenException('Masuk sebagai pengguna untuk mengakses absensi driver.');
    return principal;
  }
  private authorize(plantId: number, principal?: Principal) {
    const user = this.user(principal);
    if (user.roleKind !== 'ADMIN' && user.plantId !== plantId)
      throw new ForbiddenException('Absensi driver berada di pabrik lain.');
  }
  private operate(principal?: Principal) {
    const user = this.user(principal);
    if (user.roleKind !== 'ADMIN' && user.roleKind !== 'SCANNING')
      throw new ForbiddenException('Role ini hanya dapat melihat absensi driver.');
  }
  private async context(requested: number | undefined, principal?: Principal) {
    const user = this.user(principal);
    const available = await this.db
      .select({ id: plants.id, name: plants.name })
      .from(plants)
      .where(user.roleKind === 'ADMIN' ? undefined : eq(plants.id, user.plantId ?? 0))
      .orderBy(asc(plants.id));
    const plantId = requested ?? user.plantId ?? available[0]?.id;
    if (!plantId || !available.some((p) => p.id === plantId))
      throw new ForbiddenException('Pabrik tidak dapat diakses.');
    return { plantId, plants: available };
  }
  private async rows(entries: Entry[]): Promise<DriverAttendanceRow[]> {
    if (!entries.length) return [];
    const linked = await this.db
      .select({ attendanceId: driverAttendanceOrders.attendanceId, order: deliveryOrders })
      .from(driverAttendanceOrders)
      .innerJoin(deliveryOrders, eq(deliveryOrders.id, driverAttendanceOrders.orderId))
      .where(
        inArray(
          driverAttendanceOrders.attendanceId,
          entries.map((r) => r.id),
        ),
      )
      .orderBy(asc(deliveryOrders.id));
    return entries.map((r) => ({
      id: r.id,
      plantId: r.plantId,
      slot: r.slot,
      destinationName: r.destinationName,
      dock: r.dock,
      logistic: r.logistic,
      cycle: r.cycle,
      helmet: r.helmet,
      vest: r.vest,
      shoes: r.shoes,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      orders: linked
        .filter((l) => l.attendanceId === r.id)
        .map(({ order: o }) => ({
          id: o.id,
          number: o.number,
          pdsNumber: o.pdsNumber,
          customerName: o.snapshot.customerName,
          shippedAt: o.shippedAt?.toISOString() ?? null,
          driverScannedAt: o.driverScannedAt?.toISOString() ?? null,
        })),
    }));
  }
  async board(
    requested: number | undefined,
    principal?: Principal,
  ): Promise<DriverAttendanceBoard> {
    const context = await this.context(requested, principal);
    const [destinations, active] = await Promise.all([
      this.db
        .select({
          id: driverDestinations.id,
          customerId: driverDestinations.customerId,
          name: driverDestinations.name,
          dock: driverDestinations.dock,
          logistic: driverDestinations.logistic,
        })
        .from(driverDestinations)
        .where(
          and(
            eq(driverDestinations.plantId, context.plantId),
            eq(driverDestinations.isActive, true),
          ),
        )
        .orderBy(asc(driverDestinations.name)),
      this.db
        .select()
        .from(driverAttendances)
        .where(
          and(eq(driverAttendances.plantId, context.plantId), isNull(driverAttendances.endedAt)),
        )
        .orderBy(asc(driverAttendances.slot)),
    ]);
    return { ...context, destinations, active: await this.rows(active) };
  }
  async resolve(
    code: string,
    requested: number | undefined,
    principal?: Principal,
  ): Promise<{ data: DriverAttendanceOrder[] }> {
    const { plantId } = await this.context(requested, principal);
    const orders = await this.db
      .selectDistinct({ order: deliveryOrders })
      .from(deliveryOrders)
      .innerJoin(deliveries, eq(deliveries.deliveryOrderId, deliveryOrders.id))
      .where(
        and(
          eq(deliveries.plantId, plantId),
          eq(deliveryOrders.intercompany, true),
          or(
            eq(deliveryOrders.number, code),
            eq(deliveryOrders.pdsNumber, code),
            sql`${deliveryOrders.snapshot}->'qr'->>'value' = ${code}`,
          ),
        ),
      )
      .limit(101);
    if (!orders.length)
      throw new NotFoundException('DO / manifest / PDS tidak ditemukan di pabrik ini.');
    if (orders.length > 100)
      throw new BadRequestException('Scan nomor PDS atau DO yang lebih spesifik.');
    return {
      data: orders.map(({ order: o }) => ({
        id: o.id,
        number: o.number,
        pdsNumber: o.pdsNumber,
        customerName: o.snapshot.customerName,
        shippedAt: o.shippedAt?.toISOString() ?? null,
        driverScannedAt: o.driverScannedAt?.toISOString() ?? null,
      })),
    };
  }
  async start(raw: DriverAttendanceStart, principal?: Principal) {
    this.operate(principal);
    const input = driverAttendanceStartSchema.parse(raw);
    this.authorize(input.plantId, principal);
    const [destination] = await this.db
      .select()
      .from(driverDestinations)
      .where(
        and(
          eq(driverDestinations.id, input.destinationId),
          eq(driverDestinations.plantId, input.plantId),
          eq(driverDestinations.isActive, true),
        ),
      );
    if (!destination) throw new BadRequestException('Tujuan pickup tidak tersedia di pabrik ini.');
    const [, mime, base64] = input.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)!;
    if (Buffer.from(base64!, 'base64').toString('base64') !== base64)
      throw new BadRequestException('Foto tidak valid.');
    const photo = await this.photos.simpan(
      { fileBase64: base64!, mimeType: mime },
      'driver-attendance',
    );
    try {
      const id = await this.db.transaction(async (tx) => {
        const [busy] = await tx
          .select({ id: driverAttendances.id })
          .from(driverAttendances)
          .where(
            and(
              eq(driverAttendances.plantId, input.plantId),
              eq(driverAttendances.slot, input.slot),
              isNull(driverAttendances.endedAt),
            ),
          );
        if (busy)
          throw new ConflictException('Posisi truk masih dipakai pickup lain. Perbarui layar.');
        const orders = await tx
          .select()
          .from(deliveryOrders)
          .where(inArray(deliveryOrders.id, input.orderIds))
          .orderBy(asc(deliveryOrders.id))
          .for('update');
        if (orders.length !== input.orderIds.length)
          throw new BadRequestException('Ada DO yang tidak ditemukan.');
        for (const order of orders) {
          const members = await tx
            .select()
            .from(deliveries)
            .where(eq(deliveries.deliveryOrderId, order.id));
          if (
            !members.length ||
            members.some(
              (d) =>
                d.plantId !== input.plantId ||
                d.customerId !== destination.customerId ||
                d.cycle !== input.cycle,
            )
          )
            throw new BadRequestException(
              `${order.number ?? order.pdsNumber}: pabrik, customer, atau cycle berbeda dari tujuan pickup.`,
            );
          const flow = await readDeliveryFlow(tx, order.id);
          if (!order.number || order.driverScannedAt || flow?.stage !== 'READY')
            throw new BadRequestException(
              `${order.number ?? order.pdsNumber}: DO belum siap atau sudah dipakai. GI AIIA dan GR AII wajib berhasil lebih dulu.`,
            );
        }
        const now = new Date();
        const [entry] = await tx
          .insert(driverAttendances)
          .values({
            plantId: input.plantId,
            slot: input.slot,
            destinationId: destination.id,
            destinationName: destination.name,
            dock: destination.dock,
            logistic: destination.logistic,
            cycle: input.cycle,
            helmet: true,
            vest: true,
            shoes: true,
            photo,
            startedAt: now,
            startedById: this.user(principal).sub,
          })
          .returning({ id: driverAttendances.id });
        await tx
          .insert(driverAttendanceOrders)
          .values(orders.map((o) => ({ attendanceId: entry!.id, orderId: o.id })));
        await tx
          .update(deliveries)
          .set({
            truckStatus: 'LOADING',
            truckPickedAt: now,
            truckPickedById: this.user(principal).sub,
          })
          .where(inArray(deliveries.deliveryOrderId, input.orderIds));
        return entry!.id;
      });
      return { id };
    } catch (error) {
      await this.photos.hapusDiam(photo, 'driver-attendance');
      if (galatDuplikat(error))
        throw new ConflictException(
          'Posisi truk atau DO sudah dipakai pickup lain. Perbarui layar.',
        );
      throw error;
    }
  }
  async finish(id: number, principal?: Principal) {
    this.operate(principal);
    return this.db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(driverAttendances)
        .where(eq(driverAttendances.id, id))
        .for('update');
      if (!entry) throw new NotFoundException('Absensi pickup tidak ditemukan.');
      this.authorize(entry.plantId, principal);
      if (entry.endedAt) return { id, alreadyFinished: true };
      const links = await tx
        .select()
        .from(driverAttendanceOrders)
        .where(eq(driverAttendanceOrders.attendanceId, id))
        .orderBy(asc(driverAttendanceOrders.orderId));
      if (!links.length) throw new BadRequestException('Pickup belum memiliki DO.');
      for (const link of links) {
        const [order] = await tx
          .select()
          .from(deliveryOrders)
          .where(eq(deliveryOrders.id, link.orderId));
        if (!order) throw new BadRequestException('DO pickup tidak ditemukan.');
        await recordDriverDeparture(tx, order.id, order.number!, principal, id);
      }
      await tx
        .update(driverAttendances)
        .set({ endedAt: new Date(), endedById: this.user(principal).sub })
        .where(eq(driverAttendances.id, id));
      return { id, alreadyFinished: false };
    });
  }
  private async historyWhere(filter: AttendanceFilter, principal?: Principal) {
    const { plantId } = await this.context(filter.plantId, principal);
    const start = new Date(`${filter.from}T00:00:00+07:00`),
      end = new Date(`${filter.to}T00:00:00+07:00`);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end < start ||
      end.getTime() - start.getTime() > 366 * 86400000
    )
      throw new BadRequestException(
        'Rentang tanggal maksimal satu tahun dan tanggal akhir harus setelah awal.',
      );
    end.setTime(end.getTime() + 86400000);
    return and(
      eq(driverAttendances.plantId, plantId),
      gte(driverAttendances.startedAt, start),
      lt(driverAttendances.startedAt, end),
    );
  }
  async history(filter: AttendanceFilter, principal?: Principal): Promise<DriverAttendanceHistory> {
    const where = await this.historyWhere(filter, principal),
      perPage = 25;
    const [entries, total] = await Promise.all([
      this.db
        .select()
        .from(driverAttendances)
        .where(where)
        .orderBy(desc(driverAttendances.startedAt), desc(driverAttendances.id))
        .limit(perPage)
        .offset((filter.page - 1) * perPage),
      this.db.select({ n: count() }).from(driverAttendances).where(where),
    ]);
    return {
      data: await this.rows(entries),
      total: Number(total[0]?.n ?? 0),
      page: filter.page,
      perPage,
    };
  }
  async exportRows(filter: AttendanceFilter, principal?: Principal) {
    const where = await this.historyWhere(filter, principal);
    return this.rows(
      await this.db
        .select()
        .from(driverAttendances)
        .where(where)
        .orderBy(desc(driverAttendances.startedAt)),
    );
  }
  async photo(id: number, principal?: Principal) {
    const [entry] = await this.db
      .select()
      .from(driverAttendances)
      .where(eq(driverAttendances.id, id));
    if (!entry) throw new NotFoundException('Absensi pickup tidak ditemukan.');
    this.authorize(entry.plantId, principal);
    return this.photos.baca(entry.photo, 'driver-attendance');
  }
}
