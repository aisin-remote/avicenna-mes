import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  and,
  eq,
  ne,
  desc,
  inArray,
  like,
  isNull,
  sql,
  receipts,
  receiptLines,
  parts,
  plants,
  suppliers,
  locations,
  lots,
  mutations,
  scanEvents,
  users,
  sapOutbox,
  readAresOrderSheet,
  type Database,
} from '@avicenna/db';
import {
  parseAresScanCode,
  displayAresOrder,
  receivingVerdict,
  receivingCloseTotals,
  needsLot,
} from '@avicenna/domain';
import type { AresOrderSource, ReceivingSession, ReceivingScanOutcome } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal, UserPrincipal } from '../auth/auth.types';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Receipt = typeof receipts.$inferSelect;
type ScanMeta = {
  module: 'ARES_RECEIVING';
  sessionId: number;
  lineId?: number;
  result: string;
  message: string;
  autoShipped?: boolean;
  clientRef?: string;
};

@Injectable()
export class ReceivingSessionService {
  constructor(@InjectDb() private readonly db: Database) {}

  protected async source(orderNumber: string, revision: number) {
    try {
      const order = await readAresOrderSheet(orderNumber, revision);
      if (!order) throw new NotFoundException('Order Sheet tidak ditemukan');
      return order;
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw new ServiceUnavailableException(
        process.env.ARES_DATABASE_URL
          ? 'Tidak bisa membaca Order Sheet. Periksa koneksi sumber, lalu coba lagi.'
          : 'Koneksi data receiving belum dikonfigurasi. Hubungi administrator.',
      );
    }
  }

  private user(principal?: Principal): UserPrincipal {
    if (principal?.kind !== 'user')
      throw new ForbiddenException('Receiving membutuhkan akun pengguna');
    return principal;
  }

  private writer(principal?: Principal) {
    const user = this.user(principal);
    if (!['ADMIN', 'SCANNING'].includes(user.roleKind ?? ''))
      throw new ForbiddenException('Akun ini hanya dapat melihat receiving');
    return user;
  }

  private scope(receipt: Receipt, principal?: Principal) {
    const user = this.user(principal);
    if (user.roleKind !== 'ADMIN' && user.plantId !== receipt.plantId)
      throw new ForbiddenException('Penerimaan bukan milik pabrik akun ini');
    if (!receipt.sourceSnapshot)
      throw new BadRequestException('Dokumen ini adalah penerimaan manual, bukan sesi scan');
    return user;
  }

  private assertSource(order: AresOrderSource) {
    if (!['ISSUED', 'DOWNLOADED', 'SHIPPED'].includes(order.status))
      throw new ConflictException(`Order Sheet berstatus ${order.status}; tidak dapat diterima`);
    if (!order.supplierCode || !order.lines.length)
      throw new BadRequestException('Order Sheet belum mempunyai supplier SAP atau item');
    for (const line of order.lines) {
      if (
        !Number.isSafeInteger(line.qtyPerBox) ||
        line.qtyPerBox <= 0 ||
        !Number.isSafeInteger(line.boxOrdered) ||
        line.boxOrdered <= 0 ||
        line.qtyPerBox * line.boxOrdered > 2_147_483_647
      )
        throw new BadRequestException(`Jumlah box/pcs tidak valid untuk ${line.partNumber}`);
    }
  }

