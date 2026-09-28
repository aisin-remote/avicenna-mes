import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  eq, and, isNull, isNotNull, desc, gte, lt, count, inArray, type Database,
} from '@avicenna/db';
import {
  ngMasters, ngRecords, scanEvents, lines, parts, plants, mutations,
  kanbans, kanbanItems, kanbanEvents,
} from '@avicenna/db';
import {
  bacaBarcode,
  BarcodeTidakDikenali,
  bacaKanban,
  KanbanTidakTerbaca,
  signedQty,
  productionDayWindow,
  grupProses,
  jenisNgUntukGrup,
  bacaGrupProses,
  kunciNgAktif,
  perluMembalikProduksi,
  sumberSah,
  NgTidakSah,
  NG_REJECT_MESSAGES,
  type NgRejectReason,
} from '@avicenna/domain';
import type {
  NgInlineInput, NgOutlineInput, NgCancelInput, NgResult, NgOnUnit, NgOrigin, NgSource,
  ProcessType,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { ScanService } from '../scan/scan.service';
import type { Principal } from '../auth/auth.types';

/** Penolakan yang punya sebab jelas — bukan kegagalan teknis. Lihat ScanRejected. */
export class NgRejected extends Error {
  constructor(
    readonly reason: NgRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'NgRejected';
  }
}

/** MySQL: pelanggaran UNIQUE index. */
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';
const ER_DUP_ENTRY_ERRNO = 1062;

/** Satu barang yang akan dicatat NG. */
interface Sasaran {
  /** Isi barcode yang discan, apa adanya. */
  rawCode: string;
  /** Identitas barangnya. Untuk NG lewat kanban, seri unit yang menempel. */
  serialNumber: string;
  /** Scan produksi yang menempelkannya — bila diketahui. */
  scanEventId: number | null;
  /** Lini tempat scan produksi itu terjadi — penentu SLOC saat dibalik. */
  scanLineId: number | null;
  processType: ProcessType | null;
}

@Injectable()
export class NgService {
  private readonly logger = new Logger(NgService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly scan: ScanService,
  ) {}

  /* ──────────────────────────────────────────────────────────────────────────
   * MASTER — isi tombol di layar
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Jenis NG yang muncul di layar sebuah grup proses.
   *
   * Disaring ke pabrik pengguna. Jenis NG pabrik lain di layar hanya memperbesar
   * peluang salah tekan, dan angka NG yang tercatat di bawah jenis milik pabrik
   * lain tidak akan pernah muncul di laporan mana pun.
   */
  async jenis(grupRaw?: string | null, principal?: Principal) {
    const grup = bacaGrupProses(grupRaw);

    const rows = await this.db
      .select({
        id: ngMasters.id,
        code: ngMasters.code,
        name: ngMasters.name,
        processGroup: ngMasters.processGroup,
        category: ngMasters.category,
        sortOrder: ngMasters.sortOrder,
      })
      .from(ngMasters)
      .where(
        and(
          eq(ngMasters.isActive, '1'),
          ...(principal?.plantId ? [eq(ngMasters.plantId, principal.plantId)] : []),
        ),
      )
      .orderBy(ngMasters.sortOrder, ngMasters.name);

    return { grup, jenis: jenisNgUntukGrup(rows, grup) };
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * PENCATATAN
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * NG inline — ketemu di lini, barangnya di tangan operator.
   *
   * Lini WAJIB: NG inline selalu terjadi di suatu lini, dan lini itu yang
   * menentukan proses mana yang dibalik. Tanpanya, NG di lini Machining bisa
   * membalik produksi Casting barang yang sama.
   */
  async inline(input: NgInlineInput, principal?: Principal): Promise<NgResult> {
    const waktu = input.occurredAt ?? new Date();

    const line = await this.line(input.lineCode);
    if (!line) {
      throw new NgRejected('LINE_NOT_FOUND', `${NG_REJECT_MESSAGES.LINE_NOT_FOUND} (${input.lineCode})`);
    }

    const jenisNg = await this.jenisNg(input.ngMasterId, line.plantId, line.processType);
    const { part, sasaran } = await this.dariPartCode(
      input.rawCode,
      line.plantId,
      line.processType,
    );

    return this.catat({
      plantId: line.plantId,
      part,
      lineId: line.id,
      processType: line.processType,
      jenisNg,
      origin: 'INLINE',
      source: 'PART_CODE',
      sasaran: [sasaran],
      qtyPerUnit: input.qty,
      waktu,
      npk: input.npk,
      principal,
      rawCode: input.rawCode,
    });
  }

  /**
   * NG outline — ketemu di luar lini: di rak, saat audit, saat mau dikirim.
   *
   * Barangnya dikenali lewat part code ATAU lewat kanban, dan `via` menentukan
   * yang mana. Tidak ditebak dari bentuk barcode-nya: kartu kanban yang
   * kebetulan lolos dibaca sebagai part code akan menyatakan satu pcs NG padahal
   * satu box yang bermasalah — sisanya tetap terkirim ke customer.
   */
  async outline(input: NgOutlineInput, principal?: Principal): Promise<NgResult> {
    const waktu = input.occurredAt ?? new Date();

    if (!sumberSah('OUTLINE', input.via)) {
      throw new NgRejected('SOURCE_NOT_ALLOWED', NG_REJECT_MESSAGES.SOURCE_NOT_ALLOWED);
    }

    const line = input.lineCode ? await this.line(input.lineCode) : undefined;
    if (input.lineCode && !line) {
      throw new NgRejected('LINE_NOT_FOUND', `${NG_REJECT_MESSAGES.LINE_NOT_FOUND} (${input.lineCode})`);
    }

    const plantAwal = line?.plantId ?? principal?.plantId ?? undefined;

    if (input.via === 'KANBAN') {
      return this.outlineKanban(input, plantAwal, line?.id ?? null, waktu, principal);
    }

    const { part, sasaran } = await this.dariPartCode(
      input.rawCode,
      plantAwal,
      line?.processType ?? null,
    );
    const jenisNg = await this.jenisNg(
      input.ngMasterId,
      part.plantId,
      sasaran.processType ?? line?.processType ?? null,
    );

    return this.catat({
      plantId: part.plantId,
      part,
      lineId: line?.id ?? sasaran.scanLineId,
      processType: sasaran.processType ?? line?.processType ?? null,
      jenisNg,
      origin: 'OUTLINE',
      source: 'PART_CODE',
      sasaran: [sasaran],
      qtyPerUnit: input.qty,
      waktu,
      npk: input.npk,
      principal,
      rawCode: input.rawCode,
    });
  }

  /**
   * NG outline lewat kanban — SELURUH isi kartu gugur, bukan satu barang.
   *
   * Mengikuti perilaku sistem lama, yang mengosongkan `code_part` dan
   * `code_part_2` sekaligus: kartu yang barangnya bermasalah dikembalikan ke
   * lini untuk diisi ulang, bukan dikirim sebagian.
   *
   * Yang TIDAK diikuti: sistem lama tidak mencatat jenis NG-nya sama sekali di
   * jalur ini — hanya menandai `status = 0`. Akibatnya NG yang ketemu belakangan
   * tidak pernah muncul di grafik NG, dan penyebab yang berulang tidak terlihat.
   */
  private async outlineKanban(
    input: NgOutlineInput,
    plantAwal: number | undefined,
    lineId: number | null,
    waktu: Date,
    principal?: Principal,
  ): Promise<NgResult> {
    let kb;
    try {
      kb = bacaKanban(input.rawCode, { processType: null });
    } catch (err) {
      if (err instanceof KanbanTidakTerbaca) {
        throw new NgRejected('KANBAN_UNREADABLE', NG_REJECT_MESSAGES.KANBAN_UNREADABLE);
      }
      throw err;
    }

    const kartu = await this.kartuKanban(kb.serialNumber ?? '', kb.backNumber, plantAwal);

    const isi = await this.db
      .select({
        serialNumber: kanbanItems.serialNumber,
        scanEventId: kanbanItems.scanEventId,
      })
      .from(kanbanItems)
      .where(eq(kanbanItems.kanbanId, kartu.id));

    if (isi.length === 0) {
      throw new NgRejected(
        'KANBAN_EMPTY',
        `${NG_REJECT_MESSAGES.KANBAN_EMPTY} (seri ${kartu.serialNumber})`,
      );
    }

    const part = await this.partById(kartu.partId);
    if (!part) {
      throw new NgRejected('PART_NOT_RECOGNIZED', NG_REJECT_MESSAGES.PART_NOT_RECOGNIZED);
    }

    /*
     * Scan produksi tiap unit dipakai untuk dua hal: menentukan proses mana yang
     * dibalik, dan SLOC mana yang dikurangi. Diambil dari TT_KANBAN_ITEM yang
     * memang menyimpan scan penempelnya — bukan dicari ulang lewat barcode,
     * yang bisa menemukan scan proses lain pada barang yang sama.
     */
    const scanIds = isi.map((i) => i.scanEventId).filter((v): v is number => v != null);
    const scanRows = scanIds.length
      ? await this.db
          .select({
            id: scanEvents.id,
            lineId: scanEvents.lineId,
            processType: scanEvents.processType,
          })
          .from(scanEvents)
          .where(inArray(scanEvents.id, scanIds))
      : [];
    const perScan = new Map(scanRows.map((r) => [r.id, r]));

    const sasaran: Sasaran[] = isi.map((i) => {
      const s = i.scanEventId != null ? perScan.get(i.scanEventId) : undefined;
      return {
        rawCode: input.rawCode,
        serialNumber: i.serialNumber,
        scanEventId: i.scanEventId ?? null,
        scanLineId: s?.lineId ?? null,
        processType: (s?.processType as ProcessType | null) ?? null,
      };
    });

    /*
     * Lingkup jenis NG diperiksa terhadap proses unit yang menempel, bukan
     * dilewati begitu saja.
     *
     * Seluruh isi satu kartu datang dari lini FG yang sama, jadi prosesnya
     * tunggal dan bisa diperiksa. Tanpa ini, jenis NG milik Injection bisa
     * dicapkan ke kartu hasil casting, dan laporan NG per proses menghitung
     * kerusakan yang tidak mungkin terjadi di situ.
     */
    const prosesKartu = sasaran.find((s) => s.processType)?.processType ?? null;
    const jenisNg = await this.jenisNg(input.ngMasterId, kartu.plantId, prosesKartu);

    return this.catat({
      plantId: kartu.plantId,
      part,
      lineId,
      processType: prosesKartu,
      jenisNg,
      origin: 'OUTLINE',
      source: 'KANBAN',
      sasaran,
      /*
       * Satu pcs per unit yang menempel, BUKAN input.qty.
       *
       * Jumlahnya sudah ditentukan isi kartunya; mengalikannya dengan angka yang
       * diketik operator akan membuat satu box berisi 20 tercatat sebagai 40 NG.
       */
      qtyPerUnit: 1,
      waktu,
      npk: input.npk,
      principal,
      rawCode: input.rawCode,
      kanban: kartu,
    });
  }

  /**
   * Menulis catatan NG untuk sekumpulan barang, sekaligus dalam satu transaksi.
   *
   * Satu transaksi karena tiga hal harus terjadi bersamaan atau tidak sama
   * sekali: catatan NG, pembalikan stok, dan pengosongan kartu. Kartu yang
   * terlanjur kosong sementara NG-nya gagal tercatat akan membuat barang hilang
   * dari dua tempat sekaligus — dari kartu dan dari laporan NG.
   */
  private async catat(k: {
    plantId: number;
    part: typeof parts.$inferSelect;
    lineId: number | null;
    processType: ProcessType | null;
    jenisNg: { id: number; code: string; name: string };
    origin: NgOrigin;
    source: NgSource;
    sasaran: Sasaran[];
    qtyPerUnit: number;
    waktu: Date;
    npk?: string;
    principal?: Principal;
    rawCode: string;
    kanban?: { id: number; serialNumber: string };
  }): Promise<NgResult> {
    const userId = k.principal?.kind === 'user' ? k.principal.sub : null;
    const npk = k.npk ?? (k.principal?.kind === 'user' ? k.principal.npk : null);

    let dibalik = 0;
    let dicatat = 0;

    await this.db.transaction(async (tx) => {
      for (const s of k.sasaran) {
        const kunci = kunciNgAktif(s.serialNumber, k.jenisNg.id);

        /*
         * Sudah pernah dibalik?
         *
         * Satu barang bisa dicap beberapa jenis NG sekaligus — retak DAN kotor.
         * Tanpa pemeriksaan ini stoknya berkurang sekali untuk tiap jenis, dan
         * selisihnya menumpuk tanpa ada yang bisa menjelaskannya.
         */
        const [pernahDibalik] = await tx
          .select({ id: ngRecords.id })
          .from(ngRecords)
          .where(
            and(
              eq(ngRecords.serialNumber, s.serialNumber),
              isNull(ngRecords.cancelledAt),
              isNotNull(ngRecords.scanEventId),
            ),
          )
          .limit(1);

        const balik = perluMembalikProduksi({
          adaScanProduksi: s.scanEventId != null,
          sudahPernahDibalik: Boolean(pernahDibalik),
        });

        let ngId: number;
        try {
          const hasil = await tx.insert(ngRecords).values({
            plantId: k.plantId,
            partId: k.part.id,
            lineId: k.lineId,
            processType: s.processType ?? k.processType,
            ngMasterId: k.jenisNg.id,
            origin: k.origin,
            source: k.source,
            rawCode: s.rawCode,
            serialNumber: s.serialNumber,
            kanbanId: k.kanban?.id ?? null,
            // Hanya diisi bila produksinya benar-benar dibalik di sini —
            // kolom ini yang dibaca sebagai "sudah pernah dibalik".
            scanEventId: balik ? s.scanEventId : null,
            qty: k.qtyPerUnit,
            occurredAt: k.waktu,
            npk,
            userId,
            activeKey: kunci,
            meta: { jenisNg: k.jenisNg.code },
          });
          ngId = Number((hasil as unknown as Array<{ insertId: number }>)[0]?.insertId);
        } catch (err) {
          if (isDuplicateKey(err)) {
            /*
             * Barang ini sudah bercap NG jenis yang sama.
             *
             * Untuk satu barang itu penolakan yang benar. Untuk satu kartu berisi
             * 20, menghentikan seluruhnya berarti 19 barang lain tidak tercatat —
             * karena itu di sini hanya dilewati, dan yang lain tetap jalan.
             */
            if (k.sasaran.length === 1) {
              throw new NgRejected(
                'ALREADY_NG',
                `${NG_REJECT_MESSAGES.ALREADY_NG} (${k.jenisNg.name})`,
              );
            }
            this.logger.warn(
              `unit ${s.serialNumber} sudah bercap NG ${k.jenisNg.code} — dilewati`,
            );
            continue;
          }
          throw err;
        }

        dicatat += 1;

        if (balik) {
          /*
           * SLOC-nya diambil dari lini tempat scan produksinya terjadi, bukan
           * dari lini tempat NG-nya ditemukan. Barangnya menumpuk di gudang
           * keluaran lini pembuatnya; menguranginya dari gudang lain akan
           * membuat yang satu minus dan yang lain kelebihan.
           */
          const lokasi = await this.slocHasilScan(tx, s.scanEventId, s.scanLineId);

          await tx.insert(mutations).values({
            plantId: k.plantId,
            partId: k.part.id,
            lineId: s.scanLineId ?? k.lineId,
            locationId: lokasi,
            type: 'NG_OUT',
            qty: String(signedQty('NG_OUT', k.qtyPerUnit)),
            sourceTable: 'TT_NG',
            sourceId: ngId,
            npk,
            userId,
            occurredAt: k.waktu,
            note: `NG ${k.jenisNg.code} — ${k.jenisNg.name}`,
          });
          dibalik += k.qtyPerUnit;
        }
      }

      /*
       * Kartu dikosongkan SETELAH semua unitnya tercatat.
       *
       * TT_KANBAN_ITEM memang dihapus saat kartu dikosongkan — riwayatnya ada di
       * TT_KANBAN_EVENT yang append-only. Yang baru ditulis di atas menyimpan
       * seri tiap unit, jadi isinya tidak hilang dari catatan.
       */
      if (k.kanban) {
        await tx.delete(kanbanItems).where(eq(kanbanItems.kanbanId, k.kanban.id));
        await tx.insert(kanbanEvents).values({
          kanbanId: k.kanban.id,
          type: 'VOIDED',
          lineId: k.lineId,
          qty: dicatat,
          userId,
          deviceId: k.principal?.kind === 'device' ? k.principal.sub : null,
          occurredAt: k.waktu,
          meta: {
            jenisNg: k.jenisNg.code,
            unit: k.sasaran.map((s) => s.serialNumber),
          },
        });
        // Kartunya sendiri tetap sah dan kembali ke lini untuk diisi ulang.
        await tx
          .update(kanbans)
          .set({ status: 'CREATED', producedAt: null })
          .where(eq(kanbans.id, k.kanban.id));
      }
    });

    const unitUtama = k.sasaran[0]?.serialNumber ?? k.rawCode;

    return {
      status: 'ACCEPTED',
      message: k.kanban
        ? `Kanban ${k.kanban.serialNumber} digugurkan — ${dicatat} pcs NG ${k.jenisNg.name}.`
        : `NG ${k.jenisNg.name} tercatat.`,
      rawCode: k.rawCode,
      partNumber: k.part.partNumber,
      partName: k.part.name,
      processType: k.processType,
      qty: dicatat * k.qtyPerUnit,
      dibalik,
      kanbanDikosongkan: k.kanban?.serialNumber ?? null,
      ngAktif: await this.ngPadaUnit(unitUtama),
      ngHariIni: await this.hitungHariIni(k.lineId),
      occurredAt: k.waktu.toISOString(),
    };
  }

  /**
   * Membatalkan catatan NG — pengganti tombol "klik lagi untuk menghapus".
   *
   * Sistem lama benar-benar menghapus barisnya (`$partNg->delete()`), sehingga
   * salah tekan tidak meninggalkan jejak sama sekali dan angka NG kemarin bisa
   * berubah tanpa ada yang tahu. Di sini barisnya tetap ada, hanya ditandai.
   *
   * Pembalikan stoknya ikut dibatalkan dengan mutasi baru bertanda sebaliknya,
   * bukan dengan menghapus mutasi lama — buku besar tidak pernah dihapus.
   */
  async batal(input: NgCancelInput, principal?: Principal) {
    const [row] = await this.db
      .select()
      .from(ngRecords)
      .where(eq(ngRecords.id, input.id))
      .limit(1);

    if (!row) throw new NotFoundException(NG_REJECT_MESSAGES.NOT_FOUND);
    if (row.cancelledAt) {
      throw new BadRequestException(NG_REJECT_MESSAGES.ALREADY_CANCELLED);
    }

    const userId = principal?.kind === 'user' ? principal.sub : null;
    const waktu = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(ngRecords)
        .set({
          cancelledAt: waktu,
          cancelledById: userId,
          cancelReason: input.reason ?? null,
          // Dikosongkan supaya barang yang sama bisa dicatat NG lagi — inilah
          // yang membuat unique index "unik selama aktif" bekerja.
          activeKey: null,
        })
        .where(eq(ngRecords.id, row.id));

      if (row.scanEventId) {
        const lokasi = await this.slocHasilScan(tx, row.scanEventId, row.lineId);
        await tx.insert(mutations).values({
          plantId: row.plantId,
          partId: row.partId,
          lineId: row.lineId,
          locationId: lokasi,
          type: 'ADJUSTMENT',
          // Kebalikan dari NG_OUT: barang yang dikira rusak ternyata baik.
          qty: String(row.qty),
          sourceTable: 'TT_NG',
          sourceId: row.id,
          npk: principal?.kind === 'user' ? principal.npk : null,
          userId,
          occurredAt: waktu,
          note: `Pembatalan NG #${row.id}${input.reason ? ` — ${input.reason}` : ''}`,
        });
      }
    });

    return {
      id: row.id,
      cancelledAt: waktu.toISOString(),
      ngAktif: await this.ngPadaUnit(row.serialNumber ?? row.rawCode),
    };
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * BACAAN
   * ────────────────────────────────────────────────────────────────────────── */

  /** NG yang sedang menempel pada sebuah barang — isi panel kanan layar operator. */
  async ngPadaUnit(unit: string): Promise<NgOnUnit[]> {
    const bersih = unit.trim();
    if (!bersih) return [];

    const rows = await this.db
      .select({
        id: ngRecords.id,
        ngMasterId: ngRecords.ngMasterId,
        ngCode: ngMasters.code,
        ngName: ngMasters.name,
        qty: ngRecords.qty,
        origin: ngRecords.origin,
        source: ngRecords.source,
        occurredAt: ngRecords.occurredAt,
        npk: ngRecords.npk,
      })
      .from(ngRecords)
      .leftJoin(ngMasters, eq(ngRecords.ngMasterId, ngMasters.id))
      .where(and(eq(ngRecords.serialNumber, bersih), isNull(ngRecords.cancelledAt)))
      .orderBy(desc(ngRecords.occurredAt));

    return rows.map((r) => ({
      ...r,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }

  /**
   * Barang + NG yang menempel padanya — dipanggil saat operator men-scan part
   * code di layar NG, sebelum ia memilih jenisnya.
   */
  async periksaUnit(rawCode: string, lineCode?: string, principal?: Principal) {
    const line = lineCode ? await this.line(lineCode) : undefined;
    const plantId = line?.plantId ?? principal?.plantId ?? undefined;

    const { part, sasaran } = await this.dariPartCode(
      rawCode,
      plantId,
      line?.processType ?? null,
    );

    return {
      rawCode,
      partNumber: part.partNumber,
      partName: part.name,
      serialNumber: sasaran.serialNumber,
      /*
       * Apakah barangnya pernah tercatat sebagai hasil baik.
       *
       * Ditampilkan supaya operator tahu lebih dulu bahwa mencapnya NG akan
       * mengurangi stok — bukan mengetahuinya setelah angka produksinya turun.
       */
      adaScanProduksi: sasaran.scanEventId != null,
      processType: sasaran.processType ?? line?.processType ?? null,
      ngAktif: await this.ngPadaUnit(sasaran.serialNumber),
    };
  }

  /* ──────────────────────────────────────────────────────────────────────────
   * PEMBANTU
   * ────────────────────────────────────────────────────────────────────────── */

  /**
   * Mengenali barang dari part code, DAN mencari scan produksi terakhirnya.
   *
   * Pengenalan partnya memakai ScanService — jalur yang sama persis dengan scan
   * produksi. Menyalinnya ke sini akan membuat barang yang dikenali saat discan
   * baik bisa jadi tidak dikenali saat dinyatakan NG.
   */
  private async dariPartCode(
    rawCode: string,
    plantId: number | undefined,
    processType: ProcessType | null,
  ): Promise<{ part: typeof parts.$inferSelect; sasaran: Sasaran }> {
    let parsed;
    try {
      parsed = bacaBarcode(rawCode, { processType });
    } catch (err) {
      if (err instanceof BarcodeTidakDikenali) {
        throw new NgRejected('PART_NOT_RECOGNIZED', NG_REJECT_MESSAGES.PART_NOT_RECOGNIZED);
      }
      throw err;
    }

    const { part } = await this.scan.kenaliPart(parsed, plantId);
    if (!part) {
      const sebab = parsed.programCode
        ? `program number "${parsed.programCode}" belum terdaftar di master`
        : `part "${parsed.partNumber ?? parsed.backNumber ?? rawCode}" tidak ada di master`;
      throw new NgRejected(
        'PART_NOT_RECOGNIZED',
        `${NG_REJECT_MESSAGES.PART_NOT_RECOGNIZED} (${sebab})`,
      );
    }

    /*
     * Scan produksi yang dibalik.
     *
     * Bila prosesnya diketahui (NG di lini), dicari scan pada proses ITU —
     * barang yang sama punya scan di beberapa proses, dan membalik yang keliru
     * akan mengurangi stok di gudang yang salah.
     *
     * Bila prosesnya tidak diketahui (NG di rak), diambil yang TERAKHIR: itulah
     * keadaan barangnya sekarang, dan gudang tempat ia sebenarnya menumpuk.
     */
    const [scanProduksi] = await this.db
      .select({
        id: scanEvents.id,
        lineId: scanEvents.lineId,
        processType: scanEvents.processType,
      })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.rawCode, rawCode),
          eq(scanEvents.kind, 'PRODUCTION'),
          ...(processType ? [eq(scanEvents.processType, processType)] : []),
        ),
      )
      .orderBy(desc(scanEvents.scannedAt))
      .limit(1);

    return {
      part,
      sasaran: {
        rawCode,
        serialNumber: parsed.serialNumber ?? rawCode,
        scanEventId: scanProduksi?.id ?? null,
        scanLineId: scanProduksi?.lineId ?? null,
        processType: (scanProduksi?.processType as ProcessType | null) ?? processType,
      },
    };
  }

  /**
   * Jenis NG, diperiksa terhadap pabrik dan prosesnya.
   *
   * Keduanya diperiksa DI SERVER, bukan hanya dengan menyaring tombol di layar:
   * endpoint-nya bisa dipanggil langsung, dan penyaringan yang hanya ada di
   * browser bukan penyaringan.
   */
  private async jenisNg(id: number, plantId: number, processType: ProcessType | null) {
    const [row] = await this.db.select().from(ngMasters).where(eq(ngMasters.id, id)).limit(1);

    if (!row || row.isActive !== '1') {
      throw new NgRejected('NG_TYPE_UNKNOWN', `${NG_REJECT_MESSAGES.NG_TYPE_UNKNOWN} (id ${id})`);
    }
    if (row.plantId !== plantId) {
      throw new NgRejected('NG_TYPE_WRONG_PLANT', NG_REJECT_MESSAGES.NG_TYPE_WRONG_PLANT);
    }
    // Lingkup kosong berarti berlaku di semua proses — padanan tombol "DLL".
    if (row.processGroup && processType && row.processGroup !== grupProses(processType)) {
      throw new NgRejected(
        'NG_TYPE_WRONG_PROCESS',
        `${NG_REJECT_MESSAGES.NG_TYPE_WRONG_PROCESS} (${row.name} untuk ${row.processGroup})`,
      );
    }
    return row;
  }

  /**
   * Kartu kanban dari seri + back number.
   *
   * Seri TIDAK unik antar part — "1001" ada pada beberapa part sekaligus. Back
   * number di kartu yang memisahkannya; tanpa itu, kartu yang ketemu bisa milik
   * part lain dan satu box barang baik ikut digugurkan.
   */
  private async kartuKanban(seri: string, backNumber: string | undefined, plantId?: number) {
    if (!seri) {
      throw new NgRejected('KANBAN_UNREADABLE', NG_REJECT_MESSAGES.KANBAN_UNREADABLE);
    }

    const cocok = await this.db
      .select({
        id: kanbans.id,
        plantId: kanbans.plantId,
        partId: kanbans.partId,
        serialNumber: kanbans.serialNumber,
        backNumber: parts.backNumber,
      })
      .from(kanbans)
      .leftJoin(parts, eq(kanbans.partId, parts.id))
      .where(
        and(
          eq(kanbans.serialNumber, seri),
          eq(kanbans.isActive, true),
          ...(plantId ? [eq(kanbans.plantId, plantId)] : []),
        ),
      );

    const terpilih = backNumber ? cocok.filter((c) => c.backNumber === backNumber) : cocok;

    if (terpilih.length === 0) {
      throw new NgRejected(
        'KANBAN_NOT_REGISTERED',
        `${NG_REJECT_MESSAGES.KANBAN_NOT_REGISTERED} (seri ${seri}${backNumber ? `, ${backNumber}` : ''})`,
      );
    }
    const satu = terpilih[0];
    if (terpilih.length > 1 || !satu) {
      /*
       * Lebih dari satu kartu berseri sama dan tidak ada back number yang
       * memisahkannya. Memilih yang pertama berarti menggugurkan box milik part
       * yang belum tentu benar — lebih baik berhenti dan minta scan ulang.
       */
      throw new NgRejected(
        'KANBAN_NOT_REGISTERED',
        `Seri ${seri} ada pada ${terpilih.length} part. Scan kartu yang memuat back number.`,
      );
    }
    return satu;
  }

  /** Setelah transfer otomatis, barang ada di tujuan transfer, bukan output lini. */
  private async slocHasilScan(
    tx: Database,
    scanEventId: number | null,
    lineId: number | null,
  ): Promise<number | null> {
    if (scanEventId) {
      const [scan] = await tx.select({ meta: scanEvents.meta }).from(scanEvents)
        .where(eq(scanEvents.id, scanEventId)).limit(1);
      const rute = (scan?.meta as { sapRoute?: {
        transferLocationId?: number | null; outputLocationId?: number | null;
      } } | null)?.sapRoute;
      const lokasi = rute?.transferLocationId ?? rute?.outputLocationId;
      if (lokasi) return lokasi;
    }
    if (!lineId) return null;
    const [row] = await tx
      .select({ locationId: lines.outputLocationId })
      .from(lines)
      .where(eq(lines.id, lineId))
      .limit(1);
    return row?.locationId ?? null;
  }

  private async line(code: string) {
    const [row] = await this.db
      .select()
      .from(lines)
      .where(eq(lines.code, code.trim()))
      .limit(1);
    return row;
  }

  private async partById(id: number) {
    const [row] = await this.db.select().from(parts).where(eq(parts.id, id)).limit(1);
    return row;
  }

  /** NG yang tercatat hari produksi berjalan pada sebuah lini. */
  private async hitungHariIni(lineId: number | null): Promise<number> {
    if (!lineId) return 0;
    // Jendela HARI PRODUKSI (07:00 -> 07:00), bukan hari kalender: penghitung
    // di layar shift malam tidak boleh berhenti bertambah saat lewat tengah malam.
    const { start, end } = productionDayWindow(new Date());

    const [row] = await this.db
      .select({ value: count() })
      .from(ngRecords)
      .where(
        and(
          eq(ngRecords.lineId, lineId),
          isNull(ngRecords.cancelledAt),
          gte(ngRecords.occurredAt, start),
          lt(ngRecords.occurredAt, end),
        ),
      );
    return row?.value ?? 0;
  }
}

/** Lihat isDuplicateKey di scan.service.ts — Drizzle membungkus error driver. */
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
