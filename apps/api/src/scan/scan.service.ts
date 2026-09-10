import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { eq, and, desc, type Database } from '@avicenna/db';
import { scanEvents, lines, parts, machines, mutations } from '@avicenna/db';
import { normalizeScan, parseBarcode, signedQty, productionDateKey } from '@avicenna/domain';
import type { ScanInput, ScanResult } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { RealtimeService } from '../realtime/realtime.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import type { Principal } from '../auth/auth.types';

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
  ): Promise<{ duplicated: boolean; partId?: number; productionDate: string }> {
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

    try {
      await this.db.insert(scanEvents).values({
        plantId,
        kind: normalized.kind,
        processType: normalized.processType ?? part?.processType ?? null,
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
    } catch (err) {
      if (isDuplicateKey(err)) {
        return { duplicated: true, productionDate: prodDate };
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
        type: 'PRODUCTION_IN',
        qty: signedQty('PRODUCTION_IN', parsed.qty ?? normalized.qty),
        sourceTable: 'scan_events',
        npk: normalized.npk ?? (principal?.kind === 'user' ? principal.npk : null),
        userId: principal?.kind === 'user' ? principal.sub : null,
        occurredAt: normalized.scannedAt,
      });
    }

    // Siaran ke dashboard bersifat tambahan. Kalau Redis sedang bermasalah,
    // layar monitor telat memperbarui — itu bisa diterima. Menggagalkan scan
    // yang datanya sudah tersimpan tidak bisa diterima, karena device akan
    // mengira scan-nya gagal dan operator akan men-scan ulang.
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

    return { duplicated: false, partId: part?.id, productionDate: prodDate };
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
