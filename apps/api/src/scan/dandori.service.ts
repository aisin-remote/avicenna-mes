import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  ne,
  sql,
  type Database,
  dandori,
  lineStops,
  lines,
  moldScanSessions,
  partProcesses,
  parts,
  scanEvents,
  stopReasons,
  toolingParts,
  toolings,
} from '@avicenna/db';
import {
  bacaKodeDandori,
  bacaKodeSample,
  metodeDandori,
  normalkanNomorPart,
  pilihBarisRute,
  productionDateKey,
} from '@avicenna/domain';
import { modeScanBerlaku, type DandoriLini, type ScanMode } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';
import { ProcessTypeService } from '../master/process-type.service';

type Line = typeof lines.$inferSelect;
type Baris = typeof dandori.$inferSelect;

/**
 * Dandori — pergantian model di sebuah line.
 *
 * ── Alurnya ─────────────────────────────────────────────────────────────────
 *
 * 1. MP menekan DANDORI: dandori sebelumnya SELESAI, line tercatat berhenti
 *    dengan alasan DANDORI, dan scan produksi ditolak.
 * 2. MP men-scan kode dandorinya:
 *    - QR `DANDORI-<nomor part>` (UNIT dan line BODY per barang);
 *    - QR dandori lalu master sample part yang sama (BODY per kanban);
 *    - tag mold `MOLD-<id>` (injection) — satu mold berisi beberapa part.
 * 3. MP menekan START: berhentinya ditutup, dan sejak itu HANYA part (atau
 *    anggota mold) itu yang diterima scan produksi.
 *
 * Wajib di semua line kecuali yang ditandai Tanpa Dandori; line receiving tidak
 * memproduksi apa pun dan tidak pernah diminta. Keputusan Handika, 11 Nov 2026.
 *
 * ── Box yang masih terbuka ──────────────────────────────────────────────────
 *
 * Dandori ditolak selama box belum ditutup kanban. Part yang ditahan menunggu
 * kartu hanya ada di layar (belum tersimpan), jadi penjaganya di layar; putaran
 * anggota mold yang belum lengkap tersimpan di server dan dijaga di sini.
 */
@Injectable()
export class DandoriService {
  private readonly logger = new Logger(DandoriService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly processTypes: ProcessTypeService,
  ) {}

  private async line(lineCode: string): Promise<Line> {
    const [line] = await this.db.select().from(lines).where(eq(lines.code, lineCode)).limit(1);
    if (!line) throw new BadRequestException(`Line ${lineCode} tidak ditemukan.`);
    return line;
  }

  private async modeLine(line: Line): Promise<ScanMode> {
    return modeScanBerlaku(await this.processTypes.katalog(), {
      modeLini: line.scanMode,
      proses: line.processType,
    });
  }

  /** Apakah scan produksi di line ini menunggu dandori. */
  async wajib(line: Pick<Line, 'tanpaDandori' | 'processType'>): Promise<boolean> {
    if (line.tanpaDandori) return false;
    return (await this.processTypes.katalog()).grup(line.processType) !== 'RECEIVING';
  }

  /** Baris dandori yang belum selesai di sebuah line. */
  async terbuka(lineId: number): Promise<Baris | undefined> {
    const [baris] = await this.db
      .select()
      .from(dandori)
      .where(and(eq(dandori.lineId, lineId), ne(dandori.status, 'SELESAI')))
      .limit(1);
    return baris;
  }

  /** Part anggota mold — dipakai pemeriksaan scan di line mold. */
  async anggotaMold(toolingId: number): Promise<number[]> {
    const rows = await this.db
      .select({ partId: toolingParts.partId })
      .from(toolingParts)
      .where(eq(toolingParts.toolingId, toolingId));
    return rows.map((r) => r.partId);
  }

  /** Keadaan dandori untuk layar; null bila line belum pernah di-dandori. */
  async keadaan(line: Line): Promise<DandoriLini | null> {
    const baris = await this.terbuka(line.id);
    if (!baris) return null;
    return this.bentuk(line, baris);
  }

