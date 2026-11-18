import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  sql,
  type Database,
  type MoldScannedMemberState,
  lines,
  parts,
  toolings,
  toolingParts,
  kanbans,
  users,
  roles,
  scanEvents,
  moldScanSessions,
  moldScanEvents,
} from '@avicenna/db';
import {
  bacaKanban,
  KanbanTidakTerbaca,
  nomorPartSama,
  bolehScanDi,
  evaluasiScanAnggotaMold,
} from '@avicenna/domain';
import type {
  MoldMemberProgress,
  MoldScanBoard,
  MoldScanInput,
  StationResult,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';
import { ProcessTypeService } from '../master/process-type.service';
import { ScanService } from './scan.service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Database | Tx;
type Session = typeof moldScanSessions.$inferSelect;
type Line = typeof lines.$inferSelect;
type Context = { line: Line; userId: number };

@Injectable()
export class MoldScanService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly scanService: ScanService,
    private readonly processTypes: ProcessTypeService,
  ) {}

  /** Stasiun mold tetap tunduk pada pabrik dan grup proses role operator. */
  private async context(lineCode: string, principal?: Principal): Promise<Context> {
    if (principal?.kind !== 'user') {
      throw new ForbiddenException('Masuk sebagai operator untuk memakai scan mold.');
    }

    const [user] = await this.db
      .select({
        id: users.id,
        active: users.isActive,
        plantId: users.plantId,
        roleKind: roles.kind,
        processGroup: roles.processGroup,
        roleActive: roles.isActive,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, principal.sub))
      .limit(1);

    if (!user?.active || !user.roleActive || !user.roleKind) {
      throw new ForbiddenException('Akun Anda belum memiliki role aktif.');
    }

    const [line] = await this.db
      .select()
      .from(lines)
      .where(
        and(
          eq(lines.code, lineCode),
          eq(lines.isActive, true),
          ...(user.roleKind === 'ADMIN' ? [] : [eq(lines.plantId, user.plantId ?? 0)]),
        ),
      )
      .limit(1);
    if (!line) throw new BadRequestException(`Line ${lineCode} tidak ditemukan.`);

    if ((await this.scanService.modeScanLini(line.processType, line.scanMode)) !== 'KANBAN_MOLD') {
      throw new BadRequestException(`Line ${line.code} tidak memakai mode scan mold.`);
    }

    const katalog = await this.processTypes.katalog();
    if (
      (user.roleKind !== 'ADMIN' && user.plantId !== line.plantId) ||
      !bolehScanDi(
        katalog,
        { kind: user.roleKind, processGroup: user.processGroup },
        line.processType,
      )
    ) {
      throw new ForbiddenException('Role Anda tidak boleh men-scan pada line mold ini.');
    }
    return { line, userId: user.id };
  }

  private async lockedSession(tx: Tx, lineId: number): Promise<Session> {
    await tx.insert(moldScanSessions).values({ lineId }).onConflictDoNothing({
      target: moldScanSessions.lineId,
    });
    const [session] = await tx
      .select()
      .from(moldScanSessions)
      .where(eq(moldScanSessions.lineId, lineId))
      .for('update');
    if (!session) throw new Error('Sesi scan mold gagal dibuat.');
    return session;
  }

  /**
   * Memulihkan progres dari ledger produksi.
   *
   * Scan produksi dan sesi mold memakai dua transaksi karena jalur scan juga
   * mengurus stok, kanban, SAP, dan antrean. Bila proses mati tepat di antara
   * keduanya, ledger produksi tetap menjadi sumber kebenaran: baris yang sudah
   * masuk dikembalikan ke progres sebelum scan berikutnya diperiksa.
   */
  private async reconcile(tx: Tx, context: Context, session: Session): Promise<Session> {
    if (!session.toolingId || session.memberPartIds.length === 0) return session;

    const rows = await tx
      .select({
        partId: scanEvents.partId,
        qty: scanEvents.qty,
        serialNumber: scanEvents.serialNumber,
        meta: scanEvents.meta,
      })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.lineId, context.line.id),
          eq(scanEvents.kind, 'PRODUCTION'),
          inArray(scanEvents.partId, session.memberPartIds),
          sql`${scanEvents.meta}->>'moldToolingId' = ${String(session.toolingId)}`,
          sql`${scanEvents.meta}->>'moldCycleNo' = ${String(session.cycleNo)}`,
        ),
      );
    if (rows.length === 0) return session;

    const cards = await tx
      .select({ id: kanbans.id, partId: kanbans.partId, serialNumber: kanbans.serialNumber })
      .from(kanbans)
      .where(inArray(kanbans.partId, session.memberPartIds));
    const cardByKey = new Map(cards.map((c) => [`${c.partId}|${c.serialNumber}`, c.id]));
    const recovered = new Map<number, MoldScannedMemberState>();
    for (const row of rows) {
      if (!row.partId || !row.serialNumber) continue;
      const kanbanId = cardByKey.get(`${row.partId}|${row.serialNumber}`);
      if (!kanbanId) continue;
      recovered.set(row.partId, {
        partId: row.partId,
        kanbanId,
        kanbanSerial: row.serialNumber,
        qty: row.qty,
        clientRef:
          row.meta && typeof row.meta === 'object' && 'moldClientRef' in row.meta
            ? String(row.meta.moldClientRef)
            : undefined,
      });
    }
    if (recovered.size === 0) return session;

    const existingEvents = await tx
      .select({ clientRef: moldScanEvents.clientRef })
      .from(moldScanEvents)
      .where(
        and(
          eq(moldScanEvents.lineId, context.line.id),
          eq(moldScanEvents.toolingId, session.toolingId),
          eq(moldScanEvents.cycleNo, session.cycleNo),
          eq(moldScanEvents.type, 'MEMBER_SCANNED'),
        ),
      );
    const knownRefs = new Set(
      existingEvents.flatMap((event) => (event.clientRef ? [event.clientRef] : [])),
    );
    const recoveredEvents = [...recovered.values()].filter(
      (item) => item.clientRef && !knownRefs.has(item.clientRef),
    );
    if (recoveredEvents.length > 0) {
      await tx.insert(moldScanEvents).values(
        recoveredEvents.map((item) => ({
          lineId: context.line.id,
          toolingId: session.toolingId,
          partId: item.partId,
          kanbanId: item.kanbanId,
          cycleNo: session.cycleNo,
          type: 'MEMBER_SCANNED' as const,
          clientRef: item.clientRef,
          userId: context.userId,
          occurredAt: new Date(),
          meta: {
            qty: item.qty,
            kanbanSerial: item.kanbanSerial,
            recovered: true,
          },
        })),
      );
    }

    if (session.memberPartIds.every((id) => recovered.has(id))) {
      const scanned = session.memberPartIds.map((id) => recovered.get(id)!);
      await tx.insert(moldScanEvents).values({
        lineId: context.line.id,
        toolingId: session.toolingId,
        cycleNo: session.cycleNo,
        type: 'CYCLE_COMPLETED',
        userId: context.userId,
        occurredAt: new Date(),
        meta: { scanned, recovered: true },
      });
      const [updated] = await tx
        .update(moldScanSessions)
        .set({ cycleNo: session.cycleNo + 1, scanned: [] })
        .where(eq(moldScanSessions.id, session.id))
        .returning();
      return updated!;
    }

    const scanned = session.memberPartIds
      .map((id) => recovered.get(id))
      .filter((item): item is MoldScannedMemberState => Boolean(item));
    if (
      scanned.length === session.scanned.length &&
      scanned.every((item) => session.scanned.some((old) => old.partId === item.partId))
    ) {
      return session;
    }
    const [updated] = await tx
      .update(moldScanSessions)
      .set({ scanned })
      .where(eq(moldScanSessions.id, session.id))
      .returning();
    return updated!;
  }

  private async memberRows(reader: Reader, ids: number[]) {
    if (ids.length === 0) return [];
    const rows = await reader
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        name: parts.name,
      })
      .from(parts)
      .where(inArray(parts.id, ids));
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  }

  private async boardOf(
    reader: Reader,
    line: Line,
    session: Session,
    extra: {
      message?: MoldScanBoard['message'];
      lastResult?: StationResult | null;
      completed?: { cycleNo: number; members: MoldMemberProgress[] } | null;
    } = {},
  ): Promise<MoldScanBoard> {
    const [mold] = session.toolingId
      ? await reader
          .select({ id: toolings.id, code: toolings.code, name: toolings.name })
          .from(toolings)
          .where(eq(toolings.id, session.toolingId))
          .limit(1)
      : [];
    const memberRows = await this.memberRows(reader, session.memberPartIds ?? []);
    const scanned = new Map((session.scanned ?? []).map((s) => [s.partId, s]));
    const members: MoldMemberProgress[] = memberRows.map((p) => {
      const done = scanned.get(p.id);
      return {
        partId: p.id,
        partNumber: p.partNumber,
        backNumber: p.backNumber ?? null,
        partName: p.name,
        scanned: Boolean(done),
        kanbanSerial: done?.kanbanSerial ?? null,
        qty: done?.qty ?? null,
      };
    });

    const defaultMessage: MoldScanBoard['message'] =
      session.status === 'LOCKED'
        ? {
            status: 'LOCKED',
            text: `${session.lockReason ?? 'Interlock aktif.'} Scan NPK JP/Leader untuk membuka.`,
          }
        : session.status === 'WAITING_MOLD'
          ? { status: 'READY', text: 'Scan tag mold untuk memulai.' }
          : {
              status: 'READY',
              text: `Scan kanban anggota mold (${members.filter((m) => m.scanned).length}/${members.length}).`,
            };

    return {
      status: session.status,
      lineCode: line.code,
      cycleNo: session.cycleNo,
      mold: mold ?? null,
      members,
      lock:
        session.status === 'LOCKED' && session.lockedAt
          ? {
              reason: session.lockReason ?? 'Interlock aktif.',
              lockedAt: session.lockedAt.toISOString(),
            }
          : null,
      message: extra.message ?? defaultMessage,
      lastResult: extra.lastResult ?? null,
      completedCycle: extra.completed ?? null,
    };
  }

  async board(lineCode: string, principal?: Principal): Promise<MoldScanBoard> {
    const context = await this.context(lineCode, principal);
    return this.db.transaction(async (tx) => {
      let session = await this.lockedSession(tx, context.line.id);
      if (session.status !== 'LOCKED') session = await this.reconcile(tx, context, session);
      return this.boardOf(tx, context.line, session);
    });
  }

  private cleanMoldCode(raw: string): string {
    return raw
      .trim()
      .replace(/^MOLD\s*[:|]\s*/i, '')
      .trim();
  }

  private async findMold(reader: Reader, line: Line, raw: string) {
    const code = this.cleanMoldCode(raw);
    if (!code) return undefined;
    const [mold] = await reader
      .select()
      .from(toolings)
      .where(
        and(
          eq(toolings.plantId, line.plantId),
          eq(toolings.kind, 'MOLD'),
          eq(toolings.isActive, true),
          sql`upper(${toolings.code}) = ${code.toUpperCase()}`,
        ),
      )
      .limit(1);
    return mold;
  }

  private async selectMold(
    tx: Tx,
    context: Context,
    session: Session,
    mold: typeof toolings.$inferSelect,
    rawCode: string,
  ) {
    if ((session.scanned ?? []).length > 0) {
      throw new BadRequestException(
        'Satu putaran sudah berjalan. Lengkapi semua anggota sebelum mengganti atau memuat ulang mold.',
      );
    }
    const memberRows = await tx
      .select({ id: parts.id })
      .from(toolingParts)
      .innerJoin(parts, eq(toolingParts.partId, parts.id))
      .where(
        and(
          eq(toolingParts.toolingId, mold.id),
          eq(toolingParts.plantId, context.line.plantId),
          eq(parts.isActive, true),
        ),
      );
    const memberPartIds = memberRows.map((m) => m.id);
    if (memberPartIds.length === 0) {
      throw new BadRequestException(
        `Mold ${mold.code} belum memiliki part anggota aktif. Isi Master Data › Anggota Tooling.`,
      );
    }

    const [updated] = await tx
      .update(moldScanSessions)
      .set({
        toolingId: mold.id,
        status: 'COLLECTING',
        memberPartIds,
        scanned: [],
        lockReason: null,
        lockedAt: null,
      })
      .where(eq(moldScanSessions.id, session.id))
      .returning();
    await tx.insert(moldScanEvents).values({
      lineId: context.line.id,
      toolingId: mold.id,
      cycleNo: session.cycleNo,
      type: 'MOLD_SELECTED',
      rawCode: rawCode.slice(0, 255),
      userId: context.userId,
      occurredAt: new Date(),
      meta: { memberPartIds },
    });
    return this.boardOf(tx, context.line, updated!, {
      message: {
        status: 'SUCCESS',
        text: `Mold ${mold.code} aktif. Scan ${memberPartIds.length} kanban anggotanya.`,
      },
    });
  }

  private async unlock(
    tx: Tx,
    context: Context,
    session: Session,
    rawCode: string,
  ): Promise<MoldScanBoard> {
    const npk = rawCode.trim().split('|', 1)[0]?.trim() ?? '';
    const [supervisor] = await tx
      .select({
        id: users.id,
        npk: users.npk,
        active: users.isActive,
        plantId: users.plantId,
        kind: roles.kind,
        roleActive: roles.isActive,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.npk, npk))
      .limit(1);
    if (
      !supervisor?.active ||
      !supervisor.roleActive ||
      !['ADMIN', 'VIEW'].includes(supervisor.kind ?? '') ||
      (supervisor.kind !== 'ADMIN' && supervisor.plantId !== context.line.plantId)
    ) {
      throw new ForbiddenException('NPK tidak terdaftar sebagai JP/Leader aktif pada pabrik ini.');
    }

    const nextStatus = session.toolingId ? 'COLLECTING' : 'WAITING_MOLD';
    const [updated] = await tx
      .update(moldScanSessions)
      .set({ status: nextStatus, lockReason: null, lockedAt: null })
      .where(eq(moldScanSessions.id, session.id))
      .returning();
    await tx.insert(moldScanEvents).values({
      lineId: context.line.id,
      toolingId: session.toolingId,
      cycleNo: session.cycleNo,
      type: 'UNLOCKED',
      rawCode: npk.slice(0, 255),
      userId: context.userId,
      supervisorUserId: supervisor.id,
      occurredAt: new Date(),
      meta: { reason: session.lockReason },
    });
    return this.boardOf(tx, context.line, updated!, {
      message: {
        status: 'SUCCESS',
        text: `Interlock dibuka oleh ${supervisor.npk}. Lanjutkan anggota yang belum discan.`,
      },
    });
  }

  private async lockDuplicate(
    tx: Tx,
    context: Context,
    session: Session,
    part: { id: number; partNumber: string },
    rawCode: string,
  ): Promise<MoldScanBoard> {
    const lockedAt = new Date();
    const reason = `Kanban ${part.partNumber} discan dua kali sebelum seluruh anggota mold lengkap.`;
    const [updated] = await tx
      .update(moldScanSessions)
      .set({ status: 'LOCKED', lockReason: reason, lockedAt })
      .where(eq(moldScanSessions.id, session.id))
      .returning();
    await tx.insert(moldScanEvents).values({
      lineId: context.line.id,
      toolingId: session.toolingId,
      partId: part.id,
      cycleNo: session.cycleNo,
      type: 'LOCKED',
      rawCode: rawCode.slice(0, 255),
      userId: context.userId,
      occurredAt: lockedAt,
      meta: { reason, scanned: session.scanned },
    });
    return this.boardOf(tx, context.line, updated!, {
      message: { status: 'LOCKED', text: `${reason} Scan NPK JP/Leader untuk membuka.` },
    });
  }

  private async identifyMember(tx: Tx, line: Line, session: Session, rawCode: string) {
    let parsed;
    try {
      parsed = bacaKanban(rawCode, { processType: line.processType, scanMode: 'KANBAN_MOLD' });
    } catch (error) {
      if (error instanceof KanbanTidakTerbaca) {
        throw new BadRequestException('Barcode kanban tidak terbaca. Scan ulang kartunya.');
      }
      throw error;
    }

    const members = await this.memberRows(tx, session.memberPartIds ?? []);
    let matches = members.filter(
      (p) =>
        (parsed.partNumber && nomorPartSama(parsed.partNumber, p.partNumber)) ||
        (parsed.backNumber && p.backNumber === parsed.backNumber),
    );

    if (matches.length === 0 && parsed.serialNumber) {
      const cards = await tx
        .select({ partId: kanbans.partId })
        .from(kanbans)
        .where(
          and(
            inArray(kanbans.partId, session.memberPartIds ?? []),
            eq(kanbans.serialNumber, parsed.serialNumber),
            eq(kanbans.isActive, true),
          ),
        );
      const ids = new Set(cards.map((c) => c.partId));
      matches = members.filter((p) => ids.has(p.id));
    }

    if (matches.length === 0) {
      throw new BadRequestException('Kanban ini bukan anggota mold yang sedang aktif.');
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        'Nomor seri kanban cocok ke lebih dari satu anggota mold. Scan QR lengkap yang memuat part/back number.',
      );
    }
    return { part: matches[0]!, parsed };
  }

  async scan(input: MoldScanInput, principal?: Principal): Promise<MoldScanBoard> {
    const context = await this.context(input.lineCode, principal);

    return this.db.transaction(async (tx) => {
      let session = await this.lockedSession(tx, context.line.id);
      if (session.status === 'LOCKED') return this.unlock(tx, context, session, input.code);
      session = await this.reconcile(tx, context, session);

      const [sameRequest] = await tx
        .select({ id: moldScanEvents.id })
        .from(moldScanEvents)
        .where(
          and(
            eq(moldScanEvents.lineId, context.line.id),
            eq(moldScanEvents.type, 'MEMBER_SCANNED'),
            eq(moldScanEvents.clientRef, input.clientRef),
          ),
        )
        .limit(1);
      if (sameRequest) {
        return this.boardOf(tx, context.line, session, {
          message: {
            status: 'SUCCESS',
            text: 'Kiriman yang sama sudah diterima. Progres tidak ditambah dua kali.',
          },
        });
      }

      const mold = await this.findMold(tx, context.line, input.code);
      if (mold) return this.selectMold(tx, context, session, mold, input.code);
      if (!session.toolingId || session.status === 'WAITING_MOLD') {
        throw new BadRequestException('Scan tag mold yang terdaftar terlebih dahulu.');
      }

      const { part, parsed } = await this.identifyMember(tx, context.line, session, input.code);
      const cycleDecision = evaluasiScanAnggotaMold(
        session.memberPartIds,
        (session.scanned ?? []).map((s) => s.partId),
        part.id,
      );
      if (cycleDecision === 'DUPLICATE') {
        const existing = session.scanned.find((item) => item.partId === part.id);
        if (existing?.clientRef === input.clientRef) {
          return this.boardOf(tx, context.line, session, {
            message: {
              status: 'SUCCESS',
              text: `${part.partNumber} sudah diterima dari kiriman yang sama. Progres tidak ditambah dua kali.`,
            },
          });
        }
        return this.lockDuplicate(tx, context, session, part, input.code);
      }
      if (cycleDecision === 'NOT_MEMBER') {
        throw new BadRequestException('Kanban ini bukan anggota mold yang sedang aktif.');
      }

      const result = await this.scanService.station(
        {
          kind: 'PRODUCTION',
          rawCode: part.partNumber,
          kanbanCode: input.code,
          lineCode: context.line.code,
          clientRef: input.clientRef,
          qty: 1,
          meta: {
            moldToolingId: session.toolingId,
            moldCycleNo: session.cycleNo,
            moldClientRef: input.clientRef,
          },
        },
        principal,
      );
      if (result.status !== 'ACCEPTED') {
        return this.boardOf(tx, context.line, session, {
          lastResult: result,
          message: { status: 'ERROR', text: result.message },
        });
      }

      const [card] = await tx
        .select({ id: kanbans.id })
        .from(kanbans)
        .where(
          and(
            eq(kanbans.partId, part.id),
            eq(kanbans.serialNumber, parsed.serialNumber ?? result.serialNumber ?? ''),
          ),
        )
        .limit(1);
      if (!card) throw new Error('Kanban diterima tetapi identitas kartunya tidak ditemukan.');

      const done: MoldScannedMemberState = {
        partId: part.id,
        kanbanId: card.id,
        kanbanSerial: result.serialNumber ?? parsed.serialNumber ?? '',
        qty: result.qty,
        clientRef: input.clientRef,
      };
      const scanned = [...(session.scanned ?? []), done];
      await tx.insert(moldScanEvents).values({
        lineId: context.line.id,
        toolingId: session.toolingId,
        partId: part.id,
        kanbanId: card.id,
        cycleNo: session.cycleNo,
        type: 'MEMBER_SCANNED',
        clientRef: input.clientRef,
        rawCode: input.code.slice(0, 255),
        userId: context.userId,
        occurredAt: new Date(),
        meta: {
          qty: result.qty,
          kanbanSerial: done.kanbanSerial,
        },
      });

      if (cycleDecision !== 'COMPLETED') {
        const [updated] = await tx
          .update(moldScanSessions)
          .set({ scanned })
          .where(eq(moldScanSessions.id, session.id))
          .returning();
        return this.boardOf(tx, context.line, updated!, {
          lastResult: result,
          message: {
            status: 'SUCCESS',
            text: `${part.partNumber} diterima (${scanned.length}/${session.memberPartIds.length}). Scan anggota berikutnya.`,
          },
        });
      }

      const completedRows = await this.memberRows(tx, session.memberPartIds);
      const byPart = new Map(scanned.map((s) => [s.partId, s]));
      const completed: MoldMemberProgress[] = completedRows.map((p) => ({
        partId: p.id,
        partNumber: p.partNumber,
        backNumber: p.backNumber ?? null,
        partName: p.name,
        scanned: true,
        kanbanSerial: byPart.get(p.id)?.kanbanSerial ?? null,
        qty: byPart.get(p.id)?.qty ?? null,
      }));
      await tx.insert(moldScanEvents).values({
        lineId: context.line.id,
        toolingId: session.toolingId,
        cycleNo: session.cycleNo,
        type: 'CYCLE_COMPLETED',
        userId: context.userId,
        occurredAt: new Date(),
        meta: { scanned },
      });
      const [updated] = await tx
        .update(moldScanSessions)
        .set({ cycleNo: session.cycleNo + 1, scanned: [] })
        .where(eq(moldScanSessions.id, session.id))
        .returning();
      return this.boardOf(tx, context.line, updated!, {
        lastResult: result,
        completed: { cycleNo: session.cycleNo, members: completed },
        message: {
          status: 'SUCCESS',
          text: `Putaran ${session.cycleNo} lengkap. Semua anggota boleh memulai putaran berikutnya.`,
        },
      });
    });
  }
}
