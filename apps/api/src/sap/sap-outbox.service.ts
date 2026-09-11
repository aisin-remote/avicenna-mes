import { Injectable, Logger } from '@nestjs/common';
import { eq, and, sql, desc, count, inArray, type Database } from '@avicenna/db';
import { sapOutbox, mutations, parts, locations, plants } from '@avicenna/db';
import { sapMovementFor, siapDikirim } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';

/** Jeda sebelum sebuah dokumen dianggap lengkap. Lihat catatan di collect(). */
const SETTLE_SECONDS = 60;

/** Berapa dokumen dikumpulkan sekali jalan. */
const BATCH = 200;

interface BarisDokumen {
  mutationId: number;
  mutationType: string;
  partNumber: string | null;
  slocCode: string | null;
  qty: string;
  lotId: number | null;
  note: string | null;
}

/**
 * Mengumpulkan perpindahan barang menjadi dokumen untuk SAP.
 *
 * ── Kenapa mengumpulkan, bukan menulis saat kejadian ──────────────────────
 *
 * Alternatifnya adalah memanggil "catat ke outbox" di enam service yang
 * berbeda — penerimaan, transfer, pulling, pengiriman, scan produksi,
 * backflush. Enam tempat yang harus diingat, dan yang ketujuh pasti terlupa.
 *
 * Di sini sumbernya satu: buku besar mutasi. Dokumen yang belum punya baris
 * outbox dicari dengan NOT EXISTS, bukan dengan penanda posisi terakhir.
 * Penanda posisi punya lubang yang terkenal — transaksi yang commit belakangan
 * tetapi memperoleh id lebih kecil akan terlewat, dan tidak ada yang
 * memberitahu. NOT EXISTS ditambah unique index membuat pengumpulan ini
 * idempoten dan tidak bisa bocor.
 */