  private async bentuk(line: Line, baris: Baris): Promise<DandoriLini> {
    const metode = metodeDandori(await this.modeLine(line));
    const [part] = baris.partId
      ? await this.db.select().from(parts).where(eq(parts.id, baris.partId)).limit(1)
      : [];
    const [mold] = baris.toolingId
      ? await this.db
          .select({ id: toolings.id, code: toolings.code, name: toolings.name })
          .from(toolings)
          .where(eq(toolings.id, baris.toolingId))
          .limit(1)
      : [];

    let scanMode: ScanMode | null = null;
    if (part) {
      const rute = await this.db
        .select()
        .from(partProcesses)
        .where(and(eq(partProcesses.partId, part.id), eq(partProcesses.isActive, true)));
      const barisRute = pilihBarisRute(rute, line.id, line.processType);
      scanMode = modeScanBerlaku(await this.processTypes.katalog(), {
        modeLini: barisRute?.scanMode ?? line.scanMode,
        proses: barisRute?.processType ?? line.processType,
      });
    } else if (mold) {
      scanMode = 'KANBAN_MOLD';
    }

    const sampleOk = metode !== 'PART_SAMPLE' || Boolean(part && baris.kodeSample);
    return {
      id: baris.id,
      status: baris.status === 'BERJALAN' ? 'BERJALAN' : 'DANDORI',
      metode,
      part: part
        ? {
            id: part.id,
            partNumber: part.partNumber,
            backNumber: part.backNumber ?? null,
            name: part.name,
            qtyPerKanban: part.qtyPerKanban ?? null,
            photoPath: part.photoPath ?? null,
          }
        : null,
      scanMode,
      mold: mold ? { ...mold, jumlahAnggota: (await this.anggotaMold(mold.id)).length } : null,
      sampleOk,
      siapStart: (metode === 'MOLD' ? Boolean(mold) : Boolean(part)) && sampleOk,
      mulaiAt: baris.mulaiAt.toISOString(),
      startAt: baris.startAt ? baris.startAt.toISOString() : null,
    };
  }

  /** Alasan berhenti DANDORI pabrik ini (kategori CHANGEOVER). */
  private async alasanDandori(plantId: number): Promise<number | null> {
    const daftar = await this.db
      .select({ id: stopReasons.id, name: stopReasons.name })
      .from(stopReasons)
      .where(
        and(
          eq(stopReasons.plantId, plantId),
          eq(stopReasons.category, 'CHANGEOVER'),
          eq(stopReasons.isActive, true),
        ),
      )
      .orderBy(asc(stopReasons.sortOrder));
    return (daftar.find((a) => /dandori/i.test(a.name)) ?? daftar[0])?.id ?? null;
  }

