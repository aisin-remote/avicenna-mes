import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq, and, desc, gte, lt, count, inArray, type Database } from '@avicenna/db';
import {
  scanEvents, lines, parts, machines, mutations, plants, partProcesses,
  kanbans, kanbanItems, kanbanEvents, programNumbers, users, roles,
} from '@avicenna/db';
import {
  normalizeScan,
  bacaBarcode,
  BarcodeTidakDikenali,
  punyaIdentitasPart,
  signedQty,
  productionDateKey,
  productionDayWindow,
  prosesSebelumnya,
  prosesAdaDiRute,
  menghasilkanFinishGood,
  grupProses,
  prosesDalamGrup,
  bolehScanDi,
  PROCESS_GROUP_LABELS,
  bacaKanban,
  KanbanTidakTerbaca,
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

    const line = normalized.lineCode ? await this.findLine(normalized.lineCode) : undefined;
    if (normalized.lineCode && !line) {
      throw new ScanRejected('LINE_NOT_FOUND', REJECT_MESSAGES.LINE_NOT_FOUND);
    }

    /*
     * Barcode dibaca DENGAN konteksnya.
     *
     * Formatnya berbeda per proses dan per customer, jadi aturan mana yang
     * dipakai bergantung pada line tempat scan terjadi. Membacanya tanpa
     * konteks berarti aturan yang paling longgar selalu menang.
     */
    const konteksBarcode = {
      processType: normalized.processType ?? line?.processType ?? null,
    };
    let parsed;
    try {
      parsed = bacaBarcode(normalized.rawCode, konteksBarcode);
    } catch (err) {
      if (err instanceof BarcodeTidakDikenali) {
        throw new ScanRejected('BARCODE_UNREADABLE', REJECT_MESSAGES.BARCODE_UNREADABLE);
      }
      throw err;
    }

    /*
     * Barcode produksi 15 karakter TIDAK memuat nomor part.
     *
     * Yang ada hanya dua digit program number di depan, dan itulah yang
     * menerjemahkannya lewat TM_PROGRAM_NUMBER. Tanpa penerjemahan ini, seluruh
     * scan produksi di lantai akan ditolak sebagai "part tidak dikenali" —
     * karena memang tidak ada nomor part untuk dicari.
     */
    const { part, model: programModel } = await this.kenaliPart(parsed, line?.plantId);

    /*
     * Produksi WAJIB mengenali part-nya.
     *
     * Tanpa part, mutasi stok tidak bisa ditulis — dan sebelumnya baris itu
     * hanya dilewati diam-diam: scan tercatat, penghitung naik, operator
     * melihat "berhasil", tetapi stoknya tidak pernah bergerak. Selisihnya baru
     * ketahuan saat stock opname, berbulan-bulan kemudian, tanpa jejak sebabnya.
     *
     * Jenis scan lain tidak diwajibkan: inspeksi dan stock opname memang
     * bekerja per nomor seri dan tidak selalu menyebut part.
     */
    if (normalized.kind === 'PRODUCTION' && !part) {
      /*
       * Sebab disebut sejelas mungkin. Ketiganya menuntut tindakan berbeda:
       * program number belum didaftarkan (urusan master), part memang tidak ada,
       * atau barcodenya tidak memuat identitas part sama sekali.
       */
      const sebab = parsed.programCode
        ? `program number "${parsed.programCode}" belum terdaftar di master`
        : punyaIdentitasPart(parsed)
          ? `part "${parsed.partNumber ?? parsed.backNumber}" tidak ada di master`
          : `barcode terbaca aturan ${parsed.aturan} yang tidak memuat nomor part`;
      this.logger.warn(`scan produksi ditolak — ${sebab}: ${normalized.rawCode}`);
      throw new ScanRejected(
        'PART_NOT_RECOGNIZED',
        `${REJECT_MESSAGES.PART_NOT_RECOGNIZED} (${sebab})`,
      );
    }
    const machine = normalized.machineCode
      ? await this.findMachine(normalized.machineCode)
      : undefined;

    const plantId = line?.plantId ?? part?.plantId ?? (principal?.plantId ?? undefined);
    if (!plantId) {
      // ScanRejected, bukan BadRequestException: yang terakhir ditangkap
      // station() dan dipetakan ke LINE_NOT_FOUND, sehingga operator dibacakan
      // "Line tidak dikenal" padahal line-nya baik-baik saja.
      throw new ScanRejected(
        'PLANT_UNKNOWN',
        `${REJECT_MESSAGES.PLANT_UNKNOWN} (line, part, maupun token tidak menyebutkannya)`,
      );
    }

    const prodDate = productionDateKey(normalized.scannedAt);
    /*
     * Proses ditentukan LINI tempat scan terjadi, bukan atribut part.
     *
     * TM_PARTS.CHR_PROCESS_TYPE adalah peninggalan dari masa satu part = satu
     * proses. Sejak rute menjadi data (TM_PROCESS_PARTS), sebuah part melewati
     * banyak proses, dan yang menentukan proses mana adalah lini fisiknya.
     *
     * Urutan lama mendahulukan part, sehingga scan di lini Melting dianggap
     * scan Casting — dan operator di lini pertama ditolak dengan alasan "belum
     * ada scan Melting", persis proses yang sedang ia kerjakan. Part hanya
     * dipakai bila scan memang datang tanpa lini (mis. dari alat genggam).
     */
    const processType = normalized.processType ?? line?.processType ?? part?.processType ?? null;

    /*
     * Pemeriksaan rute — memakai RUTE PART, bukan rantai global.
     *
     * Rute tiap part berbeda. TCC A melewati Melting, Casting, Machining,
     * Assembling, lalu Delivery; CSH A hanya Melting, Casting, Delivery. Aturan
     * global tidak bisa menyatakan bahwa proses sebelum Delivery adalah
     * Assembling untuk yang satu dan Casting untuk yang lain.
     */
    if (processType && part) {
      const rute = await this.db
        .select({ processType: partProcesses.processType, seqNo: partProcesses.seqNo })
        .from(partProcesses)
        .where(and(eq(partProcesses.partId, part.id), eq(partProcesses.isActive, true)));

      if (rute.length === 0) {
        /*
         * Part tanpa rute TIDAK ditolak.
         *
         * Tabel rute masih terisi bertahap; menolak semua part yang belum
         * punya rute berarti menghentikan produksi pada hari pemasangan.
         * Scan-nya tetap lengkap dan mutasinya tetap benar — yang dilewati
         * hanya pemeriksaan urutan. Dicatat sebagai peringatan supaya
         * kekosongannya terlihat, bukan diam.
         */
        this.logger.warn(
          `part ${part.partNumber} belum punya rute di TM_PROCESS_PARTS — urutan proses tidak diperiksa`,
        );
      } else {
        // Part yang dibawa ke lini yang bukan rutenya adalah kekeliruan nyata:
        // tanpa ini, part CSH yang discan di lini machining akan menambah stok
        // barang jadi yang tidak pernah dibuat.
        if (!prosesAdaDiRute(rute, processType)) {
          throw new ScanRejected(
            'PROCESS_NOT_IN_ROUTE',
            `${REJECT_MESSAGES.PROCESS_NOT_IN_ROUTE} (${part.partNumber} tidak melewati ${processType})`,
          );
        }

        const sebelumnya = prosesSebelumnya(rute, processType);
        if (sebelumnya) {
          const pernah = await this.db
            .select({ id: scanEvents.id })
            .from(scanEvents)
            .where(
              and(
                eq(scanEvents.rawCode, normalized.rawCode),
                eq(scanEvents.processType, sebelumnya),
              ),
            )
            .limit(1);

          if (pernah.length === 0) {
            throw new ScanRejected(
              'MISSING_PREVIOUS_PROCESS',
              `${REJECT_MESSAGES.MISSING_PREVIOUS_PROCESS} (belum ada scan ${sebelumnya})`,
            );
          }
        }
      }
    }

    /*
     * ── Kanban di lini finish good ────────────────────────────────────────
     *
     * Lini FG menempelkan kartu kanban ke barang jadi; sejak titik itu barang
     * berpindah sebagai kanban, dan di delivery part code tidak discan lagi.
     * Lini WIP tidak memakai kanban sama sekali.
     *
     * Diperiksa SEBELUM scan ditulis. Menulis scan lebih dulu lalu menempel
     * kanban sesudahnya membuka keadaan yang mustahil dibereskan: produksi
     * tercatat, stok bertambah, tetapi barangnya tidak punya kanban dan tidak
     * akan pernah bisa dikirim.
     */
    let kanbanTerpilih: { id: number; sisa: number } | undefined;

    if (normalized.kind === 'PRODUCTION' && processType && part) {
      const wajibKanban = menghasilkanFinishGood(processType);

      if (!wajibKanban && normalized.kanbanCode) {
        throw new ScanRejected('KANBAN_NOT_EXPECTED', REJECT_MESSAGES.KANBAN_NOT_EXPECTED);
      }

      if (wajibKanban) {
        if (!normalized.kanbanCode) {
          throw new ScanRejected('KANBAN_REQUIRED', REJECT_MESSAGES.KANBAN_REQUIRED);
        }

        let kb;
        try {
          kb = bacaKanban(normalized.kanbanCode, konteksBarcode);
        } catch (err) {
          if (err instanceof KanbanTidakTerbaca) {
            throw new ScanRejected('KANBAN_UNREADABLE', REJECT_MESSAGES.KANBAN_UNREADABLE);
          }
          throw err;
        }

        /*
         * Back number pada kartu WAJIB cocok dengan part-nya.
         *
         * Seri kanban tidak unik antar part: "1001" ada pada beberapa part
         * sekaligus. Tanpa pemeriksaan ini, operator yang mengambil kartu part
         * lain akan diterima begitu serinya kebetulan sama — dan barangnya
         * terkirim atas nama part yang keliru.
         *
         * Ini padanan pemeriksaan "notmatch" di sistem lama, yang mencocokkan
         * back number kartu dengan back number part sebelum menempel.
         */
        if (kb.backNumber && part.backNumber && kb.backNumber !== part.backNumber) {
          throw new ScanRejected(
            'KANBAN_PART_MISMATCH',
            `${REJECT_MESSAGES.KANBAN_PART_MISMATCH} ` +
              `(kartu untuk ${kb.backNumber}, part ini ${part.backNumber})`,
          );
        }

        /*
         * Kartu dicari dengan (part, seri) — bukan seri saja.
         *
         * Seri kanban TIDAK unik antar part: "1001" bisa ada pada beberapa part
         * sekaligus. Mencarinya dengan seri saja akan menemukan kartu milik part
         * lain, dan barangnya terkirim atas nama part yang keliru.
         */
        const [kartu] = await this.db
          .select({
            id: kanbans.id,
            unitPerKanban: kanbans.unitPerKanban,
            isActive: kanbans.isActive,
          })
          .from(kanbans)
          .where(
            and(
              eq(kanbans.partId, part.id),
              eq(kanbans.serialNumber, kb.serialNumber ?? ''),
            ),
          )
          .limit(1);

        if (!kartu || !kartu.isActive) {
          /*
           * Dibedakan: kartu yang serinya ada pada part LAIN adalah "salah
           * kartu" (operator mengambil kartu yang keliru), sedangkan yang tidak
           * ada di mana pun adalah "belum terdaftar". Tindakannya berbeda.
           */
          const [adaDiPartLain] = await this.db
            .select({ id: kanbans.id })
            .from(kanbans)
            .where(eq(kanbans.serialNumber, kb.serialNumber ?? ''))
            .limit(1);

          throw new ScanRejected(
            adaDiPartLain ? 'KANBAN_PART_MISMATCH' : 'KANBAN_NOT_REGISTERED',
            adaDiPartLain
              ? `${REJECT_MESSAGES.KANBAN_PART_MISMATCH} (seri ${kb.serialNumber} bukan milik ${part.partNumber})`
              : `${REJECT_MESSAGES.KANBAN_NOT_REGISTERED} (seri ${kb.serialNumber})`,
          );
        }

        const [terisi] = await this.db
          .select({ n: count() })
          .from(kanbanItems)
          .where(eq(kanbanItems.kanbanId, kartu.id));

        const sisa = kartu.unitPerKanban - Number(terisi?.n ?? 0);
        if (sisa <= 0) {
          throw new ScanRejected(
            'KANBAN_FULL',
            `${REJECT_MESSAGES.KANBAN_FULL} (seri ${kb.serialNumber}, muat ${kartu.unitPerKanban})`,
          );
        }
        kanbanTerpilih = { id: kartu.id, sisa };
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
        // Aturan baca ikut dicatat: saat sebuah barcode terbaca keliru,
        // pertanyaan pertama selalu "dibaca pakai aturan mana".
        meta: {
          ...(normalized.meta ?? {}),
          aturanBarcode: parsed.aturan,
          ...(parsed.programCode ? { programNumber: parsed.programCode } : {}),
          ...(programModel ? { model: programModel } : {}),
        },
      });
      // mysql2 mengembalikan insertId pada elemen pertama hasil insert.
      insertedId = Number((inserted as unknown as Array<{ insertId: number }>)[0]?.insertId);
    } catch (err) {
      if (isDuplicateKey(err)) {
        return { duplicated: true, productionDate: prodDate, qty: 0 };
      }
      throw err;
    }

    /*
     * Menempelkan unit ke kartu.
     *
     * Sesudah scan tersimpan supaya bisa menunjuk balik ke scan-nya. Unique
     * index pada nomor seri unit yang menjaga satu barang tidak ikut dua
     * kanban — bukan pemeriksaan di sini, yang bisa kalah balapan saat dua
     * operator men-scan bersamaan.
     */
    if (kanbanTerpilih && insertedId) {
      const seriUnit = parsed.serialNumber ?? normalized.rawCode;
      try {
        await this.db.insert(kanbanItems).values({
          kanbanId: kanbanTerpilih.id,
          serialNumber: seriUnit,
          scanEventId: insertedId,
          attachedAt: normalized.scannedAt,
        });
        await this.db.insert(kanbanEvents).values({
          kanbanId: kanbanTerpilih.id,
          type: 'PAIRED',
          lineId: line?.id ?? null,
          userId: principal?.kind === 'user' ? principal.sub : null,
          deviceId: principal?.kind === 'device' ? principal.sub : null,
          occurredAt: normalized.scannedAt,
          meta: { serialUnit: seriUnit, scanEventId: insertedId },
        });
      } catch (err) {
        if (isDuplicateKey(err)) {
          this.logger.warn(`unit ${seriUnit} sudah menempel pada kanban lain`);
        } else {
          throw err;
        }
      }
    }

    // Scan produksi menambah stok; jenis scan lain belum menulis mutasi
    // sampai aturannya dikonfirmasi tim produksi. `part` di sini sudah pasti
    // ada — scan produksi tanpa part ditolak jauh di atas.
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

  /**
   * Mencari part: lewat nomor part, atau lewat back number bila nomor part
   * memang tidak ada di barcode.
   *
   * ── Kenapa tidak jatuh ke back number saat nomor part TIDAK ketemu ────────
   *
   * Barcode yang menyebut nomor part sudah menyatakan part mana yang dimaksud.
   * Bila nomor itu tidak ada di pabrik ini, jawabannya "tidak dikenali" — bukan
   * izin menebak dari field lain.
   *
   * Jatuh ke back number pada keadaan itu pernah membuat barcode
   * BL-98765-002|BN-001|... teridentifikasi sebagai AV-12345-001, part yang
   * sama sekali berbeda yang kebetulan ber-back number BN-001. Produksi
   * dikreditkan ke part keliru, stoknya bertambah di tempat yang salah, dan
   * tidak ada satu pun pesan yang muncul.
   */
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
      // Nomor part disebut tetapi tidak ada: berhenti di sini.
      return byPartNumber[0];
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
   * Mengenali part dari barcode yang SUDAH dibaca.
   *
   * Dua jalur, dalam urutan ini:
   *   1. nomor part / back number yang tertulis di barcode
   *   2. dua digit program number di depan barcode produksi 15 karakter
   *
   * Jalur kedua ada karena barcode produksi TIDAK memuat nomor part sama sekali
   * — tanpa penerjemahan lewat TM_PROGRAM_NUMBER, seluruh scan di lantai akan
   * ditolak sebagai "part tidak dikenali".
   *
   * Publik supaya pencatatan NG memakai pengenalan yang PERSIS SAMA. Menyalin
   * logikanya ke sana berarti dua salinan yang akan menyimpang: barang yang
   * dikenali saat discan baik bisa jadi tidak dikenali saat dinyatakan NG, dan
   * operator ditolak tanpa sebab yang bisa ia perbaiki.
   */
  async kenaliPart(
    parsed: { partNumber?: string; backNumber?: string; programCode?: string },
    plantId?: number,
  ): Promise<{ part?: typeof parts.$inferSelect; model: string | null }> {
    const part = await this.resolvePart(parsed.partNumber, parsed.backNumber, plantId);
    if (part) return { part, model: null };

    if (!parsed.programCode) return { part: undefined, model: null };

    const [pn] = await this.db
      .select({ partId: programNumbers.partId, product: programNumbers.product })
      .from(programNumbers)
      .where(
        plantId
          ? and(
              eq(programNumbers.code, parsed.programCode),
              eq(programNumbers.plantId, plantId),
              eq(programNumbers.isActive, true),
            )
          : and(eq(programNumbers.code, parsed.programCode), eq(programNumbers.isActive, true)),
      )
      .limit(1);

    if (!pn) return { part: undefined, model: null };
    return { part: await this.partById(pn.partId), model: pn.product };
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

    /*
     * Jendela HARI PRODUKSI, bukan hari kalender.
     *
     * Sebelumnya tanggalnya diambil shift-aware tetapi rentangnya 00:00-23:59,
     * dua hal yang tidak konsisten: pada pukul 02:00 tanggal produksinya masih
     * hari kemarin, sedangkan rentang 00:00-23:59 hari kemarin tidak memuat
     * scan yang sedang terjadi. Penghitung di layar operator shift malam
     * berhenti bertambah, dan tidak ada yang tahu sebabnya.
     */
    const { start, end } = productionDayWindow(new Date());

    const rows = await this.db
      .select({ value: count() })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.lineId, line.id),
          gte(scanEvents.scannedAt, start),
          // `lt`, bukan `lte`: jendelanya [mulai, mulai+24jam) — batas atasnya
          // adalah awal hari produksi berikutnya, jadi tidak boleh ikut.
          lt(scanEvents.scannedAt, end),
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
  /**
   * Lini pada sebuah grup proses — isi modal pemilih lini.
   *
   * Disaring ke pabrik pengguna: operator di satu pabrik tidak pernah berdiri
   * di lini pabrik lain, dan menampilkannya hanya memperbesar peluang salah
   * pilih.
   */
  async liniGrup(grup: string, principal?: Principal) {
    const g = grup.toUpperCase() as Parameters<typeof prosesDalamGrup>[0];
    const jenis = prosesDalamGrup(g);
    if (jenis.length === 0) {
      throw new BadRequestException(`Grup proses "${grup}" tidak dikenal`);
    }

    const rows = await this.db
      .select({
        id: lines.id,
        code: lines.code,
        name: lines.name,
        processType: lines.processType,
        plantCode: plants.code,
      })
      .from(lines)
      .leftJoin(plants, eq(lines.plantId, plants.id))
      .where(
        and(
          inArray(lines.processType, jenis),
          eq(lines.isActive, true),
          ...(principal?.plantId ? [eq(lines.plantId, principal.plantId)] : []),
        ),
      )
      .orderBy(lines.sortOrder);

    return { grup: g, label: PROCESS_GROUP_LABELS[g], lines: rows };
  }

  /**
   * Membuka lini dari barcode yang discan operator.
   *
   * Barcode lini hanya memuat kodenya (mis. "DCAA01"). Yang diperiksa di sini
   * ada tiga, dan ketiganya menolak dengan sebab yang berbeda supaya operator
   * tahu tindakannya:
   *
   *   1. Lini itu ada dan aktif
   *   2. Lini itu memang bagian dari grup yang sedang dibuka
   *   3. Role orangnya boleh men-scan di situ
   *
   * Pemeriksaan ketiga ada DI SERVER, bukan hanya di layar: endpoint scan bisa
   * dipanggil langsung, dan pembatasan yang hanya ada di browser bukan
   * pembatasan.
   */
  async bukaLini(kode: string, grup: string, principal?: Principal) {
    const g = grup.toUpperCase() as Parameters<typeof prosesDalamGrup>[0];
    const bersih = kode.trim();

    const [line] = await this.db
      .select()
      .from(lines)
      .where(and(eq(lines.code, bersih), eq(lines.isActive, true)))
      .limit(1);

    /*
     * BadRequestException, bukan ScanRejected.
     *
     * ScanRejected adalah Error biasa: Nest menjadikannya 500 dan operator
     * membaca "terjadi kesalahan pada server" — padahal sebabnya jelas dan
     * tindakannya ada di tangannya. Di station() ia ditangkap dan dipetakan,
     * di sini tidak ada yang menangkapnya.
     */
    if (!line) {
      throw new BadRequestException(`${REJECT_MESSAGES.LINE_NOT_FOUND} (${bersih})`);
    }

    if (grupProses(line.processType) !== g) {
      throw new BadRequestException(
        `Lini ${bersih} bukan lini ${PROCESS_GROUP_LABELS[g] ?? grup}. Periksa barcode lininya.`,
      );
    }

    if (principal?.kind === 'user') {
      /*
       * Jabatan dibaca dari DATABASE, bukan dari salinan di dalam token.
       *
       * Token memuat salinan pada saat login dan berlaku delapan jam. Salinan
       * itu basi dalam dua keadaan yang dua-duanya nyata: role orangnya diubah
       * siang ini, atau token diterbitkan API versi lama yang belum menyertakan
       * jabatan sama sekali.
       *
       * Yang kedua pernah terjadi di layar pengaturan: administrator sungguhan
       * dilempar kembali ke dashboard karena tokennya tidak menyebut jabatan
       * apa pun. Di sini akibatnya jauh lebih mahal — `?? 'VIEW'` membuat lasman
       * dengan token lama ditolak membuka lininya sendiri dengan pesan "tidak
       * berwenang", dan satu lini berhenti berproduksi sampai ada yang menebak
       * bahwa keluar-masuk lagi adalah jalan keluarnya.
       *
       * Dibaca sekali saat membuka lini, bukan tiap scan — biayanya satu query
       * per shift.
       */
      const [aku] = await this.db
        .select({ kind: roles.kind, processGroup: roles.processGroup, aktif: roles.isActive })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.id, principal.sub))
        .limit(1);

      if (!aku?.kind || !aku.aktif) {
        throw new ForbiddenException(
          'Akun Anda belum punya role yang aktif. Hubungi administrator.',
        );
      }

      const boleh = bolehScanDi(
        { kind: aku.kind, processGroup: aku.processGroup },
        line.processType,
      );
      if (!boleh) {
        throw new ForbiddenException(
          `Role Anda tidak berwenang men-scan di lini ${bersih}. Hubungi leader.`,
        );
      }
    }

    // Ringkasan ikut dikirim supaya layar tidak perlu permintaan kedua.
    return this.summary(line.code);
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
