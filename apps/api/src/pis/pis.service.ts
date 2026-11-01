import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import {
  and,
  asc,
  eq,
  inArray,
  or,
  sql,
  type Database,
  plants,
  users,
  roles,
  customers,
  parts,
  customerParts,
  deliveries,
  deliveryLines,
  pisSessions,
  pisPacking,
  scanEvents,
} from '@avicenna/db';
import {
  cleanPisBarcode,
  extractPisLoadingListNumber,
  samePisPds,
  matchPisCustomerKanban,
  findPisLabelItem,
  PIS_DANDORY_DOCKS,
} from '@avicenna/domain';
import {
  PIS_DOCKS,
  PIS_MODES,
  type PisBoard,
  type PisDocument,
  type PisLine,
  type PisMessage,
  type PisMode,
  type PisSound,
  type PisScanInput,
  type PisConfirmInput,
  type PisContextInput,
  type PisUnlockInput,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';
import { parseOrThrow } from '../common/validation-error';
import { FotoService } from '../master/foto.service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Database | Tx;
type State = {
  mode: PisMode;
  dock: string;
  deliveryIds: number[];
  activeKanban: PisBoard['activeKanban'];
  pending: (NonNullable<PisBoard['pending']> & { ttiUnique?: string }) | null;
  interlock:
    | (NonNullable<PisBoard['interlock']> & {
        nextKanban?: NonNullable<PisBoard['activeKanban']>;
        clearPending?: boolean;
      })
    | null;
  startedLineIds: number[];
  ttiUniques: string[];
  cooldownUntil: string | null;
  message: PisMessage;
};
type Session = typeof pisSessions.$inferSelect;
type Context = { plantId: number; userId: number; plants: PisBoard['plants'] };
type Item = PisLine & { deliveryId: number; documentNumber: string };
const fresh = (mode: PisMode = 'OEM', dock = 'TMMIN SPD'): State => ({
  mode,
  dock,
  deliveryIds: [],
  activeKanban: null,
  pending: null,
  interlock: null,
  startedLineIds: [],
  ttiUniques: [],
  cooldownUntil: null,
  message: { status: 'READY', text: 'Scan loading list untuk memulai.' },
});

@Injectable()
export class PisService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly photos: FotoService,
  ) {}

  private async authorize(requested: number | undefined, principal?: Principal): Promise<Context> {
    if (principal?.kind !== 'user')
      throw new ForbiddenException('Masuk sebagai operator untuk memakai PIS.');
    const [user] = await this.db
      .select({ id: users.id, active: users.isActive, plantId: users.plantId, kind: roles.kind })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, principal.sub));
    if (!user?.active || !['ADMIN', 'SCANNING'].includes(user.kind ?? ''))
      throw new ForbiddenException('PIS hanya dapat digunakan operator atau administrator aktif.');
    const available = await this.db
      .select({ id: plants.id, code: plants.code, name: plants.name })
      .from(plants)
      .where(user.kind === 'ADMIN' ? undefined : eq(plants.id, user.plantId ?? 0))
      .orderBy(asc(plants.id));
    const plantId = requested ?? user.plantId ?? available[0]?.id;
    if (!plantId || !available.some((p) => p.id === plantId))
      throw new ForbiddenException('Pabrik PIS tidak dapat diakses.');
    return { plantId, userId: user.id, plants: available };
  }

  private async session(tx: Tx, context: Context) {
    await tx
      .insert(pisSessions)
      .values({ plantId: context.plantId, userId: context.userId, state: fresh() })
      .onConflictDoNothing();
    const [session] = await tx
      .select()
      .from(pisSessions)
      .where(and(eq(pisSessions.plantId, context.plantId), eq(pisSessions.userId, context.userId)))
      .for('update');
    return session!;
  }

  private state(session: Session): State {
    return { ...fresh(), ...(session.state as State) };
  }

  private async persist(tx: Tx, session: Session, state: State) {
    await tx.update(pisSessions).set({ state }).where(eq(pisSessions.id, session.id));
  }

  private async documents(db: Reader, ids: number[], plantId: number): Promise<PisDocument[]> {
    if (!ids.length) return [];
    const docs = await db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        manifestNumber: deliveries.manifestNumber,
        pdsNumber: deliveries.pdsNumber,
        customerName: customers.name,
        deliveryDate: deliveries.deliveryDate,
        cycle: deliveries.cycle,
      })
      .from(deliveries)
      .leftJoin(customers, eq(customers.id, deliveries.customerId))
      .where(and(inArray(deliveries.id, ids), eq(deliveries.plantId, plantId)))
      .orderBy(asc(deliveries.id));
    const lines = await db
      .select({
        id: deliveryLines.id,
        deliveryId: deliveryLines.deliveryId,
        partId: deliveryLines.partId,
        partNumber: parts.partNumber,
        customerPartNumber: sql<
          string | null
        >`COALESCE(${deliveryLines.customerPartNumberSource},${customerParts.customerPartNumber})`,
        partName: parts.name,
        qtyPerKanban: deliveryLines.qtyPerKanban,
        targetQty: deliveryLines.plannedQty,
        packedQty: sql<number>`COALESCE(${pisPacking.packedQty},0)::int`,
      })
      .from(deliveryLines)
      .innerJoin(parts, eq(parts.id, deliveryLines.partId))
      .leftJoin(customerParts, eq(customerParts.id, deliveryLines.customerPartId))
      .leftJoin(pisPacking, eq(pisPacking.deliveryLineId, deliveryLines.id))
      .where(
        inArray(
          deliveryLines.deliveryId,
          docs.map((d) => d.id).length ? docs.map((d) => d.id) : [0],
        ),
      )
      .orderBy(asc(deliveryLines.deliveryId), asc(deliveryLines.id));
    return docs.map((doc) => ({
      ...doc,
      lines: lines
        .filter((line) => line.deliveryId === doc.id)
        .map(({ deliveryId: _id, ...line }) => ({
          ...line,
          remainingQty: Math.max(0, line.targetQty - line.packedQty),
        })),
    }));
  }

  private items(documents: PisDocument[]): Item[] {
    return documents.flatMap((doc) =>
      doc.lines.map((line) => ({
        ...line,
        deliveryId: doc.id,
        documentNumber: doc.documentNumber,
      })),
    );
  }

  private async boardOf(db: Reader, context: Context, state: State): Promise<PisBoard> {
    const documents = await this.documents(db, state.deliveryIds, context.plantId);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const start = new Date(`${date}T00:00:00+07:00`);
    const end = new Date(start.getTime() + 86400000);
    const [daily] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.kind, 'DELIVERY'),
          eq(scanEvents.plantId, context.plantId),
          eq(scanEvents.userId, context.userId),
          sql`${scanEvents.meta}->>'phase'='PACKING'`,
          sql`${scanEvents.meta}->>'action'='CONFIRM'`,
          sql`${scanEvents.scannedAt} >= ${start}`,
          sql`${scanEvents.scannedAt} < ${end}`,
        ),
      );
    return {
      plantId: context.plantId,
      plants: context.plants,
      mode: state.mode,
      dock: state.dock,
      stage: !documents.length
        ? 'DOCUMENT'
        : state.activeKanban && state.dock !== 'TTI'
          ? 'LABEL'
          : 'KANBAN',
      documents,
      activeKanban: state.activeKanban,
      pending: state.pending,
      interlock: state.interlock,
      cooldownUntil: state.cooldownUntil,
      dailyCount: daily?.count ?? 0,
      message: state.message,
      complete:
        documents.length > 0 &&
        documents.every(
          (doc) => doc.lines.length > 0 && doc.lines.every((line) => line.remainingQty === 0),
        ),
    };
  }

  async board(plantId: number | undefined, principal?: Principal) {
    const context = await this.authorize(plantId, principal);
    return this.db.transaction(async (tx) =>
      this.boardOf(tx, context, this.state(await this.session(tx, context))),
    );
  }

  private async audit(
    tx: Tx,
    context: Context,
    state: State,
    action: string,
    raw: string,
    key = `pis:${randomUUID()}`,
    extra: Record<string, unknown> = {},
  ) {
    await tx
      .insert(scanEvents)
      .values({
        plantId: context.plantId,
        userId: context.userId,
        kind: 'DELIVERY',
        rawCode: raw.slice(0, 255),
        qty: action === 'CONFIRM' ? 1 : 0,
        scannedAt: new Date(),
        dedupeKey: key,
        meta: {
          menu: 'PIS',
          phase: 'PACKING',
          action,
          deliveryIds: state.deliveryIds,
          rawCode: raw,
          ...extra,
        },
      });
  }

  private lock(
    state: State,
    reason: string,
    expected: string,
    scanned: string,
    sound?: PisSound,
    extra: Partial<NonNullable<State['interlock']>> = {},
  ) {
    state.interlock = { id: randomUUID(), reason, expected, scanned, ...extra };
    state.message = { status: 'ERROR', text: `${reason} Hubungi JP/Leader untuk verifikasi.`, sound };
  }

  private blocked(state: State) {
    if (state.interlock)
      throw new ConflictException('Interlock aktif. Verifikasi JP/Leader sebelum melanjutkan.');
    if (state.pending)
      throw new ConflictException(
        'Tekan Confirm Packing sebelum mengganti konteks atau scan berikutnya.',
      );
  }

  private async lockDocuments(tx: Tx, ids: number[], plantId: number) {
    if (!ids.length) return;
    const docs = await tx
      .select({ id: deliveries.id, status: deliveries.status })
      .from(deliveries)
      .where(and(eq(deliveries.plantId, plantId), inArray(deliveries.id, ids)))
      .orderBy(asc(deliveries.id))
      .for('update');
    if (
      docs.length !== ids.length ||
      docs.some((d) => ['CANCELLED', 'SHIPPED', 'RECEIVED'].includes(d.status))
    )
      throw new ConflictException(
        'Loading list dibatalkan, sudah berangkat, atau tidak tersedia. Scan tidak dapat dilanjutkan.',
      );
  }

  private preview(plantId: number, item: Item, state: State) {
    return `/pis/image?${new URLSearchParams({ plantId: String(plantId), part: item.customerPartNumber ?? item.partNumber, mode: state.mode, dock: state.dock })}`;
  }

  async scan(input: PisScanInput, principal?: Principal): Promise<PisBoard> {
    const context = await this.authorize(input.plantId, principal);
    return this.db.transaction(async (tx) => {
      const session = await this.session(tx, context),
        state = this.state(session);
      const key = `pis:scan:${session.id}:${input.clientRef}`;
      const [previous] = await tx
        .select({ meta: scanEvents.meta })
        .from(scanEvents)
        .where(eq(scanEvents.dedupeKey, key));
      if (previous) {
        if ((previous.meta as { rawCode?: string })?.rawCode !== input.code)
          throw new ConflictException('clientRef sudah dipakai untuk barcode berbeda.');
        return this.boardOf(tx, context, state);
      }
      this.blocked(state);
      const code = cleanPisBarcode(input.code);
      const normalizedLl = extractPisLoadingListNumber(code);
      const found = await tx
        .select({
          id: deliveries.id,
          pdsNumber: deliveries.pdsNumber,
          customerId: deliveries.customerId,
        })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.plantId, context.plantId),
            or(
              eq(deliveries.documentNumber, code),
              ...(normalizedLl
                ? [
                    eq(deliveries.documentNumber, normalizedLl),
                    eq(deliveries.documentNumber, `${normalizedLl} A`),
                  ]
                : []),
            ),
          ),
        );
      if (found.length > 1) {
        state.message = {
          status: 'ERROR',
          text: 'Barcode cocok dengan beberapa loading list. Scan nomor loading list yang lengkap.',
        };
      } else if (found.length === 1) {
        const next = found[0]!;
        await this.lockDocuments(
          tx,
          [...new Set([...state.deliveryIds, next.id])].sort((a, b) => a - b),
          context.plantId,
        );
        const [first] = state.deliveryIds.length
          ? await tx
              .select({ pdsNumber: deliveries.pdsNumber, customerId: deliveries.customerId })
              .from(deliveries)
              .where(eq(deliveries.id, state.deliveryIds[0]!))
          : [];
        if (
          first &&
          (!samePisPds(first.pdsNumber, next.pdsNumber) || first.customerId !== next.customerId)
        ) {
          this.lock(
            state,
            'PDS/customer loading list berbeda dari sesi aktif.',
            first.pdsNumber ?? '',
            next.pdsNumber ?? '',
            'PDS_DIFFERENT',
          );
        } else if (state.deliveryIds.includes(next.id)) {
          state.message = {
            status: 'WARNING',
            text: 'Loading list sudah dimuat. Progres packing tetap tersimpan.',
          };
        } else {
          state.deliveryIds.push(next.id);
          state.activeKanban = null;
          state.startedLineIds = [];
          state.message = { status: 'SUCCESS', text: 'Loading list dimuat. Scan kanban customer.' };
        }
      } else if (!state.deliveryIds.length || normalizedLl) {
        state.message = {
          status: 'ERROR',
          text: 'Loading list tidak ditemukan pada data pengiriman pabrik ini.',
        };
      } else {
        await this.lockDocuments(
          tx,
          [...state.deliveryIds].sort((a, b) => a - b),
          context.plantId,
        );
        const documents = await this.documents(tx, state.deliveryIds, context.plantId),
          items = this.items(documents);
        // Kanban berikutnya dapat dibaca saat LABEL; formatnya tetap harus lolos validasi LL + part.
        const kanban = matchPisCustomerKanban(
          code,
          items,
          documents.map((d) => d.documentNumber),
          state.dock,
        );
        if (kanban.ok) {
          const item = kanban.item;
          if (state.dock === 'TTI') {
            if (!kanban.unique || state.ttiUniques.includes(kanban.unique)) {
              state.message = {
                status: 'ERROR',
                text: 'Unique kanban TTI sudah dikonfirmasi dalam sesi ini.',
              };
            } else {
              state.pending = {
                id: randomUUID(),
                deliveryId: item.deliveryId,
                lineId: item.id,
                label: code,
                partNumber: item.partNumber,
                customerPartNumber: item.customerPartNumber,
                createdAt: new Date().toISOString(),
                previewUrl: this.preview(context.plantId, item, state),
                ttiUnique: kanban.unique,
              };
              state.message = {
                status: 'SUCCESS',
                text: 'Kanban TTI sesuai. Tekan Confirm Packing untuk mencatat 1 pcs.',
              };
            }
          } else {
            const nextKanban = {
              code,
              partNumber: item.customerPartNumber ?? item.partNumber,
              lineId: item.id,
            };
            const unfinished = items.filter(
              (it) =>
                state.startedLineIds.includes(it.id) &&
                it.remainingQty > 0 &&
                it.partNumber !== item.partNumber,
            );
            if (unfinished.length)
              this.lock(
                state,
                'Pindah part sebelum part aktif selesai.',
                unfinished.map((it) => it.customerPartNumber ?? it.partNumber).join(', '),
                nextKanban.partNumber,
                'MOVE_KANBAN',
                { nextKanban },
              );
            else {
              state.activeKanban = nextKanban;
              if (!state.startedLineIds.includes(item.id)) state.startedLineIds.push(item.id);
              state.message = { status: 'SUCCESS', text: 'Kanban sesuai. Scan label part.' };
            }
          }
        } else if (state.activeKanban && state.dock !== 'TTI') {
          const active = items.find((it) => it.id === state.activeKanban!.lineId);
          const item = findPisLabelItem(code, items, state.dock);
          if (!item || !active || item.partNumber !== active.partNumber) {
            this.lock(
              state,
              'Label part tidak sesuai kanban atau loading list.',
              state.activeKanban.partNumber,
              code,
              'LABEL_INVALID',
            );
          } else if (state.cooldownUntil && Date.parse(state.cooldownUntil) > Date.now()) {
            state.message = {
              status: 'WARNING',
              text: 'Delay scan 15 detik masih aktif. Tunggu sebelum scan label berikutnya.',
            };
          } else {
            state.pending = {
              id: randomUUID(),
              deliveryId: item.deliveryId,
              lineId: item.id,
              label: code,
              partNumber: item.partNumber,
              customerPartNumber: item.customerPartNumber,
              createdAt: new Date().toISOString(),
              previewUrl: this.preview(context.plantId, item, state),
            };
            state.cooldownUntil = new Date(Date.now() + 15000).toISOString();
            state.message = {
              status: 'SUCCESS',
              text: 'Label sesuai. Tekan Confirm Packing untuk mencatat 1 pcs.',
            };
          }
        } else {
          const text: Record<string, string> = {
            INVALID_FORMAT: 'Format kanban tidak sesuai.',
            LABEL_ONLY: 'Scan kanban customer terlebih dahulu, bukan label part.',
            LOADING_LIST_MISMATCH: 'Kanban tidak memuat loading list sesi ini.',
            PART_NOT_FOUND: 'Part kanban tidak ada pada loading list.',
            TARGET_REACHED: 'Target packing part sudah terpenuhi.',
          };
          state.message = { status: 'ERROR', text: text[kanban.code] ?? 'Kanban tidak sesuai.' };
        }
      }
      await this.audit(
        tx,
        context,
        state,
        state.interlock ? 'INTERLOCK' : 'SCAN',
        input.code,
        key,
        { clientRef: input.clientRef, message: state.message.text, interlock: state.interlock },
      );
      await this.persist(tx, session, state);
      return this.boardOf(tx, context, state);
    });
  }

  async confirm(input: PisConfirmInput, principal?: Principal): Promise<PisBoard> {
    const context = await this.authorize(input.plantId, principal);
    return this.db.transaction(async (tx) => {
      const session = await this.session(tx, context),
        state = this.state(session);
      const key = `pis:confirm:${input.pendingId}`;
      const [previous] = await tx
        .select({ userId: scanEvents.userId, plantId: scanEvents.plantId })
        .from(scanEvents)
        .where(eq(scanEvents.dedupeKey, key));
      if (previous) {
        if (previous.userId !== context.userId || previous.plantId !== context.plantId)
          throw new ForbiddenException('Konfirmasi milik sesi operator lain.');
        return this.boardOf(tx, context, state);
      }
      if (state.interlock)
        throw new ConflictException('Interlock aktif. Verifikasi JP/Leader terlebih dahulu.');
      const pending = state.pending;
      if (!pending || pending.id !== input.pendingId)
        throw new ConflictException(
          'Label pending tidak ditemukan atau sudah berubah. Muat ulang PIS.',
        );
      await this.lockDocuments(
        tx,
        [...state.deliveryIds].sort((a, b) => a - b),
        context.plantId,
      );
      const items = this.items(await this.documents(tx, state.deliveryIds, context.plantId));
      const item = items.find(
        (it) => it.id === pending.lineId && it.deliveryId === pending.deliveryId,
      );
      if (
        !item ||
        item.partNumber !== pending.partNumber ||
        item.customerPartNumber !== pending.customerPartNumber ||
        item.remainingQty <= 0
      ) {
        this.lock(
          state,
          'Rencana item berubah atau target sudah dikonfirmasi operator lain.',
          pending.partNumber,
          pending.label,
          undefined,
          { clearPending: true },
        );
        await this.audit(tx, context, state, 'INTERLOCK', pending.label, undefined, {
          interlock: state.interlock,
        });
        await this.persist(tx, session, state);
        return this.boardOf(tx, context, state);
      }
      await tx
        .insert(pisPacking)
        .values({ plantId: context.plantId, deliveryLineId: item.id, packedQty: 1 })
        .onConflictDoUpdate({
          target: pisPacking.deliveryLineId,
          set: { packedQty: sql`${pisPacking.packedQty} + 1` },
        });
      await this.audit(tx, context, state, 'CONFIRM', pending.label, key, {
        pendingId: pending.id,
        deliveryId: item.deliveryId,
        deliveryLineId: item.id,
        partNumber: item.partNumber,
        customerPartNumber: item.customerPartNumber,
        ttiUnique: pending.ttiUnique ?? null,
        mode: state.mode,
        dock: state.dock,
      });
      if (pending.ttiUnique) state.ttiUniques.push(pending.ttiUnique);
      state.pending = null;
      if (item.remainingQty <= 1 || state.dock === 'TTI') state.activeKanban = null;
      const after = await this.documents(tx, state.deliveryIds, context.plantId);
      const complete =
        after.length > 0 &&
        after.every(
          (doc) => doc.lines.length > 0 && doc.lines.every((line) => line.remainingQty === 0),
        );
      state.message = {
        status: complete ? 'COMPLETE' : 'SUCCESS',
        text: complete
          ? 'Seluruh item loading list selesai packing.'
          : `Packing tercatat 1 pcs. Sisa part: ${Math.max(0, item.remainingQty - 1)} pcs.`,
      };
      await this.persist(tx, session, state);
      return this.boardOf(tx, context, state);
    });
  }

  async context(input: PisContextInput, principal?: Principal) {
    const context = await this.authorize(input.plantId, principal);
    if (input.mode === 'DANDORY' && !(PIS_DANDORY_DOCKS as readonly string[]).includes(input.dock))
      throw new BadRequestException('Dock ini tidak tersedia untuk mode DANDORY.');
    return this.db.transaction(async (tx) => {
      const session = await this.session(tx, context),
        state = this.state(session);
      this.blocked(state);
      state.mode = input.mode;
      state.dock = input.dock;
      state.activeKanban = null;
      state.startedLineIds = [];
      state.message = {
        status: 'READY',
        text: state.deliveryIds.length
          ? 'Konteks diperbarui. Scan kanban customer.'
          : 'Scan loading list untuk memulai.',
      };
      await this.persist(tx, session, state);
      await this.audit(tx, context, state, 'CONTEXT', `${input.mode}:${input.dock}`);
      return this.boardOf(tx, context, state);
    });
  }

  async reset(plantId: number, principal?: Principal) {
    const context = await this.authorize(plantId, principal);
    return this.db.transaction(async (tx) => {
      const session = await this.session(tx, context),
        old = this.state(session);
      this.blocked(old);
      await this.audit(tx, context, old, 'RESET', 'DELAY');
      const state = fresh(old.mode, old.dock);
      await this.persist(tx, session, state);
      return this.boardOf(tx, context, state);
    });
  }

  async unlock(input: PisUnlockInput, principal?: Principal) {
    const context = await this.authorize(input.plantId, principal);
    const [leader] = await this.db
      .select({ id: users.id, active: users.isActive, plantId: users.plantId, kind: roles.kind })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.npk, input.npk));
    if (
      !leader?.active ||
      !['ADMIN', 'VIEW'].includes(leader.kind ?? '') ||
      (leader.kind !== 'ADMIN' && leader.plantId !== context.plantId)
    )
      throw new ForbiddenException('NPK tidak terdaftar sebagai JP/Leader aktif pada pabrik ini.');
    return this.db.transaction(async (tx) => {
      const session = await this.session(tx, context),
        state = this.state(session);
      if (!state.interlock) throw new ConflictException('Tidak ada interlock yang perlu dibuka.');
      const interlock = state.interlock;
      await this.audit(tx, context, state, 'UNLOCK', input.npk, undefined, {
        leaderId: leader.id,
        interlock,
      });
      state.activeKanban = interlock.nextKanban ?? null;
      if (interlock.clearPending) state.pending = null;
      state.startedLineIds = state.activeKanban ? [state.activeKanban.lineId] : [];
      state.interlock = null;
      state.message = {
        status: 'SUCCESS',
        text: state.activeKanban
          ? 'Verifikasi berhasil. Scan label part untuk kanban aktif.'
          : 'Verifikasi berhasil. Scan kanban kembali; loading list PDS berbeda tetap tidak dimasukkan.',
      };
      await this.persist(tx, session, state);
      return this.boardOf(tx, context, state);
    });
  }

  async image(raw: Record<string, unknown>, principal?: Principal) {
    const input = parseOrThrow(
      z
        .object({
          plantId: z.coerce.number().int().positive(),
          part: z.string().trim().min(1).max(100),
          mode: z.enum(PIS_MODES).default('OEM'),
          dock: z.enum(PIS_DOCKS).default('TMMIN SPD'),
        })
        .strict(),
      raw,
    );
    await this.authorize(input.plantId, principal);
    if (input.mode === 'DANDORY' && !(PIS_DANDORY_DOCKS as readonly string[]).includes(input.dock))
      throw new BadRequestException('Dock ini tidak tersedia untuk mode DANDORY.');
    const part = input.part.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      dock = input.dock.toUpperCase();
    const variants = [
      ...new Set([dock, dock.replace(/ /g, '_'), dock.replace(/ /g, '-'), dock.replace(/ /g, '')]),
    ];
    const partNames = [...new Set([part, part.replace(/-/g, '')])];
    const bases = [
      ...variants.flatMap((d) => partNames.map((p) => `${p}-${input.mode}-${d}`)),
      ...partNames,
    ];
    const directory = resolve(process.env.PIS_IMAGE_DIR ?? join(process.cwd(), 'data', 'pis'));
    for (const filename of bases.flatMap((base) =>
      ['.webp', '.WEBP', '.JPG'].map((ext) => `${base}${ext}`),
    )) {
      try {
        return {
          bytes: await readFile(join(directory, filename)),
          mime: filename.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg',
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const matched = await this.db
      .select({ id: parts.id, path: parts.photoPath })
      .from(parts)
      .leftJoin(customerParts, eq(customerParts.partId, parts.id))
      .where(
        and(
          eq(parts.plantId, input.plantId),
          or(eq(parts.partNumber, input.part), eq(customerParts.customerPartNumber, input.part)),
        ),
      );
    const unique = [
      ...new Map(
        matched.filter((p) => p.path && !/^https?:/i.test(p.path)).map((p) => [p.id, p]),
      ).values(),
    ];
    if (unique.length === 1) {
      try {
        const photo = await this.photos.baca(unique[0]!.path!);
        return { bytes: photo.isi, mime: photo.mimeType };
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    try {
      return { bytes: await readFile(join(directory, 'default.JPG')), mime: 'image/jpeg' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    throw new NotFoundException('Gambar PIS untuk part/type/dock ini belum tersedia.');
  }
}