  /** MP menekan DANDORI. */
  async mulai(lineCode: string, principal?: Principal): Promise<DandoriLini> {
    const line = await this.line(lineCode);
    if (!(await this.wajib(line))) {
      throw new BadRequestException(`Line ${line.code} ditandai tanpa dandori.`);
    }
    const lama = await this.terbuka(line.id);
    if (lama?.status === 'DANDORI') return this.bentuk(line, lama);

    if (metodeDandori(await this.modeLine(line)) === 'MOLD') {
      const [sesi] = await this.db
        .select({ scanned: moldScanSessions.scanned })
        .from(moldScanSessions)
        .where(eq(moldScanSessions.lineId, line.id))
        .limit(1);
      if ((sesi?.scanned ?? []).length > 0) {
        throw new BadRequestException(
          'Putaran anggota mold belum lengkap. Selesaikan kanban anggotanya dulu, baru dandori.',
        );
      }
    }

    const sekarang = new Date();
    const userId = principal?.kind === 'user' ? principal.sub : null;
    const alasan = await this.alasanDandori(line.plantId);
    const [terakhir] = await this.db
      .select({ partId: scanEvents.partId })
      .from(scanEvents)
      .where(eq(scanEvents.lineId, line.id))
      .orderBy(desc(scanEvents.scannedAt))
      .limit(1);

    const id = await this.db.transaction(async (tx) => {
      if (lama) {
        await tx
          .update(dandori)
          .set({ status: 'SELESAI', selesaiAt: sekarang, updatedAt: sekarang })
          .where(eq(dandori.id, lama.id));
      }
      // Berhenti lain yang masih terbuka diakhiri: sejak tombol ini, line berhenti karena dandori.
      await tx
        .update(lineStops)
        .set({ endedAt: sekarang, closedBy: 'SISTEM' })
        .where(and(eq(lineStops.lineId, line.id), isNull(lineStops.endedAt)));
      const [berhenti] = await tx
        .insert(lineStops)
        .values({
          plantId: line.plantId,
          lineId: line.id,
          partId: lama?.partId ?? terakhir?.partId ?? null,
          reasonId: alasan,
          productionDate: productionDateKey(sekarang),
          startedAt: sekarang,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId,
          note: 'DANDORI',
        })
        .returning({ id: lineStops.id });
      const [baru] = await tx
        .insert(dandori)
        .values({
          plantId: line.plantId,
          lineId: line.id,
          status: 'DANDORI',
          lineStopId: berhenti!.id,
          mulaiAt: sekarang,
          userMulaiId: userId,
        })
        .returning({ id: dandori.id });
      return baru!.id;
    });

    this.logger.log(`line ${line.code} mulai dandori`);
    const [baris] = await this.db.select().from(dandori).where(eq(dandori.id, id)).limit(1);
    return this.bentuk(line, baris!);
  }

