import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { eq, and, or, desc, count, gte, lte, sql, type Database } from '@avicenna/db';
import { receipts, receiptLines, lots, mutations, parts, suppliers, plants } from '@avicenna/db';
import { buildReceiptNumber, buildLotNumber, needsLot, productionDateKey } from '@avicenna/domain';
import type { ReceiptCreateInput, ReceiptUpdateInput, ResolvedPart } from '@avicenna/contracts';
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
   * Mencari banyak part sekaligus dari daftar part number.
   *
   * Dipakai saat impor tempelan: menembak satu per satu untuk ratusan baris
   * akan menghasilkan ratusan query, dan layar terasa menggantung.
   */
  async resolveBulk(partNumbers: string[]): Promise<Map<string, ResolvedPart>> {
    const unique = [...new Set(partNumbers.map((p) => p.trim()).filter(Boolean))];
    const out = new Map<string, ResolvedPart>();
    if (unique.length === 0) return out;

    const rows = await this.db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.isActive, true),
          or(inTexts(parts.partNumber, unique), inTexts(parts.backNumber, unique)),
        ),
      );

    // Satu part bisa cocok lewat part number maupun back number; keduanya
    // dipetakan supaya tempelan yang memakai salah satunya tetap ketemu.
    for (const part of rows) {
      const entry: ResolvedPart = {
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
      out.set(part.partNumber, entry);
      if (part.backNumber) out.set(part.backNumber, entry);
    }

    for (const code of unique) {
      if (!out.has(code)) {
        out.set(code, {
          found: false,
          message: `Part "${code}" tidak ditemukan di master.`,
        });
      }
    }

    return out;
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
      const part = partById.get(line.partId);
      if (!part) {
        throw new BadRequestException(`Part dengan id ${line.partId} tidak ditemukan`);
      }
      // Menerima part milik pabrik lain akan membuat stoknya tercatat di tempat
      // yang salah, dan baru ketahuan saat barangnya dicari dan tidak ada.
      if (part.plantId !== input.plantId) {
        throw new BadRequestException(
          `Part ${part.partNumber} terdaftar di pabrik lain. Pilih pabrik yang sesuai atau perbaiki datanya di Master Part.`,
        );
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

          /*
           * Lot dengan nomor yang sama DIPAKAI ULANG, bukan dibuat baru.
           *
           * Satu lot dari supplier sering datang bertahap — sebagian hari ini,
           * sisanya besok. Secara fisik itu tetap satu lot yang sama, jadi
           * ketertelusurannya harus menunjuk ke lot yang sama pula.
           *
           * Sebelum diperbaiki, kedatangan kedua menabrak unique index dan
           * seluruh penerimaan gagal dengan "Terjadi kesalahan pada server" —
           * tanpa petunjuk apa pun bagi orang di gudang.
           */
          const existingLot = await tx
            .select()
            .from(lots)
            .where(and(eq(lots.plantId, input.plantId), eq(lots.lotNumber, lotNumber)))
            .limit(1);

          if (existingLot[0]) {
            lotId = existingLot[0].id;
            // initialQty adalah catatan total yang tertulis untuk lot ini.
            await tx
              .update(lots)
              .set({ initialQty: String(Number(existingLot[0].initialQty) + line.qty) })
              .where(eq(lots.id, lotId));
          } else {
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

  /**
   * Mengubah penerimaan yang sudah tercatat.
   *
   * Penerimaan yang sudah masuk SUDAH mengubah stok. Karena itu perubahannya
   * dicatat sebagai KOREKSI — mutasi baru sebesar selisihnya — bukan dengan
   * menimpa mutasi lama.
   *
   * Alasannya bukan kerapian: buku besar yang bisa diubah surut membuat
   * pertanyaan "kenapa stok bulan lalu berbeda dari laporan yang sudah
   * dicetak" tidak bisa dijawab. Dengan koreksi, riwayatnya tetap utuh dan
   * selisihnya justru terlihat.
   *
   *   jumlah bertambah  -> mutasi ADJUSTMENT positif
   *   jumlah berkurang  -> mutasi ADJUSTMENT negatif
   *   baris dihapus     -> mutasi ADJUSTMENT sebesar minus seluruh jumlahnya
   *   baris ditambah    -> lot baru bila perlu + mutasi RECEIVING_IN
   */
  async update(id: number, input: ReceiptUpdateInput, principal?: Principal) {
    const existing = await this.db
      .select()
      .from(receipts)
      .where(eq(receipts.id, id))
      .limit(1);
    const receipt = existing[0];
    if (!receipt) throw new NotFoundException(`Penerimaan ${id} tidak ditemukan`);
    if (receipt.status === 'CANCELLED') {
      throw new BadRequestException('Penerimaan yang sudah dibatalkan tidak bisa diubah');
    }

    const currentLines = await this.db
      .select()
      .from(receiptLines)
      .where(eq(receiptLines.receiptId, id));
    const currentById = new Map(currentLines.map((l) => [l.id, l]));

    const partIds = [...new Set(input.lines.map((l) => l.partId))];
    const partRows = await this.db.select().from(parts).where(inIds(parts.id, partIds));
    const partById = new Map(partRows.map((p) => [p.id, p]));
    for (const line of input.lines) {
      if (!partById.has(line.partId)) {
        throw new BadRequestException(`Part dengan id ${line.partId} tidak ditemukan`);
      }
    }

    const keptIds = new Set(input.lines.map((l) => l.id).filter(Boolean) as number[]);
    for (const kept of keptIds) {
      if (!currentById.has(kept)) {
        throw new BadRequestException(`Baris ${kept} bukan bagian dari penerimaan ini`);
      }
    }

    const now = new Date();
    const note = input.reason?.trim() || 'Koreksi penerimaan';

    return this.db.transaction(async (tx) => {
      // ── Baris yang dihapus: kembalikan seluruh jumlahnya ──────────────
      for (const old of currentLines) {
        if (keptIds.has(old.id)) continue;

        await tx.insert(mutations).values({
          plantId: receipt.plantId,
          partId: old.partId,
          locationId: receipt.locationId,
          lotId: old.lotId,
          type: 'ADJUSTMENT',
          qty: String(-Number(old.qty)),
          sourceTable: 'receipts',
          sourceId: id,
          note: `${note} — baris dihapus`,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          occurredAt: now,
        });

        if (old.lotId) {
          // Lot yang jumlahnya jadi nol ditutup, bukan dihapus — riwayat
          // pemakaiannya mungkin sudah dirujuk silsilah.
          await tx.update(lots).set({ status: 'RETURNED' }).where(eq(lots.id, old.lotId));
        }
        await tx.delete(receiptLines).where(eq(receiptLines.id, old.id));
      }

      // ── Baris yang tetap ada dan yang baru ────────────────────────────
      let lotSeq = currentLines.length;

      for (const line of input.lines) {
        const part = partById.get(line.partId)!;

        if (line.id) {
          const old = currentById.get(line.id)!;
          const delta = line.qty - Number(old.qty);

          if (Math.abs(delta) > 1e-9) {
            await tx.insert(mutations).values({
              plantId: receipt.plantId,
              partId: line.partId,
              locationId: receipt.locationId,
              lotId: old.lotId,
              type: 'ADJUSTMENT',
              qty: String(delta),
              sourceTable: 'receipts',
              sourceId: id,
              note: `${note} — jumlah ${old.qty} menjadi ${line.qty}`,
              npk: principal?.kind === 'user' ? principal.npk : null,
              userId: principal?.kind === 'user' ? principal.sub : null,
              occurredAt: now,
            });
          }

          await tx
            .update(receiptLines)
            .set({ qty: String(line.qty), uom: line.uom ?? old.uom })
            .where(eq(receiptLines.id, line.id));

          if (old.lotId) {
            await tx
              .update(lots)
              .set({
                initialQty: String(line.qty),
                supplierLotNumber: line.supplierLotNumber ?? null,
              })
              .where(eq(lots.id, old.lotId));
          }
          continue;
        }

        // Baris baru
        let lotId: number | null = null;
        if (needsLot(part.trackingMode)) {
          lotSeq += 1;
          const lotNumber = buildLotNumber({
            partNumber: part.partNumber,
            supplierLotNumber: line.supplierLotNumber,
            at: receipt.receivedAt,
            sequenceToday: lotSeq,
          });
          const lotInserted = await tx.insert(lots).values({
            plantId: receipt.plantId,
            partId: part.id,
            lotNumber,
            supplierLotNumber: line.supplierLotNumber ?? null,
            supplierId: receipt.supplierId,
            receivedAt: receipt.receivedAt,
            initialQty: String(line.qty),
            status: 'OPEN',
          });
          lotId = Number((lotInserted as unknown as Array<{ insertId: number }>)[0]?.insertId);
        }

        await tx.insert(receiptLines).values({
          receiptId: id,
          partId: part.id,
          lotId,
          qty: String(line.qty),
          uom: line.uom ?? part.uom,
        });

        await tx.insert(mutations).values({
          plantId: receipt.plantId,
          partId: part.id,
          locationId: receipt.locationId,
          lotId,
          type: 'RECEIVING_IN',
          qty: String(line.qty),
          sourceTable: 'receipts',
          sourceId: id,
          note: `${note} — baris ditambahkan`,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          occurredAt: now,
        });
      }

      await tx
        .update(receipts)
        .set({
          supplierDocNumber: input.supplierDocNumber ?? receipt.supplierDocNumber,
          note: input.note ?? receipt.note,
        })
        .where(eq(receipts.id, id));

      this.logger.log(`penerimaan ${receipt.documentNumber} dikoreksi: ${note}`);
      return { id, documentNumber: receipt.documentNumber };
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
        // partId dan trackingMode ikut dikirim karena layar ubah membutuhkannya
        // untuk menyusun ulang barisnya tanpa query kedua.
        partId: receiptLines.partId,
        partNumber: parts.partNumber,
        partName: parts.name,
        trackingMode: parts.trackingMode,
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

/** IN untuk daftar teks. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inTexts(column: any, values: string[]) {
  if (values.length === 0) return sql`1 = 0`;
  return sql`${column} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

/** Pembungkus kecil agar pemanggilan IN tetap terbaca di atas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inIds(column: any, values: number[]) {
  if (values.length === 0) return sql`1 = 0`;
  return sql`${column} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}
