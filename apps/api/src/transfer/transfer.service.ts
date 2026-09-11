import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, desc, count, gte, lte, sql, type Database } from '@avicenna/db';
import { transfers, transferLines, mutations, parts, lots, lines, locations } from '@avicenna/db';
import { buildTransferNumber, productionDateKey } from '@avicenna/domain';
import type { TransferCreateInput, StockAvailability } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Stok yang tercatat untuk sebuah part, dirinci per lot.
   *
   * Dipakai layar transfer untuk menunjukkan apa yang tersedia SEBELUM
   * pengguna menekan simpan. Ini penting: sistem tidak menolak pemindahan yang
   * melebihi catatan (lihat create), jadi satu-satunya kesempatan orang
   * menyadari ada yang tidak beres adalah saat melihat angkanya di layar.
   */
  async availability(partId: number): Promise<StockAvailability> {
    const partRows = await this.db.select().from(parts).where(eq(parts.id, partId)).limit(1);
    const part = partRows[0];
    if (!part) throw new NotFoundException(`Part ${partId} tidak ditemukan`);

    const totalRows = await this.db
      .select({ value: sql<string>`COALESCE(SUM(${mutations.qty}), 0)` })
      .from(mutations)
      .where(eq(mutations.partId, partId));

    const lotRows = await this.db
      .select({
        lotId: lots.id,
        lotNumber: lots.lotNumber,
        supplierLotNumber: lots.supplierLotNumber,
        receivedAt: lots.receivedAt,
        createdAt: lots.createdAt,
        moved: sql<string>`COALESCE(SUM(${mutations.qty}), 0)`,
      })
      .from(lots)
      .leftJoin(mutations, eq(mutations.lotId, lots.id))
      .where(and(eq(lots.partId, partId), eq(lots.status, 'OPEN')))
      .groupBy(lots.id, lots.lotNumber, lots.supplierLotNumber, lots.receivedAt, lots.createdAt);

    return {
      partId: part.id,
      partNumber: part.partNumber,
      partName: part.name,
      uom: part.uom,
      trackingMode: part.trackingMode,
      total: Number(totalRows[0]?.value ?? 0),
      lots: lotRows
        // Saldo lot SELALU jumlah mutasinya, tidak pernah initialQty —
        // menjumlahkan keduanya menghitung barang yang sama dua kali.
        .map((l) => ({
          lotId: l.lotId,
          lotNumber: l.lotNumber,
          supplierLotNumber: l.supplierLotNumber,
          remaining: Number(l.moved),
          receivedAt: (l.receivedAt ?? l.createdAt)?.toISOString() ?? null,
        }))
        .filter((l) => l.remaining > 0)
        // FIFO: yang diterima lebih dulu ditawarkan lebih dulu.
        .sort((a, b) => (a.receivedAt ?? '').localeCompare(b.receivedAt ?? '')),
    };
  }

  /**
   * Mencatat satu pemindahan.
   *
   * Setiap baris menghasilkan DUA mutasi: keluar dari asal dan masuk ke tujuan.
   * Saldo pabrik tidak berubah — yang berpindah tempatnya.
   *
   * Pemindahan yang melebihi catatan stok TIDAK ditolak. Barangnya sudah
   * dipindahkan secara fisik; menolak mencatatnya tidak membuatnya kembali ke
   * tempat semula, dan hanya membuat catatan makin jauh dari kenyataan. Saldo
   * asal yang menjadi minus adalah sinyal bahwa ada penerimaan yang belum
   * dicatat atau ada salah hitung — dan sinyal itu justru yang dibutuhkan.
   */
  async create(input: TransferCreateInput, principal?: Principal) {
    const movedAt = input.movedAt ?? new Date();

    const partIds = [...new Set(input.lines.map((l) => l.partId))];
    const partRows = await this.db.select().from(parts).where(inIds(parts.id, partIds));
    const partById = new Map(partRows.map((p) => [p.id, p]));

    for (const line of input.lines) {
      const part = partById.get(line.partId);
      if (!part) throw new BadRequestException(`Part dengan id ${line.partId} tidak ditemukan`);
      if (part.plantId !== input.plantId) {
        throw new BadRequestException(
          `Part ${part.partNumber} terdaftar di pabrik lain. Pilih pabrik yang sesuai.`,
        );
      }
      // Part ber-lot tanpa lot membuat telusurnya putus di titik ini: barang
      // pindah tapi tidak diketahui lot mana yang pindah.
      if (part.trackingMode === 'LOT' && !line.lotId) {
        throw new BadRequestException(
          `Part ${part.partNumber} dilacak per lot — pilih lot yang dipindahkan.`,
        );
      }
    }

    const today = productionDateKey(movedAt);
    const seqBase = await this.countOn(input.plantId, today);

    return this.db.transaction(async (tx) => {
      const documentNumber = buildTransferNumber(movedAt, seqBase + 1);

      const inserted = await tx.insert(transfers).values({
        plantId: input.plantId,
        documentNumber,
        fromLineId: input.fromLineId ?? null,
        toLineId: input.toLineId ?? null,
        fromLocationId: input.fromLocationId ?? null,
        toLocationId: input.toLocationId ?? null,
        movedAt,
        status: 'MOVED',
        userId: principal?.kind === 'user' ? principal.sub : null,
        note: input.note ?? null,
      });
      const transferId = Number(
        (inserted as unknown as Array<{ insertId: number }>)[0]?.insertId,
      );

      for (const line of input.lines) {
        await tx.insert(transferLines).values({
          transferId,
          partId: line.partId,
          lotId: line.lotId ?? null,
          serialNumber: line.serialNumber ?? null,
          qty: String(line.qty),
        });

        const shared = {
          plantId: input.plantId,
          partId: line.partId,
          lotId: line.lotId ?? null,
          sourceTable: 'TT_GOODS_MOVEMENT_H' as const,
          sourceId: transferId,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          occurredAt: movedAt,
        };

        await tx.insert(mutations).values({
          ...shared,
          lineId: input.fromLineId ?? null,
          locationId: input.fromLocationId ?? null,
          type: 'TRANSFER_OUT',
          qty: String(-line.qty),
          note: `Pindah ke ${input.toLineId ? `line ${input.toLineId}` : `lokasi ${input.toLocationId}`}`,
        });

        await tx.insert(mutations).values({
          ...shared,
          lineId: input.toLineId ?? null,
          locationId: input.toLocationId ?? null,
          type: 'TRANSFER_IN',
          qty: String(line.qty),
          note: `Pindah dari ${input.fromLineId ? `line ${input.fromLineId}` : `lokasi ${input.fromLocationId}`}`,
        });
      }

      this.logger.log(`transfer ${documentNumber}: ${input.lines.length} baris`);
      return { id: transferId, documentNumber, lineCount: input.lines.length };
    });
  }

  private async countOn(plantId: number, date: string): Promise<number> {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59.999`);
    const rows = await this.db
      .select({ value: count() })
      .from(transfers)
      .where(
        and(
          eq(transfers.plantId, plantId),
          gte(transfers.movedAt, start),
          lte(transfers.movedAt, end),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async list(params: { page: number; perPage: number }) {
    const offset = (params.page - 1) * params.perPage;
    // Nama tabel ditulis langsung karena subquery berkorelasi belum bisa
    // dibentuk lewat pembangun query Drizzle. Ikut berubah bila tabelnya
    // diganti nama — tidak ada yang mengingatkan, jadi dicatat di sini.
    const fromLine = sql<string>`(SELECT l.NAME FROM TM_LINE l WHERE l.ID = ${transfers.fromLineId})`;
    const toLine = sql<string>`(SELECT l.NAME FROM TM_LINE l WHERE l.ID = ${transfers.toLineId})`;
    const fromLoc = sql<string>`(SELECT lo.NAME FROM TM_LOCATION lo WHERE lo.ID = ${transfers.fromLocationId})`;
    const toLoc = sql<string>`(SELECT lo.NAME FROM TM_LOCATION lo WHERE lo.ID = ${transfers.toLocationId})`;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: transfers.id,
          documentNumber: transfers.documentNumber,
          fromName: sql<string>`COALESCE(${fromLine}, ${fromLoc})`,
          toName: sql<string>`COALESCE(${toLine}, ${toLoc})`,
          movedAt: transfers.movedAt,
          status: transfers.status,
          lineCount: sql<number>`(SELECT COUNT(*) FROM TT_GOODS_MOVEMENT_L tl WHERE tl.TRANSFER_ID = ${transfers.id})`,
          totalQty: sql<string>`(SELECT COALESCE(SUM(tl.QTY), 0) FROM TT_GOODS_MOVEMENT_L tl WHERE tl.TRANSFER_ID = ${transfers.id})`,
        })
        .from(transfers)
        .orderBy(desc(transfers.movedAt))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(transfers),
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

  async findOne(id: number) {
    const rows = await this.db.select().from(transfers).where(eq(transfers.id, id)).limit(1);
    const transfer = rows[0];
    if (!transfer) throw new NotFoundException(`Transfer ${id} tidak ditemukan`);

    const [fromLine, toLine, fromLoc, toLoc] = await Promise.all([
      this.nameOfLine(transfer.fromLineId),
      this.nameOfLine(transfer.toLineId),
      this.nameOfLocation(transfer.fromLocationId),
      this.nameOfLocation(transfer.toLocationId),
    ]);

    const detail = await this.db
      .select({
        id: transferLines.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        uom: parts.uom,
        qty: transferLines.qty,
        serialNumber: transferLines.serialNumber,
        lotNumber: lots.lotNumber,
      })
      .from(transferLines)
      .leftJoin(parts, eq(transferLines.partId, parts.id))
      .leftJoin(lots, eq(transferLines.lotId, lots.id))
      .where(eq(transferLines.transferId, id));

    return {
      id: transfer.id,
      documentNumber: transfer.documentNumber,
      fromName: fromLine ?? fromLoc,
      toName: toLine ?? toLoc,
      movedAt: transfer.movedAt,
      status: transfer.status,
      note: transfer.note,
      lines: detail,
    };
  }

  private async nameOfLine(id: number | null) {
    if (!id) return null;
    const rows = await this.db.select({ name: lines.name }).from(lines).where(eq(lines.id, id)).limit(1);
    return rows[0]?.name ?? null;
  }

  private async nameOfLocation(id: number | null) {
    if (!id) return null;
    const rows = await this.db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    return rows[0]?.name ?? null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inIds(column: any, values: number[]) {
  if (values.length === 0) return sql`1 = 0`;
  return sql`${column} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}