@Injectable()
export class SapOutboxService {
  private readonly logger = new Logger(SapOutboxService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  async collect(): Promise<{ dikumpulkan: number; ditahan: number; dilewati: number }> {
    /*
     * Hanya dokumen yang sudah "mengendap" yang diambil.
     *
     * Backflush berjalan di antrean, beberapa detik SETELAH scan produksinya
     * tercatat. Mengambil dokumen terlalu cepat berarti mengirim konfirmasi
     * produksi tanpa baris pemakaian komponennya — barang jadi bertambah di
     * SAP, materialnya tidak pernah berkurang.
     */
    const kandidat = await this.db.execute(sql`
      SELECT m.SOURCE_TABLE AS sourceTable,
             m.SOURCE_ID    AS sourceId
      FROM ${mutations} m
      WHERE m.SOURCE_TABLE IS NOT NULL
        AND m.SOURCE_ID IS NOT NULL
      GROUP BY m.SOURCE_TABLE, m.SOURCE_ID
      HAVING MAX(m.CREATED_AT) < (NOW() - INTERVAL ${sql.raw(String(SETTLE_SECONDS))} SECOND)
      ORDER BY MIN(m.OCCURRED_AT)
      LIMIT ${sql.raw(String(BATCH))}
    `);

    const rows = (kandidat as unknown as Array<Array<Record<string, unknown>>>)[0] ?? [];
    let dikumpulkan = 0;
    let ditahan = 0;
    let dilewati = 0;

    for (const r of rows) {
      const hasil = await this.buildAndInsert(String(r.sourceTable), Number(r.sourceId));
      dikumpulkan += hasil.pending;
      ditahan += hasil.held;
      dilewati += hasil.skipped;
    }

    if (dikumpulkan + ditahan + dilewati > 0) {
      this.logger.log(
        `outbox: ${dikumpulkan} siap kirim, ${ditahan} ditahan, ${dilewati} dilewati`,
      );
    }
    return { dikumpulkan, ditahan, dilewati };
  }

  /**
   * Membangun dokumen SAP dari sebuah dokumen asal.
   *
   * Satu dokumen asal bisa menghasilkan BEBERAPA dokumen SAP. Satu loading
   * list memuat pulling (PP02 ke PP04, movement 311) dan pengiriman keluar
   * (PP04, movement 601) — dua perpindahan berbeda yang kebetulan dicatat pada
   * dokumen yang sama. Karena itu barisnya dikelompokkan per jenis dokumen
   * SAP, bukan ditumpuk jadi satu.
   */
  private async buildAndInsert(
    sourceTable: string,
    sourceId: number,
  ): Promise<{ pending: number; held: number; skipped: number }> {
    const hasil = { pending: 0, held: 0, skipped: 0 };

    const baris = await this.db
      .select({
        mutationId: mutations.id,
        mutationType: mutations.type,
        plantId: mutations.plantId,
        partNumber: parts.partNumber,
        slocCode: locations.code,
        qty: mutations.qty,
        lotId: mutations.lotId,
        note: mutations.note,
        occurredAt: mutations.occurredAt,
      })
      .from(mutations)
      .leftJoin(parts, eq(mutations.partId, parts.id))
      .leftJoin(locations, eq(mutations.locationId, locations.id))
      .where(and(eq(mutations.sourceTable, sourceTable), eq(mutations.sourceId, sourceId)))
      .orderBy(mutations.id);

    if (baris.length === 0) return hasil;

    // Kelompokkan per jenis dokumen SAP.
    const kelompok = new Map<string, typeof baris>();
    const takDikenal: string[] = [];
    for (const b of baris) {
      const docType = sapMovementFor(b.mutationType)?.docType;
      if (!docType) {
        takDikenal.push(b.mutationType);
        continue;
      }
      const daftar = kelompok.get(docType) ?? [];
      daftar.push(b);
      kelompok.set(docType, daftar);
    }

    if (takDikenal.length > 0) {
      this.logger.warn(
        `jenis mutasi belum dipetakan ke SAP: ${[...new Set(takDikenal)].join(', ')}`,
      );
    }

    for (const [docType, anggota] of kelompok) {
      const dikirim = anggota.filter((b) => sapMovementFor(b.mutationType)?.kirim);
      const jenis = anggota.map((b) => b.mutationType);

      const dasar = {
        plantId: anggota[0]!.plantId,
        sourceTable,
        sourceId,
        docType,
        // Jenis dokumen ikut ke dalam kunci: satu dokumen asal bisa punya dua.
        idempotencyKey: `${sourceTable}:${sourceId}:${docType}`,
        occurredAt: anggota[0]!.occurredAt,
      };

      if (dikirim.length === 0) {
        const baru = await this.simpan({
          ...dasar,
          movementType: null,
          status: 'SKIPPED',
          lastError: 'tidak ada baris yang perlu dikirim ke SAP',
          payload: { docType, lines: [] },
        });
        if (baru) hasil.skipped++;
        continue;
      }

      const { siap, belum } = siapDikirim(jenis);
      const movementType = sapMovementFor(dikirim[0]!.mutationType)?.movementType ?? null;

      const baru = await this.simpan({
        ...dasar,
        movementType,
        // Dokumen yang movement type-nya belum diputuskan DITAHAN, bukan
        // dibuang dan bukan pula dikirim dengan tebakan. Begitu angkanya turun
        // dari tim SAP, statusnya tinggal dikembalikan ke PENDING.
        status: siap ? 'PENDING' : 'HELD',
        lastError: siap ? null : `movement type belum diputuskan untuk: ${belum.join(', ')}`,
        payload: {
          docType,
          movementType,
          plantId: dasar.plantId,
          sourceTable,
          sourceId,
          occurredAt: dasar.occurredAt,
          lines: dikirim.map((b) => ({
            mutationId: b.mutationId,
            mutationType: b.mutationType,
            movementType: sapMovementFor(b.mutationType)?.movementType ?? null,
            partNumber: b.partNumber,
            sloc: b.slocCode,
            qty: b.qty,
            lotId: b.lotId,
            note: b.note,
          })),
        },
      });

      if (!baru) continue;
      if (siap) hasil.pending++;
      else hasil.held++;
    }

    return hasil;
  }

  /**
   * Menyimpan satu dokumen. Mengembalikan false bila dokumennya SUDAH ADA.
   *
   * Pembedaan ini bukan kerapian belaka: tanpa itu penghitung melaporkan
   * jumlah yang DICOBA, bukan yang benar-benar baru, dan layar pemantauan akan
   * mengatakan "7 dokumen siap kirim" setiap menit selamanya — seolah antrean
   * terus bertambah padahal tidak ada yang berubah.
   */
  private async simpan(v: {
    plantId: number;
    sourceTable: string;
    sourceId: number;
    docType: string;
    movementType: string | null;
    idempotencyKey: string;
    status: 'PENDING' | 'HELD' | 'SKIPPED';
    lastError: string | null;
    payload: unknown;
    occurredAt: Date;
  }): Promise<boolean> {
    try {
      await this.db.insert(sapOutbox).values(v);
      return true;
    } catch (err) {
      // Unique index yang menolak berarti dokumen ini sudah dikumpulkan —
      // entah pada putaran sebelumnya, entah oleh pengumpul lain yang berjalan
      // bersamaan. Itu justru yang diinginkan.
      const e = err as { errno?: number; cause?: { errno?: number } };
      if ((e?.errno ?? e?.cause?.errno) !== 1062) throw err;
      return false;
    }
  }

  /** Melepas dokumen yang tertahan, setelah movement type-nya diputuskan. */
  async releaseHeld(): Promise<{ dilepas: number }> {
    const tertahan = await this.db
      .select()
      .from(sapOutbox)
      .where(eq(sapOutbox.status, 'HELD'));

    let dilepas = 0;
    for (const row of tertahan) {
      const payload = row.payload as { lines?: Array<{ mutationType: string }> };
      const jenis = (payload.lines ?? []).map((l) => l.mutationType);
      const { siap } = siapDikirim(jenis);
      if (!siap) continue;

      const movementType = sapMovementFor(jenis[0] ?? '')?.movementType ?? null;
      await this.db
        .update(sapOutbox)
        .set({ status: 'PENDING', movementType, lastError: null })
        .where(eq(sapOutbox.id, row.id));
      dilepas++;
    }
    if (dilepas > 0) this.logger.log(`${dilepas} dokumen tertahan dilepas ke antrean kirim`);
    return { dilepas };
  }

  /** Ringkasan per status, untuk layar pemantauan. */
  async summary() {
    const rows = await this.db
      .select({ status: sapOutbox.status, jumlah: count() })
      .from(sapOutbox)
      .groupBy(sapOutbox.status);
    const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.jumlah)]));
    return {
      pending: map.PENDING ?? 0,
      sent: map.SENT ?? 0,
      failed: map.FAILED ?? 0,
      held: map.HELD ?? 0,
      skipped: map.SKIPPED ?? 0,
    };
  }

  async list(params: { page: number; perPage: number; status?: string }) {
    const offset = (params.page - 1) * params.perPage;
    const filter =
      params.status && params.status !== 'ALL'
        ? eq(sapOutbox.status, params.status as 'PENDING')
        : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: sapOutbox.id,
          plantCode: plants.code,
          docType: sapOutbox.docType,
          movementType: sapOutbox.movementType,
          sourceTable: sapOutbox.sourceTable,
          sourceId: sapOutbox.sourceId,
          status: sapOutbox.status,
          attempts: sapOutbox.attempts,
          lastError: sapOutbox.lastError,
          sapDocNumber: sapOutbox.sapDocNumber,
          occurredAt: sapOutbox.occurredAt,
          sentAt: sapOutbox.sentAt,
        })
        .from(sapOutbox)
        .leftJoin(plants, eq(sapOutbox.plantId, plants.id))
        .where(filter)
        .orderBy(desc(sapOutbox.occurredAt), desc(sapOutbox.id))
        .limit(params.perPage)
        .offset(offset),
      this.db.select({ value: count() }).from(sapOutbox).where(filter),
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

  /** Mencoba ulang dokumen yang gagal kirim. */
  async retry(ids: number[]): Promise<{ diulang: number }> {
    if (ids.length === 0) return { diulang: 0 };
    await this.db
      .update(sapOutbox)
      .set({ status: 'PENDING', lastError: null })
      .where(and(inArray(sapOutbox.id, ids), eq(sapOutbox.status, 'FAILED')));
    return { diulang: ids.length };
  }
}
