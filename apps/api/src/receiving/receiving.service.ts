import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, or, desc, count, gte, lte, sql, type Database } from '@avicenna/db';
import { receipts, receiptLines, lots, mutations, parts, suppliers, plants } from '@avicenna/db';
import { buildReceiptNumber, buildLotNumber, needsLot, productionDateKey } from '@avicenna/domain';
import type { ReceiptCreateInput, ResolvedPart } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

@Injectable()
export class ReceivingService {
  private readonly logger = new Logger(ReceivingService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Mencari part dari barcode yang discan di meja penerimaan.
   *
   * CATATAN: format barcode komponen beli belum terdokumentasi. Sementara ini
   * dicoba tiga cara — cocokkan seluruh isi barcode ke part number, lalu ke
   * back number, lalu ke ruas pertama bila barcode berpemisah. Begitu format
   * sebenarnya diketahui, ganti bagian ini saja.
   */
  async resolve(barcode: string): Promise<ResolvedPart> {
    const raw = barcode.trim();
    if (!raw) {
      return { found: false, message: 'Barcode kosong.' };
    }

    const firstSegment = raw.split('|')[0]?.trim() ?? raw;

    const rows = await this.db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.isActive, true),
          or(
            eq(parts.partNumber, raw),
            eq(parts.backNumber, raw),
            eq(parts.partNumber, firstSegment),
            eq(parts.backNumber, firstSegment),
          ),
        ),
      )
      .limit(1);

    const part = rows[0];
    if (!part) {
      return {
        found: false,
        message: `Part untuk barcode "${raw}" tidak ditemukan. Daftarkan dulu di Master Part.`,
      };
    }

    return {
      found: true,
      partId: part.id,
      partNumber: part.partNumber,
      backNumber: part.backNumber,
      name: part.name,
      uom: part.uom,
      trackingMode: part.trackingMode,
      partType: part.partType,
      message: 'OK',
    };
  }

  /**
   * Mencatat satu kedatangan.
   *
   * Seluruhnya dalam satu transaksi: dokumen, barisnya, lot yang terbentuk,
   * dan mutasi stoknya. Kalau ada satu saja yang gagal, tidak ada yang
   * tersimpan. Penerimaan setengah jadi — stok bertambah tapi dokumennya
   * hilang, atau sebaliknya — jauh lebih sulit dibereskan daripada penerimaan
   * yang gagal seluruhnya dan tinggal diulang.
   */
  async create(input: ReceiptCreateInput, principal?: Principal) {
    const receivedAt = input.receivedAt ?? new Date();

    const plantRows = await this.db
      .select()
      .from(plants)
      .where(eq(plants.id, input.plantId))
      .limit(1);
    if (!plantRows[0]) throw new BadRequestException('Pabrik tidak ditemukan');

    const supplierRows = await this.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId))
      .limit(1);
    if (!supplierRows[0]) throw new BadRequestException('Supplier tidak ditemukan');

    // Ambil seluruh part sekaligus, bukan satu per satu di dalam transaksi —
    // transaksi sebaiknya sesingkat mungkin agar tidak lama mengunci baris.
    const partIds = [...new Set(input.lines.map((l) => l.partId))];
    const partRows = await this.db
      .select()
      .from(parts)
      .where(inIds(parts.id, partIds));
    const partById = new Map(partRows.map((p) => [p.id, p]));

    for (const line of input.lines) {
      if (!partById.has(line.partId)) {
        throw new BadRequestException(`Part dengan id ${line.partId} tidak ditemukan`);
      }
    }

    const today = productionDateKey(receivedAt);
    const seqBase = await this.countReceiptsOn(input.plantId, today);

    return this.db.transaction(async (tx) => {
      const documentNumber = buildReceiptNumber(receivedAt, seqBase + 1);

      const inserted = await tx.insert(receipts).values({
        plantId: input.plantId,
        supplierId: input.supplierId,
        documentNumber,
        supplierDocNumber: input.supplierDocNumber ?? null,
        receivedAt,
        locationId: input.locationId ?? null,
        status: 'RECEIVED',
        receivedById: principal?.kind === 'user' ? principal.sub : null,
        note: input.note ?? null,
      });
      const receiptId = Number(
        (inserted as unknown as Array<{ insertId: number }>)[0]?.insertId,
      );

      let lotSeq = 0;

      for (const line of input.lines) {
        const part = partById.get(line.partId)!;
        let lotId: number | null = null;

        if (needsLot(part.trackingMode)) {
          lotSeq += 1;
          const lotNumber = buildLotNumber({
            partNumber: part.partNumber,
            supplierLotNumber: line.supplierLotNumber,
            at: receivedAt,
            sequenceToday: seqBase + lotSeq,
          });

          const lotInserted = await tx.insert(lots).values({
            plantId: input.plantId,
            partId: part.id,
            lotNumber,
            supplierLotNumber: line.supplierLotNumber ?? null,
            supplierId: input.supplierId,
            receivedAt,
            initialQty: String(line.qty),
            status: 'OPEN',
          });
          lotId = Number((lotInserted as unknown as Array<{ insertId: number }>)[0]?.insertId);
        }

        await tx.insert(receiptLines).values({
          receiptId,
          partId: part.id,
          lotId,
          qty: String(line.qty),
          uom: line.uom ?? part.uom,
        });

        /*
         * Mutasi stok. Bertanda positif — barang masuk.
         *
         * INI satu-satunya sumber saldo. `lots.initialQty` hanya catatan
         * berapa yang tertulis saat datang, dan tidak pernah ikut dijumlahkan
         * ke saldo — kalau ikut, barang yang sama terhitung dua kali.
         */
        await tx.insert(mutations).values({
          plantId: input.plantId,
          partId: part.id,
          locationId: input.locationId ?? null,
          lotId,
          type: 'RECEIVING_IN',
          qty: String(line.qty),
          sourceTable: 'receipts',
          sourceId: receiptId,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          occurredAt: receivedAt,
        });
      }

      this.logger.log(
        `penerimaan ${documentNumber}: ${input.lines.length} baris dari supplier ${supplierRows[0]!.code}`,
      );

      return { id: receiptId, documentNumber, lineCount: input.lines.length };
    });
  }

  /** Jumlah penerimaan pada tanggal tertentu, dipakai menomori dokumen. */
  private async countReceiptsOn(plantId: number, date: string): Promise<number> {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59.999`);
    const rows = await this.db
      .select({ value: count() })
      .from(receipts)
      .where(
        and(
          eq(receipts.plantId, plantId),
          gte(receipts.receivedAt, start),
          lte(receipts.receivedAt, end),
        ),
      );
    return rows[0]?.value ?? 0;
  }

  async list(params: { page: number; perPage: number }) {
    const offset = (params.page - 1) * params.perPage;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: receipts.id,
          documentNumber: receipts.documentNumber,
          supplierDocNumber: receipts.supplierDocNumber,
          supplierName: suppliers.name,
          receivedAt: receipts.receivedAt,
          status: receipts.status,
          lineCount: sql<number>`(SELECT COUNT(*) FROM receipt_lines rl WHERE rl.receipt_id = ${receipts.id})`,
          totalQty: sql<string>`(SELECT COALESCE(SUM(rl.qty), 0) FROM receipt_lines rl WHERE rl.receipt_id = ${receipts.id})`,
        })
        .from(receipts)
        .leftJoin(suppliers, eq(receipts.supplierId, suppliers.id))
        .orderBy(desc(receipts.receivedAt))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(receipts),
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
    const rows = await this.db
      .select({
        id: receipts.id,
        documentNumber: receipts.documentNumber,
        supplierDocNumber: receipts.supplierDocNumber,
        supplierName: suppliers.name,
        receivedAt: receipts.receivedAt,
        status: receipts.status,
        note: receipts.note,
      })
      .from(receipts)
      .leftJoin(suppliers, eq(receipts.supplierId, suppliers.id))
      .where(eq(receipts.id, id))
      .limit(1);

    const receipt = rows[0];
    if (!receipt) throw new NotFoundException(`Penerimaan ${id} tidak ditemukan`);

    const lines = await this.db
      .select({
        id: receiptLines.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        qty: receiptLines.qty,
        uom: receiptLines.uom,
        lotNumber: lots.lotNumber,
        supplierLotNumber: lots.supplierLotNumber,
      })
      .from(receiptLines)
      .leftJoin(parts, eq(receiptLines.partId, parts.id))
      .leftJoin(lots, eq(receiptLines.lotId, lots.id))
      .where(eq(receiptLines.receiptId, id));

    return { ...receipt, lines };
  }
}

/** Pembungkus kecil agar pemanggilan IN tetap terbaca di atas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inIds(column: any, values: number[]) {
  if (values.length === 0) return sql`1 = 0`;
  return sql`${column} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}