  async open(input: { code: string; locationId: number }, principal?: Principal) {
    const user = this.writer(principal);
    const parsed = parseAresScanCode(input.code);
    if (parsed?.kind !== 'ORDER')
      throw new BadRequestException('Scan barcode Order Sheet, bukan kanban');
    const source = await this.source(parsed.orderNumber, parsed.revision);
    this.assertSource(source);
    const [plant] = await this.db
      .select()
      .from(plants)
      .where(eq(plants.code, source.plantCode))
      .limit(1);
    if (!plant || !plant.isActive)
      throw new BadRequestException(`Pabrik ${source.plantCode} belum terdaftar/aktif di MES`);
    if (user.roleKind !== 'ADMIN' && user.plantId !== plant.id)
      throw new ForbiddenException('Order Sheet bukan milik pabrik akun ini');
    const [location] = await this.db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.id, input.locationId),
          eq(locations.plantId, plant.id),
          eq(locations.kind, 'WAREHOUSE'),
        ),
      )
      .limit(1);
    if (!location)
      throw new BadRequestException(`Pilih lokasi gudang komponen untuk pabrik ${plant.code}`);
    const [supplier] = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.code, source.supplierCode!), eq(suppliers.isActive, true)))
      .limit(1);
    if (!supplier)
      throw new BadRequestException(
        `Supplier ${source.supplierCode} belum terdaftar/aktif di Master Supplier MES`,
      );
    const candidates = [
      ...new Set(source.lines.flatMap((line) => [line.partNumber, line.materialNumber])),
    ];
    const localParts = await this.db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.plantId, plant.id),
          eq(parts.isActive, true),
          inArray(parts.partNumber, candidates),
        ),
      );
    for (const line of source.lines) {
      const matches = localParts.filter(
        (part) => part.partNumber === line.partNumber || part.partNumber === line.materialNumber,
      );
      if (matches.length !== 1)
        throw new BadRequestException(
          `Mapping part ${line.partNumber} / ${line.materialNumber} belum unik di Master Part ${plant.code}`,
        );
      const part = matches[0]!;
      const normalizedUom = (value: string) =>
        ['PC', 'PCS'].includes(value.toUpperCase()) ? 'PCS' : value.toUpperCase();
      if (normalizedUom(part.uom) !== normalizedUom(line.uom))
        throw new BadRequestException(
          `Satuan ${line.partNumber} pada Order Sheet berbeda dari Master Part`,
        );
      line.partId = part.id;
      line.trackingMode = part.trackingMode;
    }
    const opened = await this.db.transaction(async (tx) => {
      // ponytail: lock per pabrik; pindah ke tabel claim kanban bila throughput receiving menuntutnya.
      await tx.select({ id: plants.id }).from(plants).where(eq(plants.id, plant.id)).for('update');
      const previous = await tx
        .select()
        .from(receipts)
        .where(
          and(
            eq(receipts.aresOrderId, source.id),
            eq(receipts.plantId, plant.id),
            ne(receipts.status, 'CANCELLED'),
          ),
        )
        .orderBy(desc(receipts.id))
        .limit(1);
      if (previous[0]) return { id: previous[0].id, resumed: true };
      const now = new Date();
      const stamp = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(now)
        .replaceAll('-', '');
      const documentNumber = `RCV-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const [row] = await tx
        .insert(receipts)
        .values({
          plantId: plant.id,
          supplierId: supplier.id,
          documentNumber,
          locationId: location.id,
          receivedAt: now,
          receivedById: user.sub,
          status: 'DRAFT',
          aresOrderId: source.id,
          sourceSnapshot: source,
        })
        .$returningId();
      await this.record(tx, row!.id, plant.id, user, 'OPEN', input.code, {
        result: 'OPEN',
        message: 'Sesi receiving dibuka',
      });
      return { id: row!.id, resumed: false };
    });
    return { ...(await this.get(opened.id, principal)), resumed: opened.resumed };
  }

  private async receipt(id: number, principal?: Principal) {
    const [receipt] = await this.db.select().from(receipts).where(eq(receipts.id, id)).limit(1);
    if (!receipt) throw new NotFoundException('Sesi receiving tidak ditemukan');
    this.scope(receipt, principal);
    return receipt;
  }

  private async locked(tx: Tx, id: number, plantId: number) {
    await tx.select({ id: plants.id }).from(plants).where(eq(plants.id, plantId)).for('update');
    const [receipt] = await tx.select().from(receipts).where(eq(receipts.id, id)).for('update');
    if (!receipt) throw new NotFoundException('Sesi receiving tidak ditemukan');
    return receipt;
  }

  private events(tx: Tx | Database, id: number) {
    return tx
      .select()
      .from(scanEvents)
      .where(and(eq(scanEvents.kind, 'RECEIVING'), like(scanEvents.dedupeKey, `ares-rcv:${id}:%`)))
      .orderBy(scanEvents.id);
  }

  private progress(source: AresOrderSource, events: Array<typeof scanEvents.$inferSelect>) {
    return source.lines.map((line) => {
      const boxScanned = events.filter((event) => {
        const meta = event.meta as ScanMeta | null;
        return meta?.lineId === line.id && meta.result === 'OK';
      }).length;
      return { ...line, boxScanned, pcsReceived: boxScanned * line.qtyPerBox };
    });
  }

  async get(id: number, principal?: Principal): Promise<ReceivingSession> {
    const receipt = await this.receipt(id, principal);
    const source = receipt.sourceSnapshot!;
    const [events, [location]] = await Promise.all([
      this.events(this.db, id),
      this.db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, receipt.locationId!))
        .limit(1),
    ]);
    const lines = this.progress(source, events);
    const ids = [
      ...new Set(
        events.map((event) => event.userId).filter((value): value is number => value !== null),
      ),
    ];
    const actors = ids.length
      ? await this.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, ids))
      : [];
    return {
      id,
      documentNumber: receipt.documentNumber,
      status: receipt.status,
      orderNumber: displayAresOrder(source.orderNumber, source.revision),
      revision: source.revision,
      supplierName: source.supplierName,
      plantCode: source.plantCode,
      locationName: location?.name ?? '—',
      deliveryDate: source.deliveryDate,
      arrivalTime: source.arrivalTime,
      cycle: source.cycle,
      openedAt: receipt.receivedAt.toISOString(),
      closedAt: receipt.closedAt?.toISOString() ?? null,
      note: receipt.note,
      lines,
      totals: {
        boxOrdered: lines.reduce((n, line) => n + line.boxOrdered, 0),
        boxScanned: lines.reduce((n, line) => n + line.boxScanned, 0),
        pcsReceived: lines.reduce((n, line) => n + line.pcsReceived, 0),
        missing: lines.reduce((n, line) => n + Math.max(0, line.boxOrdered - line.boxScanned), 0),
      },
      history: events
        .slice(-100)
        .reverse()
        .map((event) => {
          const meta = event.meta as ScanMeta;
          return {
            id: event.id,
            code: event.rawCode,
            result: meta.result,
            message: meta.result === 'OPEN' ? 'Sesi receiving dibuka' : meta.message,
            at: event.scannedAt.toISOString(),
            userName: actors.find((actor) => actor.id === event.userId)?.name ?? null,
          };
        }),
    };
  }

  async scan(
    id: number,
    input: { code: string; clientRef: string },
    principal?: Principal,
  ): Promise<ReceivingScanOutcome> {
    this.writer(principal);
    const receipt = await this.receipt(id, principal);
    const user = this.scope(receipt, principal);
    const source = receipt.sourceSnapshot!;
    // Sumber harus masih dapat dibaca, agar kanban yang dibatalkan ARES tidak diterima dari cache.
    const live = await this.source(source.orderNumber, source.revision);
    const code = input.code.trim().toUpperCase();
    const parsed = parseAresScanCode(code);
    return this.db.transaction(async (tx) => {
      const current = await this.locked(tx, id, receipt.plantId);
      const events = await this.events(tx, id);
      const previous = events.find(
        (event) => event.dedupeKey === `ares-rcv:${id}:${input.clientRef}`,
      );
      const makeOutcome = (meta: ScanMeta, serial: number | null): ReceivingScanOutcome => {
        const line = this.progress(source, events).find((line) => line.id === meta.lineId);
        return {
          result: meta.result as ReceivingScanOutcome['result'],
          message: meta.message,
          autoShipped: Boolean(meta.autoShipped),
          kanbanSerial: serial,
          line: line ? { id: line.id, boxScanned: line.boxScanned } : null,
          clientRef: input.clientRef,
        };
      };
      if (previous && previous.rawCode !== code)
        throw new BadRequestException('Referensi scan sudah dipakai untuk barcode berbeda');
      if (previous)
        return makeOutcome(
          previous.meta as ScanMeta,
          source.kanbans.find((kanban) => `ARES:K:${kanban.id}` === previous.rawCode)?.serial ??
            null,
        );
      if (current.status !== 'DRAFT')
        throw new ConflictException('Sesi receiving sudah ditutup/dibatalkan');
      const kanban =
        parsed?.kind === 'KANBAN' ? live.kanbans.find((card) => card.id === parsed.id) : undefined;
      const line = source.lines.find((item) => item.id === kanban?.lineId);
      const liveLine = live.lines.find((item) => item.id === line?.id);
      let verdict = receivingVerdict(
        kanban?.status ?? '',
        Boolean(line),
        source.revision,
        kanban?.revision ?? source.revision,
      );
      if (!['ISSUED', 'DOWNLOADED', 'SHIPPED'].includes(live.status))
        verdict = {
          result: 'REJECTED',
          message: `Order Sheet berstatus ${live.status}`,
          autoShipped: false,
        };
      if (
        line &&
        (!liveLine ||
          liveLine.qtyPerBox !== line.qtyPerBox ||
          liveLine.boxOrdered !== line.boxOrdered)
      )
        verdict = {
          result: 'REJECTED',
          message: 'Item Order Sheet berubah sejak sesi dibuka. Hubungi PPIC.',
          autoShipped: false,
        };
      if (parsed?.kind === 'KANBAN') {
        const accepted = await tx
          .select({ id: scanEvents.id, sessionId: receipts.id })
          .from(scanEvents)
          .innerJoin(
            receipts,
            eq(receipts.id, sql`JSON_EXTRACT(${scanEvents.meta}, '$.sessionId')`),
          )
          .where(
            and(
              eq(scanEvents.kind, 'RECEIVING'),
              eq(scanEvents.rawCode, code),
              ne(receipts.status, 'CANCELLED'),
              sql`JSON_UNQUOTE(JSON_EXTRACT(${scanEvents.meta}, '$.module'))='ARES_RECEIVING'`,
              sql`JSON_UNQUOTE(JSON_EXTRACT(${scanEvents.meta}, '$.result'))='OK'`,
            ),
          )
          .limit(1);
        if (accepted[0]) {
          const meta: ScanMeta = {
            module: 'ARES_RECEIVING',
            sessionId: id,
            lineId: line?.id,
            result: accepted[0].sessionId === id ? 'DUPLICATE' : 'REJECTED',
            message:
              accepted[0].sessionId === id
                ? 'Kanban sudah discan di sesi ini'
                : 'Kanban sudah diterima di sesi MES lain',
          };
          await this.record(tx, id, receipt.plantId, user, input.clientRef, code, meta);
          return makeOutcome(meta, kanban?.serial ?? null);
        }
      }
      const progress = this.progress(source, events).find((item) => item.id === line?.id);
      if (verdict.result === 'OK' && progress && progress.boxScanned >= progress.boxOrdered)
        verdict = {
          result: 'REJECTED',
          message: 'Jumlah box melebihi Order Sheet',
          autoShipped: false,
        };
      const meta: ScanMeta = {
        module: 'ARES_RECEIVING',
        sessionId: id,
        lineId: line?.id,
        ...verdict,
      };
      await this.record(
        tx,
        id,
        receipt.plantId,
        user,
        input.clientRef,
        code,
        meta,
        verdict.result === 'OK' ? line!.qtyPerBox : 0,
        line?.partId,
      );
      const outcome = makeOutcome(meta, kanban?.serial ?? null);
      if (outcome.line && verdict.result === 'OK') outcome.line.boxScanned++;
      return outcome;
    });
  }

  async close(id: number, reason: string | undefined, principal?: Principal) {
    this.writer(principal);
    const receipt = await this.receipt(id, principal);
    const user = this.scope(receipt, principal);
    if (receipt.status === 'RECEIVED') return { id, status: 'RECEIVED' as const };
    const source = receipt.sourceSnapshot!;
    const live = await this.source(source.orderNumber, source.revision);
    this.assertSource(live);
    return this.db.transaction(async (tx) => {
      const current = await this.locked(tx, id, receipt.plantId);
      if (current.status === 'RECEIVED') return { id, status: 'RECEIVED' as const };
      if (current.status !== 'DRAFT') throw new ConflictException('Sesi sudah dibatalkan');
      const events = await this.events(tx, id);
      const lines = this.progress(current.sourceSnapshot!, events);
      for (const line of lines) {
        const liveLine = live.lines.find((item) => item.id === line.id);
        if (
          !liveLine ||
          liveLine.qtyPerBox !== line.qtyPerBox ||
          liveLine.boxOrdered !== line.boxOrdered
        )
          throw new ConflictException(
            'Item Order Sheet berubah. Hubungi PPIC sebelum menutup sesi.',
          );
      }
      for (const event of events.filter((item) => (item.meta as ScanMeta)?.result === 'OK')) {
        const card = live.kanbans.find((item) => `ARES:K:${item.id}` === event.rawCode);
        if (
          !card ||
          receivingVerdict(card.status, true, source.revision, card.revision).result !== 'OK'
        )
          throw new ConflictException('Kanban yang discan berubah/dibatalkan. Hubungi PPIC.');
      }
      let total: ReturnType<typeof receivingCloseTotals>;
      try {
        total = receivingCloseTotals(lines, reason);
      } catch (e) {
        throw new UnprocessableEntityException((e as Error).message);
      }
      const now = new Date();
      for (const line of lines) {
        if (!line.boxScanned) continue;
        const [part] = await tx
          .select()
          .from(parts)
          .where(
            and(
              eq(parts.id, line.partId!),
              eq(parts.plantId, receipt.plantId),
              eq(parts.isActive, true),
            ),
          )
          .limit(1);
        if (!part) throw new ConflictException(`Master part ${line.partNumber} tidak tersedia`);
        let lotId: number | null = null;
        if (needsLot(part.trackingMode)) {
          const [lot] = await tx
            .insert(lots)
            .values({
              plantId: receipt.plantId,
              partId: part.id,
              lotNumber: `ARES-${id}-${line.id}`,
              supplierId: receipt.supplierId,
              receivedAt: now,
              initialQty: String(line.pcsReceived),
            })
            .$returningId();
          lotId = lot!.id;
        }
        await tx.insert(receiptLines).values({
          receiptId: id,
          partId: part.id,
          lotId,
          qty: String(line.pcsReceived),
          uom: part.uom,
        });
        await tx.insert(mutations).values({
          plantId: receipt.plantId,
          partId: part.id,
          locationId: receipt.locationId,
          lotId,
          type: 'RECEIVING_IN',
          qty: String(line.pcsReceived),
          sourceTable: 'TT_PURCHASE_RECEIPT_H',
          sourceId: id,
          userId: user.sub,
          npk: user.npk,
          occurredAt: now,
          meta: {
            source: 'ARES',
            orderNumber: current.sourceSnapshot!.orderNumber,
            revision: current.sourceSnapshot!.revision,
            lineId: line.id,
            poNumber: line.poNumber,
            poItem: line.poItem,
            materialNumber: line.materialNumber,
          },
        });
      }
      await tx
        .update(receipts)
        .set({
          status: 'RECEIVED',
          closedAt: now,
          receivedById: user.sub,
          note: reason?.trim() || null,
        })
        .where(eq(receipts.id, id));
      await this.record(tx, id, receipt.plantId, user, 'CLOSE', receipt.documentNumber, {
        result: total.status,
        message: `Sesi ditutup: ${total.pcs} pcs diterima, ${total.missing} box kurang${reason ? ` — ${reason}` : ''}`,
      });
      return {
        id,
        status: 'RECEIVED' as const,
        completeness: total.status,
        missing: total.missing,
      };
    });
  }

  async cancel(id: number, reason: string, principal?: Principal) {
    const receipt = await this.receipt(id, principal);
    const user = this.scope(receipt, principal);
    if (user.roleKind !== 'ADMIN')
      throw new ForbiddenException('Pembatalan hanya untuk administrator');
    return this.db.transaction(async (tx) => {
      const current = await this.locked(tx, id, receipt.plantId);
      if (current.status === 'CANCELLED') return { id, status: 'CANCELLED' as const };
      const outbox = await tx
        .select()
        .from(sapOutbox)
        .where(and(eq(sapOutbox.sourceTable, 'TT_PURCHASE_RECEIPT_H'), eq(sapOutbox.sourceId, id)))
        .for('update');
      if (outbox.some((doc) => ['SENT', 'CONFIRMED'].includes(doc.status)))
        throw new ConflictException(
          'GR sudah keluar dari MES; proses pembalik SAP belum disepakati',
        );
      const incoming = await tx
        .select()
        .from(mutations)
        .where(
          and(
            eq(mutations.sourceTable, 'TT_PURCHASE_RECEIPT_H'),
            eq(mutations.sourceId, id),
            eq(mutations.type, 'RECEIVING_IN'),
          ),
        );
      for (const row of incoming) {
        const balance = await tx
          .select({ qty: mutations.qty })
          .from(mutations)
          .where(
            and(
              eq(mutations.plantId, row.plantId),
              eq(mutations.partId, row.partId),
              row.locationId === null
                ? isNull(mutations.locationId)
                : eq(mutations.locationId, row.locationId),
              row.lotId === null ? isNull(mutations.lotId) : eq(mutations.lotId, row.lotId),
            ),
          )
          .for('update');
        if (balance.reduce((sum, mutation) => sum + Number(mutation.qty), 0) < Number(row.qty))
          throw new ConflictException(
            'Stok penerimaan sudah dipakai/dipindah. Kembalikan stok dahulu sebelum pembatalan.',
          );
        await tx.insert(mutations).values({
          plantId: row.plantId,
          partId: row.partId,
          locationId: row.locationId,
          lotId: row.lotId,
          type: 'ADJUSTMENT',
          qty: String(-Number(row.qty)),
          sourceTable: 'TT_PURCHASE_RECEIPT_H',
          sourceId: id,
          userId: user.sub,
          npk: user.npk,
          occurredAt: new Date(),
          note: `Pembatalan ${receipt.documentNumber}: ${reason}`.slice(0, 255),
        });
      }
      for (const row of outbox)
        await tx
          .update(sapOutbox)
          .set({ status: 'SKIPPED', lastError: `Receiving dibatalkan: ${reason}` })
          .where(eq(sapOutbox.id, row.id));
      await tx
        .update(receipts)
        .set({ status: 'CANCELLED', note: `Dibatalkan: ${reason}` })
        .where(eq(receipts.id, id));
      await this.record(tx, id, receipt.plantId, user, 'CANCEL', receipt.documentNumber, {
        result: 'CANCELLED',
        message: `Sesi dibatalkan — ${reason}`,
      });
      return { id, status: 'CANCELLED' as const };
    });
  }

  private async record(
    tx: Tx,
    id: number,
    plantId: number,
    user: UserPrincipal,
    key: string,
    code: string,
    outcome: Partial<ScanMeta>,
    qty = 0,
    partId?: number,
  ) {
    await tx.insert(scanEvents).values({
      plantId,
      kind: 'RECEIVING',
      partId: partId ?? null,
      rawCode: code,
      qty,
      userId: user.sub,
      scannedAt: new Date(),
      dedupeKey: `ares-rcv:${id}:${key}`,
      meta: { ...outcome, module: 'ARES_RECEIVING', sessionId: id },
    });
  }
}