  private async partDiPabrik(nomor: string, plantId: number) {
    const [part] = await this.db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.plantId, plantId),
          eq(parts.isActive, true),
          eq(
            sql`replace(replace(upper(${parts.partNumber}), '-', ''), ' ', '')`,
            normalkanNomorPart(nomor).replace(/\s+/g, ''),
          ),
        ),
      )
      .limit(1);
    return part;
  }

  /** Tag mold: kodenya sendiri, atau sesudah awalan `MOLD-`, `MOLD:`, `MOLD|`. */
  private async moldDari(raw: string, plantId: number) {
    const teks = raw.trim();
    const calon = [teks, teks.replace(/^MOLD\s*[-:|]\s*/i, '')].map((c) => c.toUpperCase());
    for (const kode of new Set(calon)) {
      if (!kode) continue;
      const [mold] = await this.db
        .select()
        .from(toolings)
        .where(
          and(
            eq(toolings.plantId, plantId),
            eq(toolings.kind, 'MOLD'),
            eq(toolings.isActive, true),
            sql`upper(${toolings.code}) = ${kode}`,
          ),
        )
        .limit(1);
      if (mold) return mold;
    }
    return undefined;
  }

  /** QR dandori, master sample, atau tag mold yang discan selama dandori. */
  async kode(lineCode: string, code: string): Promise<DandoriLini> {
    const line = await this.line(lineCode);
    const baris = await this.terbuka(line.id);
    if (baris?.status !== 'DANDORI') {
      throw new BadRequestException('Tekan tombol DANDORI dulu, baru scan kode dandori.');
    }
    const metode = metodeDandori(await this.modeLine(line));
    const raw = code.trim();
    const sekarang = new Date();

    if (metode === 'MOLD') {
      const mold = await this.moldDari(raw, line.plantId);
      if (!mold) {
        throw new BadRequestException(`"${raw}" bukan tag mold terdaftar di pabrik ini.`);
      }
      if ((await this.anggotaMold(mold.id)).length === 0) {
        throw new BadRequestException(
          `Mold ${mold.code} belum memiliki part anggota. Isi Master Data › Anggota Tooling.`,
        );
      }
      await this.db
        .update(dandori)
        .set({ toolingId: mold.id, kodeDandori: raw.slice(0, 255), updatedAt: sekarang })
        .where(eq(dandori.id, baris.id));
      return this.keadaanWajib(line);
    }

    const nomor = bacaKodeDandori(raw);
    if (nomor) {
      const part = await this.partDiPabrik(nomor, line.plantId);
      if (!part) {
        throw new BadRequestException(
          `Part ${nomor} dari QR dandori tidak ada di master pabrik ini.`,
        );
      }
      const rute = await this.db
        .select()
        .from(partProcesses)
        .where(and(eq(partProcesses.partId, part.id), eq(partProcesses.isActive, true)));
      if (!pilihBarisRute(rute, line.id, line.processType)) {
        throw new BadRequestException(
          `${part.partNumber} tidak terdaftar di work center ${line.code}. ` +
            'Daftarkan di Master Data › Rute Part, atau periksa QR dandorinya.',
        );
      }
      await this.db
        .update(dandori)
        .set({
          partId: part.id,
          kodeDandori: raw.slice(0, 255),
          kodeSample: null,
          updatedAt: sekarang,
        })
        .where(eq(dandori.id, baris.id));
      return this.keadaanWajib(line);
    }

    if (metode === 'PART_SAMPLE') {
      if (!baris.partId) {
        throw new BadRequestException(
          'Scan QR dandori dulu (DANDORI-<nomor part>), baru master sample.',
        );
      }
      // Label sample BODY: `MODEL-<nomor part>`; nomor polos juga diterima.
      const sample = await this.partDiPabrik(bacaKodeSample(raw), line.plantId);
      if (!sample || sample.id !== baris.partId) {
        const [dipasang] = await this.db
          .select({ partNumber: parts.partNumber })
          .from(parts)
          .where(eq(parts.id, baris.partId))
          .limit(1);
        throw new BadRequestException(
          `Master sample ${raw} tidak sama dengan part dandori ${dipasang?.partNumber ?? ''}.`,
        );
      }
      await this.db
        .update(dandori)
        .set({ kodeSample: raw.slice(0, 255), updatedAt: sekarang })
        .where(eq(dandori.id, baris.id));
      return this.keadaanWajib(line);
    }

    throw new BadRequestException('Scan QR dandori: DANDORI-<nomor part>.');
  }

  /** MP menekan START. */
  async start(lineCode: string, principal?: Principal): Promise<DandoriLini> {
    const line = await this.line(lineCode);
    const baris = await this.terbuka(line.id);
    if (baris?.status !== 'DANDORI') {
      throw new BadRequestException('Tidak ada dandori yang sedang berlangsung di line ini.');
    }
    const keadaan = await this.bentuk(line, baris);
    if (!keadaan.siapStart) {
      throw new BadRequestException(
        keadaan.metode === 'MOLD'
          ? 'Scan tag mold dulu.'
          : !keadaan.part
            ? 'Scan QR dandori dulu.'
            : 'Scan master sample dulu.',
      );
    }

    const sekarang = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(dandori)
        .set({
          status: 'BERJALAN',
          startAt: sekarang,
          userStartId: principal?.kind === 'user' ? principal.sub : null,
          updatedAt: sekarang,
        })
        .where(eq(dandori.id, baris.id));
      if (baris.lineStopId) {
        await tx
          .update(lineStops)
          .set({ endedAt: sekarang, closedBy: 'TOMBOL', partId: baris.partId })
          .where(and(eq(lineStops.id, baris.lineStopId), isNull(lineStops.endedAt)));
      }
    });
    this.logger.log(
      `line ${line.code} START ${keadaan.part?.partNumber ?? keadaan.mold?.code ?? ''}`,
    );
    return this.keadaanWajib(line);
  }

  private async keadaanWajib(line: Line): Promise<DandoriLini> {
    const k = await this.keadaan(line);
    if (!k) throw new BadRequestException('Dandori tidak ditemukan.');
    return k;
  }
}
