import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { eq, and, desc, gte, lte, count, type Database } from '@avicenna/db';
import { scanEvents, lines, parts, machines, mutations, plants } from '@avicenna/db';
import {
  normalizeScan,
  parseBarcode,
  signedQty,
  productionDateKey,
  requiredPreviousProcess,
  programCodeOf,
  REJECT_MESSAGES,
  type ScanRejectReason,
} from '@avicenna/domain';
import type { ScanInput, ScanResult, StationResult } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { RealtimeService } from '../realtime/realtime.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import type { Principal } from '../auth/auth.types';

/**
 * Penolakan scan yang punya alasan jelas, bukan kegagalan teknis.
 *
 * Dibedakan dari Error biasa supaya layar operator bisa menampilkan pesan yang
 * tepat beserta warnanya, bukan "terjadi kesalahan pada server".
 */
export class ScanRejected extends Error {
  constructor(
    readonly reason: ScanRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'ScanRejected';
  }
}

/** MySQL: pelanggaran UNIQUE index. */
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';
const ER_DUP_ENTRY_ERRNO = 1062;

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly realtime: RealtimeService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Menerima sekumpulan scan dari lapangan.
   *
   * Perilaku yang dijaga di sini:
   *  1. Idempoten — kiriman ulang menghasilkan `duplicated`, bukan error dan
   *     bukan baris dobel. Yang menegakkan ini adalah UNIQUE index pada
   *     dedupe_key, sehingga tetap benar walau dua request datang bersamaan.
   *  2. Satu scan gagal tidak menjatuhkan seluruh batch — device offline bisa
   *     mengirim 500 scan sekaligus dan yang bermasalah dilaporkan per item.
   *  3. Pekerjaan susulan (hitung ulang saldo) masuk antrean, tidak dikerjakan
   *     di dalam request.
   */
  async ingest(inputs: ScanInput[], principal?: Principal): Promise<ScanResult> {
    const result: ScanResult = { accepted: 0, duplicated: 0, rejected: [] };
    const touched = new Set<string>();

    for (const [index, input] of inputs.entries()) {
      try {
        const outcome = await this.ingestOne(input, principal);
        if (outcome.duplicated) {
          result.duplicated += 1;
        } else {
          result.accepted += 1;
          if (outcome.partId) {
            touched.add(`${outcome.partId}|${outcome.productionDate}`);
          }
        }
      } catch (err) {
        result.rejected.push({
          index,
          reason: err instanceof Error ? err.message : 'Kesalahan tidak diketahui',
        });
        this.logger.warn(`scan index ${index} ditolak: ${String(err)}`);
      }
    }

    // Hitung ulang saldo sekali per (part, tanggal), bukan sekali per scan.
    //
    // Kegagalan memasukkan job TIDAK menggagalkan scan: datanya sudah tersimpan
    // di scan_events dan mutations, dan saldo selalu bisa dibangun ulang dari
    // ledger. Scan yang hilang tidak bisa dipulihkan — job yang hilang bisa.
    // Karena itu Redis yang sedang mati hanya dicatat, bukan dilempar ke device.
    for (const key of touched) {
      const [partId, date] = key.split('|');
      try {
        await this.queue.add(QUEUES.STOCK, JOBS.RECALC_STOCK_BALANCE, {
          partId: Number(partId),
          date,
        });
      } catch (err) {
        this.logger.error(
          `gagal menjadwalkan hitung ulang saldo part=${partId} tgl=${date}: ${String(err)}. ` +
            'Jalankan ulang lewat job RECALC_STOCK_BALANCE setelah Redis pulih.',
        );
      }
    }

    return result;
  }

  private async ingestOne(
    input: ScanInput,
    principal?: Principal,
  ): Promise<{ duplicated: boolean; partId?: number; productionDate: string; qty: number }> {
    const normalized = normalizeScan(input);
    const parsed = parseBarcode(normalized.rawCode);

    const line = normalized.lineCode ? await this.findLine(normalized.lineCode) : undefined;
    if (normalized.lineCode && !line) {
      throw new BadRequestException(`Line ${normalized.lineCode} tidak ditemukan`);
    }

    const part = await this.resolvePart(parsed.partNumber, parsed.backNumber, line?.plantId);
    const machine = normalized.machineCode
      ? await this.findMachine(normalized.machineCode)
      : undefined;

    const plantId = line?.plantId ?? part?.plantId ?? (principal?.plantId ?? undefined);
    if (!plantId) {
      throw new BadRequestException(
        'Pabrik tidak bisa ditentukan dari scan ini (line, part, maupun token tidak menyebutkannya)',
      );
    }

    const prodDate = productionDateKey(normalized.scannedAt);
    const processType = normalized.processType ?? part?.processType ?? line?.processType ?? null;

    /*
     * Pemeriksaan rantai proses.
     *
     * Diambil dari perilaku avicenna: getAjaxmachining() menolak barcode yang
     * belum pernah discan di casting. Aturannya sekarang ada di
     * @avicenna/domain dan bisa ditest tanpa database.
     */
    if (processType) {
      const previous = requiredPreviousProcess(processType);
      if (previous) {
        const seenBefore = await this.db
          .select({ id: scanEvents.id })
          .from(scanEvents)
          .where(
            and(
              eq(scanEvents.rawCode, normalized.rawCode),
              eq(scanEvents.processType, previous),
            ),
          )
          .limit(1);

        if (seenBefore.length === 0) {
          throw new ScanRejected(
            'MISSING_PREVIOUS_PROCESS',
            `${REJECT_MESSAGES.MISSING_PREVIOUS_PROCESS} (belum ada scan ${previous})`,
          );
        }
      }
    }

    let insertedId: number | undefined;

    try {
      const inserted = await this.db.insert(scanEvents).values({
        plantId,
        kind: normalized.kind,
        processType,
        lineId: line?.id ?? null,
        partId: part?.id ?? null,
        machineId: machine?.id ?? null,
        rawCode: normalized.rawCode,
        serialNumber: parsed.serialNumber ?? null,
        qty: parsed.qty ?? normalized.qty,
        userId: principal?.kind === 'user' ? principal.sub : null,
        deviceId: principal?.kind === 'device' ? principal.sub : null,
        scannedAt: normalized.scannedAt,
        dedupeKey: normalized.dedupeKey,
        meta: normalized.meta ?? null,
      });
      // mysql2 mengembalikan insertId pada elemen pertama hasil insert.
      insertedId = Number((inserted as unknown as Array<{ insertId: number }>)[0]?.insertId);
    } catch (err) {
      if (isDuplicateKey(err)) {
        return { duplicated: true, productionDate: prodDate, qty: 0 };
      }
      throw err;
    }

    // Scan produksi menambah stok; jenis scan lain belum menulis mutasi
    // sampai aturannya dikonfirmasi tim produksi.
    if (normalized.kind === 'PRODUCTION' && part) {
      await this.db.insert(mutations).values({
        plantId,
        partId: part.id,
        lineId: line?.id ?? null,
        // SLOC tujuan line ini — barang jadi masuk ke gudang finish good.
        // Pasangannya (keluar dari gudang WIP) ditulis backflush.
        locationId: line?.outputLocationId ?? null,
        type: 'PRODUCTION_IN',
        qty: String(signedQty('PRODUCTION_IN', parsed.qty ?? normalized.qty)),
        sourceTable: 'TT_HISTORY_SCAN',
        // Tanpa sourceId, mutasi ini tidak bisa ditelusuri balik ke scan-nya —
        // sourceTable saja tidak menunjuk baris mana pun.
        sourceId: insertedId,
        npk: normalized.npk ?? (principal?.kind === 'user' ? principal.npk : null),
        userId: principal?.kind === 'user' ? principal.sub : null,
        occurredAt: normalized.scannedAt,
      });
    }

    // Siaran ke dashboard bersifat tambahan. Kalau Redis sedang bermasalah,
    // layar monitor telat memperbarui — itu bisa diterima. Menggagalkan scan
    // yang datanya sudah tersimpan tidak bisa diterima, karena device akan
    // mengira scan-nya gagal dan operator akan men-scan ulang.
    /*
     * Backflush: komponen berkurang otomatis mengikuti BOM.
     *
     * Dijadwalkan, tidak dikerjakan di sini. Operator tidak boleh menunggu
     * perhitungan material, dan kegagalannya tidak boleh menggagalkan
     * pencatatan produksi yang barangnya sudah terlanjur jadi.
     */
    if (insertedId && normalized.kind === 'PRODUCTION') {
      try {
        await this.queue.add(QUEUES.STOCK, JOBS.BACKFLUSH_CONSUMPTION, {
          scanEventId: insertedId,
        });
      } catch (err) {
        this.logger.error(
          `gagal menjadwalkan backflush untuk scan ${insertedId}: ${String(err)}. ` +
            'Jalankan ulang job BACKFLUSH_CONSUMPTION setelah antrean pulih.',
        );
      }
    }

    if (line) {
      try {
        await this.realtime.publish(`line:${line.code}`, 'scan', {
          kind: normalized.kind,
          partNumber: part?.partNumber ?? parsed.partNumber ?? null,
          serialNumber: parsed.serialNumber ?? null,
          qty: parsed.qty ?? normalized.qty,
          scannedAt: normalized.scannedAt.toISOString(),
        });
      } catch (err) {
        this.logger.warn(`gagal menyiarkan scan ke line:${line.code}: ${String(err)}`);
      }
    }

    return {
      duplicated: false,
      partId: part?.id,
      productionDate: prodDate,
      qty: parsed.qty ?? normalized.qty,
    };
  }

  private async findLine(code: string) {
    const rows = await this.db.select().from(lines).where(eq(lines.code, code)).limit(1);
    return rows[0];
  }

  private async findMachine(code: string) {
    const rows = await this.db.select().from(machines).where(eq(machines.code, code)).limit(1);
    return rows[0];
  }

  /** Mencari part lewat part number, lalu jatuh ke back number. */
  private async resolvePart(partNumber?: string, backNumber?: string, plantId?: number) {
    if (partNumber) {
      const byPartNumber = await this.db
        .select()
        .from(parts)
        .where(
          plantId
            ? and(eq(parts.partNumber, partNumber), eq(parts.plantId, plantId))
            : eq(parts.partNumber, partNumber),
        )
        .limit(1);
      if (byPartNumber[0]) return byPartNumber[0];
    }

    if (backNumber) {
      const byBackNumber = await this.db
        .select()
        .from(parts)
        .where(
          plantId
            ? and(eq(parts.backNumber, backNumber), eq(parts.plantId, plantId))
            : eq(parts.backNumber, backNumber),
        )
        .limit(1);
      if (byBackNumber[0]) return byBackNumber[0];
    }

    return undefined;
  }

  /**
   * Satu scan dari layar stasiun operator.
   *
   * Berbeda dari ingest() yang melayani device dan mengembalikan ringkasan
   * batch, method ini mengembalikan satu hasil yang lengkap: status, pesan
   * untuk ditampilkan besar di layar, identitas part, dan penghitung hari ini.
   * Layar operator butuh semuanya sekaligus — satu panggilan, satu jawaban.
   */
  async station(input: ScanInput, principal?: Principal): Promise<StationResult> {
    const now = new Date();

    if (!programCodeOf(input.rawCode)) {
      return this.stationReject(input, 'UNKNOWN_PROGRAM', now);
    }

    /*
     * Pemeriksaan duplikat sebagai ATURAN BISNIS.
     *
     * Ini berbeda dari idempotensi request. dedupe_key mencegah satu kiriman
     * yang sama diproses dua kali (device mengulang saat jaringan tersendat),
     * sedangkan yang dimaksud di sini adalah: barcode ini SUDAH PERNAH discan
     * di proses ini, sekalipun oleh orang lain, hari lain, dan request yang
     * sama sekali berbeda.
     *
     * Avicenna melakukannya dengan `where('code', $number)` pada tabel proses
     * masing-masing. Di skema terpadu, padanannya adalah scan_events yang
     * disaring menurut processType.
     */
    const processType = await this.processTypeFor(input);
    if (processType) {
      const already = await this.db
        .select({ id: scanEvents.id })
        .from(scanEvents)
        .where(
          and(eq(scanEvents.rawCode, input.rawCode), eq(scanEvents.processType, processType)),
        )
        .limit(1);

      if (already.length > 0) {
        return {
          status: 'DUPLICATE',
          reason: 'DUPLICATE',
          message: REJECT_MESSAGES.DUPLICATE,
          rawCode: input.rawCode,
          partNumber: null,
          partName: null,
          qty: 0,
          counterToday: await this.countToday(input.lineCode),
          scannedAt: now.toISOString(),
        };
      }
    }

    try {
      const outcome = await this.ingestOne(input, principal);

      if (outcome.duplicated) {
        return {
          status: 'DUPLICATE',
          reason: 'DUPLICATE',
          message: REJECT_MESSAGES.DUPLICATE,
          rawCode: input.rawCode,
          partNumber: null,
          partName: null,
          qty: 0,
          counterToday: await this.countToday(input.lineCode),
          scannedAt: now.toISOString(),
        };
      }

      // Hitung ulang saldo di luar request; kegagalan tidak menggagalkan scan.
      if (outcome.partId) {
        try {
          await this.queue.add(QUEUES.STOCK, JOBS.RECALC_STOCK_BALANCE, {
            partId: outcome.partId,
            date: outcome.productionDate,
          });
        } catch (err) {
          this.logger.error(`gagal menjadwalkan hitung ulang saldo: ${String(err)}`);
        }
      }

      const part = outcome.partId ? await this.partById(outcome.partId) : undefined;

      return {
        status: 'ACCEPTED',
        message: 'OK',
        rawCode: input.rawCode,
        partNumber: part?.partNumber ?? null,
        partName: part?.name ?? null,
        qty: outcome.qty,
        counterToday: await this.countToday(input.lineCode),
        scannedAt: now.toISOString(),
      };
    } catch (err) {
      if (err instanceof ScanRejected) {
        return this.stationReject(input, err.reason, now, err.message);
      }
      if (err instanceof BadRequestException) {
        const msg = (err.getResponse() as { message?: string })?.message ?? err.message;
        return this.stationReject(input, 'LINE_NOT_FOUND', now, msg);
      }
      throw err;
    }
  }

  private async stationReject(
    input: ScanInput,
    reason: ScanRejectReason,
    at: Date,
    message?: string,
  ): Promise<StationResult> {
    return {
      status: 'REJECTED',
      reason,
      message: message ?? REJECT_MESSAGES[reason],
      rawCode: input.rawCode,
      partNumber: null,
      partName: null,
      qty: 0,
      counterToday: await this.countToday(input.lineCode),
      scannedAt: at.toISOString(),
    };
  }

  /** Jenis proses yang berlaku untuk scan ini: dari input, atau dari line-nya. */
  private async processTypeFor(input: ScanInput) {
    if (input.processType) return input.processType;
    if (!input.lineCode) return undefined;
    const line = await this.findLine(input.lineCode);
    return line?.processType;
  }

  private async partById(id: number) {
    const rows = await this.db.select().from(parts).where(eq(parts.id, id)).limit(1);
    return rows[0];
  }

  /** Jumlah scan yang diterima hari ini pada satu line. */
  private async countToday(lineCode?: string | null): Promise<number> {
    if (!lineCode) return 0;
    const line = await this.findLine(lineCode);
    if (!line) return 0;

    const today = productionDateKey(new Date());
    const start = new Date(`${today}T00:00:00`);
    const end = new Date(`${today}T23:59:59.999`);

    const rows = await this.db
      .select({ value: count() })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.lineId, line.id),
          gte(scanEvents.scannedAt, start),
          lte(scanEvents.scannedAt, end),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  /** Ringkasan untuk layar stasiun: identitas line, hitungan hari ini, scan terakhir. */
  async summary(lineCode: string, limit = 10) {
    const line = await this.findLine(lineCode);
    if (!line) throw new BadRequestException(`Line ${lineCode} tidak ditemukan`);

    const plantRows = await this.db
      .select()
      .from(plants)
      .where(eq(plants.id, line.plantId))
      .limit(1);

    return {
      line: {
        code: line.code,
        name: line.name,
        processType: line.processType,
        plantCode: plantRows[0]?.code ?? null,
        plantName: plantRows[0]?.name ?? null,
      },
      counterToday: await this.countToday(lineCode),
      recent: await this.recent(lineCode, limit),
    };
  }

  /** Riwayat scan terbaru — dipakai layar operator untuk konfirmasi visual. */
  async recent(lineCode: string, limit = 50) {
    const line = await this.findLine(lineCode);
    if (!line) throw new BadRequestException(`Line ${lineCode} tidak ditemukan`);

    return this.db
      .select({
        id: scanEvents.id,
        kind: scanEvents.kind,
        rawCode: scanEvents.rawCode,
        serialNumber: scanEvents.serialNumber,
        qty: scanEvents.qty,
        scannedAt: scanEvents.scannedAt,
        partNumber: parts.partNumber,
        partName: parts.name,
      })
      .from(scanEvents)
      .leftJoin(parts, eq(scanEvents.partId, parts.id))
      .where(eq(scanEvents.lineId, line.id))
      .orderBy(desc(scanEvents.scannedAt))
      .limit(Math.min(limit, 200));
  }
}

/**
 * Mendeteksi pelanggaran UNIQUE index.
 *
 * Drizzle membungkus error dari driver, sehingga `code` milik mysql2 tidak ada
 * di objek terluar melainkan di rantai `cause`. Memeriksa objek terluar saja
 * membuat scan kiriman ulang dilaporkan sebagai error, bukan sebagai duplikat —
 * dan device akan terus mencoba mengirim ulang selamanya.
 */
function isDuplicateKey(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      const e = current as { code?: string; errno?: number; cause?: unknown };
      if (e.code === ER_DUP_ENTRY || e.errno === ER_DUP_ENTRY_ERRNO) return true;
      current = e.cause;
    } else {
      return false;
    }
  }
  return false;
}
