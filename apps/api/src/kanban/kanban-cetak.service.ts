import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, sql, type Database } from '@avicenna/db';
import { kanbans, lines, parts, plants } from '@avicenna/db';
import { kodeKetikKanban, seriKanban, susunKodeKartuKanban } from '@avicenna/domain';
import {
  KARTU_PER_LEMBAR,
  type CetakKanbanInput,
  type HasilCetakKanban,
  type KartuKanbanCetak,
  type PartKartu,
  type PratinjauCetakKanban,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

/**
 * ─── MASTER KANBAN LAHIR SAAT DICETAK ──────────────────────────────────────
 *
 * OMD memilih part dan menyebut rentang seri; kartu yang belum ada dibuatkan
 * barisnya, yang sudah ada dilewati. Lihat catatan di `cetakKanbanSchema`
 * (@avicenna/contracts) untuk alasan pembuatan menempel pada pencetakan.
 *
 * ── Yang disalin ke kartu, dan yang tidak ───────────────────────────────────
 *
 * Isi per box dan production version DISALIN dari master part saat kartu
 * dibuat, tidak dibaca ulang dari sana setiap kali. Begitu masternya diubah,
 * kartu yang sudah tercetak dan beredar di lantai tetap menyatakan angka yang
 * BENAR-BENAR tercetak di atasnya — sedangkan membacanya ulang membuat layar
 * dan kartu fisik berbeda isi tanpa ada yang menyadari.
 */
@Injectable()
export class KanbanCetakService {
  private readonly logger = new Logger(KanbanCetakService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  private async part(partId: number): Promise<PartKartu> {
    const [row] = await this.db
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
        qtyPerBox: parts.qtyPerKanban,
        productionVersion: parts.productionVersion,
        plantCode: plants.code,
        lineName: lines.name,
        lineCode: lines.code,
      })
      .from(parts)
      .leftJoin(plants, eq(plants.id, parts.plantId))
      .leftJoin(lines, eq(lines.id, parts.lineId))
      .where(eq(parts.id, partId))
      .limit(1);
    if (!row) throw new NotFoundException(`Part ${partId} tidak ada`);
    return row;
  }

  /** Seri dalam rentang yang barisnya sudah ada. */
  private async seriAda(partId: number, dari: number, sampai: number): Promise<Set<string>> {
    /*
     * Disaring di database dengan membandingkan ANGKA, bukan teks: seri
     * tersimpan sebagai teks dan "0009" > "0100" secara leksikografis. Seri
     * yang bukan angka (kartu customer dari label DN, mis. "QA-...") ikut
     * tersaring keluar dengan sendirinya.
     */
    const rows = await this.db
      .select({ serialNumber: kanbans.serialNumber })
      .from(kanbans)
      .where(
        and(
          eq(kanbans.partId, partId),
          sql`${kanbans.serialNumber} ~ '^[0-9]+$'`,
          gte(sql`CAST(${kanbans.serialNumber} AS integer)`, dari),
          lte(sql`CAST(${kanbans.serialNumber} AS integer)`, sampai),
        ),
      );
    return new Set(rows.map((r) => r.serialNumber));
  }

  async pratinjau(input: CetakKanbanInput): Promise<PratinjauCetakKanban> {
    const part = await this.part(input.partId);
    const total = input.sampai - input.dari + 1;
    const ada = await this.seriAda(part.id, input.dari, input.sampai);

    let sudahAda = 0;
    for (let n = input.dari; n <= input.sampai; n += 1) {
      if (ada.has(seriKanban(n))) sudahAda += 1;
    }

    const penghalang: string[] = [];
    const peringatan: string[] = [];

    /*
     * Back number WAJIB. Barcode kartu berbentuk BACKNUMBER|SERIAL, dan seri
     * tidak unik antar part — kartu tanpa back number akan menemukan part lain
     * yang kebetulan punya seri yang sama saat discan. Lihat catatan di
     * `susunKodeKartuKanban`.
     */
    if (!part.backNumber?.trim()) {
      penghalang.push(
        `${part.partNumber} belum punya back number. Barcode kartu memakai back number untuk ` +
          'memisahkannya dari part lain yang serinya sama — isi dulu di Master Data › Part.',
      );
    }

    if (!part.qtyPerBox || part.qtyPerBox <= 0) {
      penghalang.push(
        `${part.partNumber} belum punya isi per box. Angka itu tercetak di kartu dan dipakai ` +
          'menghitung jumlah saat kartu discan — isi dulu di Master Data › Part.',
      );
    }

    /*
     * Production version TIDAK menghalangi. Blueprint PP-MD-05 menjadikannya
     * syarat pembuatan kanban di SAP, tetapi versinya datang dari tim SAP dan
     * belum terisi di part mana pun. Menahan pencetakan karenanya berarti
     * menghentikan OMD atas hal yang bukan urusannya.
     */
    if (!part.productionVersion?.trim()) {
      peringatan.push(
        'Production version part ini masih kosong. Kartunya tetap bisa dicetak dan dipakai di ' +
          'lantai, tetapi kartu tanpa versi belum bisa didaftarkan ke SAP (PP-MD-05).',
      );
    }

    if (!part.lineName) {
      peringatan.push('Part ini belum ditautkan ke line, jadi kolom line di kartu dicetak kosong.');
    }

    return {
      part,
      dari: input.dari,
      sampai: input.sampai,
      total,
      sudahAda,
      akanDibuat: total - sudahAda,
      lembar: Math.ceil(total / KARTU_PER_LEMBAR),
      penghalang,
      peringatan,
    };
  }

  /**
   * Membuat baris yang belum ada. Idempoten.
   *
   * Yang sudah ada TIDAK disentuh sama sekali — bukan hanya tidak ditambah.
   * Kartu yang sudah beredar punya status, jumlah putaran, dan isi per box yang
   * berlaku saat ia dicetak; menimpanya dengan nilai master hari ini akan
   * mengubah kartu yang sedang membawa barang.
   */
  async buat(input: CetakKanbanInput, principal?: Principal): Promise<HasilCetakKanban> {
    const pratinjau = await this.pratinjau(input);
    if (pratinjau.penghalang.length > 0) {
      throw new NotFoundException(pratinjau.penghalang[0]);
    }

    const part = pratinjau.part;
    const ada = await this.seriAda(part.id, input.dari, input.sampai);

    const baru: { serialNumber: string }[] = [];
    for (let n = input.dari; n <= input.sampai; n += 1) {
      const seri = seriKanban(n);
      if (!ada.has(seri)) baru.push({ serialNumber: seri });
    }

    if (baru.length > 0) {
      const [pabrik] = await this.db
        .select({ id: parts.plantId })
        .from(parts)
        .where(eq(parts.id, part.id))
        .limit(1);

      await this.db
        .insert(kanbans)
        .values(
          baru.map((b) => ({
            plantId: pabrik!.id,
            partId: part.id,
            serialNumber: b.serialNumber,
            qtyPerBox: part.qtyPerBox!,
            productionVersion: part.productionVersion ?? null,
            status: 'AVAILABLE' as const,
          })),
        )
        /*
         * Dua OMD menekan cetak pada rentang yang sama dalam selisih detik:
         * unique index (part, seri) yang menjaganya, bukan pemeriksaan di atas
         * yang bisa kalah balapan. Yang kalah melewatinya, tidak gagal —
         * hasilnya sama-sama benar.
         */
        .onConflictDoNothing({ target: [kanbans.partId, kanbans.serialNumber] });
    }

    this.logger.log(
      `cetak kanban ${part.partNumber} seri ${seriKanban(input.dari)}-${seriKanban(input.sampai)}: ` +
        `${baru.length} baru, ${pratinjau.sudahAda} sudah ada` +
        (principal?.kind === 'user' ? ` (NPK ${principal.npk})` : ''),
    );

    return {
      dibuat: baru.length,
      sudahAda: pratinjau.sudahAda,
      total: pratinjau.total,
    };
  }

  /**
   * Kartu dalam rentang, untuk dicetak. HANYA membaca.
   *
   * Dipisah dari `buat` supaya halaman cetaknya bisa dimuat ulang — dan kartu
   * yang sobek bisa dicetak ulang kapan saja — tanpa pernah membuat baris baru.
   */
  async daftarCetak(input: CetakKanbanInput): Promise<KartuKanbanCetak[]> {
    const part = await this.part(input.partId);
    const rows = await this.db
      .select({
        kanbanId: kanbans.id,
        serialNumber: kanbans.serialNumber,
        qtyPerBox: kanbans.qtyPerBox,
      })
      .from(kanbans)
      .where(
        and(
          eq(kanbans.partId, part.id),
          eq(kanbans.isActive, true),
          sql`${kanbans.serialNumber} ~ '^[0-9]+$'`,
          gte(sql`CAST(${kanbans.serialNumber} AS integer)`, input.dari),
          lte(sql`CAST(${kanbans.serialNumber} AS integer)`, input.sampai),
        ),
      )
      .orderBy(asc(sql`CAST(${kanbans.serialNumber} AS integer)`));

    return rows.map((r) => ({
      kanbanId: r.kanbanId,
      serialNumber: r.serialNumber,
      partNumber: part.partNumber,
      partName: part.partName,
      backNumber: part.backNumber,
      lineName: part.lineName,
      /* Dari KARTUNYA, bukan dari master part: itulah angka yang tercetak. */
      qtyPerBox: r.qtyPerBox,
      plantCode: part.plantCode,
      /*
       * Isi barcode disusun dari baris kartu INI, bukan dari master part.
       *
       * qty/box-nya pun dari kartunya (lihat di atas): yang tercetak di muka
       * kartu dan yang tercetak di dalam QR-nya harus angka yang sama, kalau
       * tidak pemeriksaan qty di scan.service akan memperingatkan setiap kartu
       * yang baru keluar dari printer.
       */
      kode: susunKodeKartuKanban({
        partNumber: part.partNumber,
        backNumber: part.backNumber ?? '',
        serialNumber: r.serialNumber,
        qtyPerBox: r.qtyPerBox,
      }),
      kodeKetik: kodeKetikKanban({
        backNumber: part.backNumber ?? '',
        serialNumber: r.serialNumber,
      }),
    }));
  }

  /** Part yang punya kartu, untuk daftar pilihan di layar OMD. */
  async partBisaDicetak(): Promise<(PartKartu & { jumlahKartu: number })[]> {
    const rows = await this.db
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
        qtyPerBox: parts.qtyPerKanban,
        productionVersion: parts.productionVersion,
        plantCode: plants.code,
        lineName: lines.name,
        lineCode: lines.code,
        jumlahKartu: sql<number>`(
          select count(*) from ${kanbans} where ${kanbans.partId} = ${parts.id}
        )`,
      })
      .from(parts)
      .leftJoin(plants, eq(plants.id, parts.plantId))
      .leftJoin(lines, eq(lines.id, parts.lineId))
      .where(eq(parts.isActive, true))
      .orderBy(asc(plants.code), asc(parts.partNumber));

    return rows.map((r) => ({ ...r, jumlahKartu: Number(r.jumlahKartu ?? 0) }));
  }

  /** Dipakai layar OMD untuk menandai rentang yang sudah pernah dicetak. */
  async rentangTerpakai(partId: number): Promise<{ min: number; maks: number; jumlah: number }> {
    const [row] = await this.db
      .select({
        min: sql<number | null>`min(CAST(${kanbans.serialNumber} AS integer))`,
        maks: sql<number | null>`max(CAST(${kanbans.serialNumber} AS integer))`,
        jumlah: sql<number>`count(*)`,
      })
      .from(kanbans)
      .where(and(eq(kanbans.partId, partId), sql`${kanbans.serialNumber} ~ '^[0-9]+$'`));
    return {
      min: Number(row?.min ?? 0),
      maks: Number(row?.maks ?? 0),
      jumlah: Number(row?.jumlah ?? 0),
    };
  }
}
