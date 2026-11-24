import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MENU_KOREKSI_NG } from '@avicenna/contracts';
import {
  eq,
  and,
  isNull,
  isNotNull,
  desc,
  gte,
  lt,
  count,
  inArray,
  or,
  sql,
  ne,
  type Database,
} from '@avicenna/db';
import {
  ngMasters,
  ngRecords,
  scanEvents,
  lines,
  parts,
  plants,
  mutations,
  locations,
  kanbans,
  kanbanItems,
  kanbanEvents,
  partProcesses,
  sapOutbox,
  ngRevisions,
  users,
  menus,
  roleMenus,
} from '@avicenna/db';
import { galatDuplikat } from '@avicenna/db';
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
  NgKoreksiInput,
  NgKoreksiBaris,
  NgKoreksiDaftar,
  NgSapKeadaan,
  NgInlineInput,
  NgOutlineInput,
  NgCancelInput,
  NgResult,
  NgOnUnit,
  NgOrigin,
  NgSource,
  ProcessType,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { ProcessTypeService } from '../master/process-type.service';
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
    private readonly processTypes: ProcessTypeService,
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
    const katalog = await this.processTypes.katalog();
    const grup = bacaGrupProses(
      grupRaw,
      katalog.grupDaftar.map((g) => g.code),
    );

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
      throw new NgRejected(
        'LINE_NOT_FOUND',
        `${NG_REJECT_MESSAGES.LINE_NOT_FOUND} (${input.lineCode})`,
      );
    }

    const jenisNg = await this.jenisNg(input.ngMasterId, line.plantId, line.processType);
    const { part, sasaran } = await this.dariPartCode(
      input.rawCode,
      line.plantId,
      line.processType,
      line.id,
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
      throw new NgRejected(
        'LINE_NOT_FOUND',
        `${NG_REJECT_MESSAGES.LINE_NOT_FOUND} (${input.lineCode})`,
      );
    }

    const plantAwal = line?.plantId ?? principal?.plantId ?? undefined;

    if (input.via === 'KANBAN') {
      return this.outlineKanban(input, plantAwal, line?.id ?? null, waktu, principal);
    }

    const { part, sasaran } = await this.dariPartCode(
      input.rawCode,
      plantAwal,
      line?.processType ?? null,
      line?.id,
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
          const hasil = await tx
            .insert(ngRecords)
            .values({
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
            })
            .returning({ id: ngRecords.id });
          ngId = Number(hasil[0]?.id);
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
            this.logger.warn(`unit ${s.serialNumber} sudah bercap NG ${k.jenisNg.code} — dilewati`);
            continue;
          }
          throw err;
        }

        dicatat += 1;

        /*
         * Kasus A — NG pada barang yang TIDAK pernah tercatat produksi.
         *
         * Tidak ada baris OK di SAP untuk barang ini, jadi NG-nya dikirim
         * sebagai baris hasil produksi sendiri (OK 0, NG = qty); FM
         * ZFM_WDE_PROD_RESULT_NG membukukannya ke SLOC reject dari PV.
         * Barang yang PERNAH diproduksi ikut baris produksinya (kasus B) atau
         * masuk daftar koreksi (kasus C) — lihat StagingPushService.
         */
        const rejek = await this.slocReject(tx, k.plantId);
        const catatMasukRe = async () => {
          if (!rejek) return;
          await tx.insert(mutations).values({
            plantId: k.plantId,
            partId: k.part.id,
            lineId: k.lineId,
            locationId: rejek,
            /*
             * NG_OUT bertanda POSITIF: barang NG masuk SLOC reject.
             *
             * Sengaja bukan TRANSFER_IN/ADJUSTMENT — keduanya dipetakan ke
             * dokumen SAP (311/309), padahal SAP sendiri yang membukukan RE
             * dari INT_TOTAL_NG. NG_OUT dipetakan ke SCRAP yang tidak dikirim.
             */
            type: 'NG_OUT',
            qty: String(k.qtyPerUnit),
            sourceTable: 'TT_NG',
            sourceId: ngId,
            npk,
            userId,
            occurredAt: k.waktu,
            note: `NG ${k.jenisNg.code} masuk SLOC reject`,
          });
        };

        if (s.scanEventId == null) {
          const kirim = await this.outboxNgTanpaProduksi(tx, { ...k, ngId, serialNumber: s.serialNumber });
          // Kasus A: barang belum pernah tercatat di stok — hanya masuk RE.
          if (kirim) await catatMasukRe();
        }

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
          // Pindah, bukan hilang: yang keluar dari SLOC hasil masuk SLOC reject.
          await catatMasukRe();
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
          .set({ status: 'AVAILABLE', producedAt: null })
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
   * Sejak 19 Nov 2026 pembatalan = koreksi ke qty 0: stok dan SAP-nya
   * ditangani jalur yang sama dengan koreksi leader/QC, dan tercatat di
   * TT_NG_REVISION. Operator tetap boleh membatalkan NG yang ia catat.
   */
  async batal(input: NgCancelInput, principal?: Principal) {
    const row = await this.ngAktif(input.id);
    await this.terapkanKoreksi(row, { qty: 0, alasan: input.reason?.trim() || 'Dibatalkan' }, principal);
    return {
      id: row.id,
      cancelledAt: new Date().toISOString(),
      ngAktif: await this.ngPadaUnit(row.serialNumber ?? row.rawCode),
    };
  }

  /**
   * Koreksi NG oleh leader/QC: ubah qty, ubah jenis, atau batalkan (qty 0).
   *
   * Hak diberikan lewat menu "Koreksi NG" di Role (MENU_KOREKSI_NG), bukan
   * nama role — role leader yang dibuat nanti cukup dicentang.
   */
  async koreksi(id: number, input: NgKoreksiInput, principal?: Principal) {
    if (!(await this.bolehKoreksi(principal))) {
      throw new ForbiddenException('Koreksi NG hanya untuk leader dan QC (menu Koreksi NG di Role).');
    }
    const row = await this.ngAktif(id);
    await this.terapkanKoreksi(row, input, principal);
    const [hasil] = (await this.daftarKoreksi({ id }, principal)).data;
    return hasil;
  }

  private async ngAktif(id: number) {
    const [row] = await this.db.select().from(ngRecords).where(eq(ngRecords.id, id)).limit(1);
    if (!row) throw new NotFoundException(NG_REJECT_MESSAGES.NOT_FOUND);
    if (row.cancelledAt) throw new BadRequestException(NG_REJECT_MESSAGES.ALREADY_CANCELLED);
    return row;
  }

  /** ADMIN, atau role yang diberi menu Koreksi NG. */
  async bolehKoreksi(principal?: Principal): Promise<boolean> {
    if (principal?.kind !== 'user') return false;
    if (principal.roleKind === 'ADMIN') return true;
    const [ada] = await this.db
      .select({ id: menus.id })
      .from(users)
      .innerJoin(roleMenus, eq(roleMenus.roleId, users.roleId))
      .innerJoin(menus, eq(menus.id, roleMenus.menuId))
      .where(and(eq(users.id, principal.sub), eq(menus.key, MENU_KOREKSI_NG)))
      .limit(1);
    return Boolean(ada);
  }

  /**
   * Menerapkan satu koreksi: stok, catatan NG, jejak revisi, dan nasib SAP-nya.
   *
   * ── Stok ────────────────────────────────────────────────────────────────────
   * Mutasi milik NG ini (keluar dari SLOC hasil, masuk SLOC reject) diskalakan
   * ke qty baru dengan mutasi selisih — buku besar tidak pernah ditimpa. Qty 0
   * berarti seluruhnya dikembalikan. Jenisnya tetap NG_OUT: tidak terkirim ke
   * SAP (SAP mengoreksi lewat INT_TOTAL_NG_REV, bukan dokumen tersendiri).
   *
   * ── SAP ─────────────────────────────────────────────────────────────────────
   * Dokumen yang membawa NG ini belum terdorong → tidak perlu apa-apa, nilai
   * baru ikut saat didorong. Sudah di staging / diterima → revisi MENUNGGU,
   * didorong StagingPushService.dorongRevisiNg() sebagai CHR_STATUS_NG = 'R'.
   */
  private async terapkanKoreksi(
    row: typeof ngRecords.$inferSelect,
    input: { qty: number; ngMasterId?: number; alasan: string },
    principal?: Principal,
  ): Promise<void> {
    const userId = principal?.kind === 'user' ? principal.sub : null;
    const npk = principal?.kind === 'user' ? principal.npk : null;
    const waktu = new Date();
    const masterBaru = input.ngMasterId ?? Number(row.ngMasterId);
    const masterBerubah = masterBaru !== Number(row.ngMasterId);

    if (input.qty === row.qty && !masterBerubah) {
      throw new BadRequestException('Tidak ada yang berubah.');
    }
    if (masterBerubah) {
      const [m] = await this.db
        .select({ id: ngMasters.id, plantId: ngMasters.plantId })
        .from(ngMasters)
        .where(eq(ngMasters.id, masterBaru))
        .limit(1);
      if (!m || Number(m.plantId) !== Number(row.plantId)) {
        throw new BadRequestException('Jenis NG tidak dikenal untuk pabrik ini.');
      }
    }

    await this.db.transaction(async (tx) => {
      /* ── Stok: skalakan mutasi milik NG ini ke qty baru ─────────────────── */
      const milik = await tx
        .select()
        .from(mutations)
        .where(and(eq(mutations.sourceTable, 'TT_NG'), eq(mutations.sourceId, row.id)));
      const neto = new Map<string, { contoh: (typeof milik)[number]; qty: number }>();
      for (const m of milik) {
        const k = `${m.locationId}|${m.partId}|${m.lineId}`;
        const ada = neto.get(k);
        neto.set(k, { contoh: ada?.contoh ?? m, qty: (ada?.qty ?? 0) + Number(m.qty) });
      }
      for (const { contoh, qty } of neto.values()) {
        if (qty === 0 || row.qty === 0) continue;
        const selisih = (qty * input.qty) / row.qty - qty;
        if (selisih === 0) continue;
        await tx.insert(mutations).values({
          plantId: contoh.plantId,
          partId: contoh.partId,
          lineId: contoh.lineId,
          locationId: contoh.locationId,
          type: 'NG_OUT',
          qty: String(selisih),
          sourceTable: 'TT_NG',
          sourceId: row.id,
          npk,
          userId,
          occurredAt: waktu,
          note: `Koreksi NG #${row.id}: qty ${row.qty} → ${input.qty} — ${input.alasan}`,
        });
      }

      /* ── Catatan NG ────────────────────────────────────────────────────── */
      const set: Partial<typeof ngRecords.$inferInsert> = { qty: input.qty, ngMasterId: masterBaru };
      if (input.qty === 0) {
        Object.assign(set, {
          cancelledAt: waktu,
          cancelledById: userId,
          cancelReason: input.alasan,
          // Dikosongkan supaya barang yang sama bisa dicatat NG lagi.
          activeKey: null,
        });
      } else if (masterBerubah) {
        set.activeKey = kunciNgAktif(row.serialNumber ?? row.rawCode, masterBaru);
      }
      try {
        await tx.update(ngRecords).set(set).where(eq(ngRecords.id, row.id));
      } catch (err) {
        if (isDuplicateKey(err)) {
          throw new NgRejected('ALREADY_NG', NG_REJECT_MESSAGES.ALREADY_NG);
        }
        throw err;
      }

      /* ── Jejak dan nasib SAP ───────────────────────────────────────────── */
      const dok = await this.dokumenSapNg(tx as unknown as Database, row);
      const sudahDiSap = dok?.status === 'SENT' || dok?.status === 'CONFIRMED';
      await tx.insert(ngRevisions).values({
        ngId: row.id,
        qtyLama: row.qty,
        qtyBaru: input.qty,
        ngMasterLamaId: row.ngMasterId,
        ngMasterBaruId: masterBaru,
        alasan: input.alasan,
        userId,
        npk,
        outboxId: dok?.id ?? null,
        sapStatus: sudahDiSap ? 'MENUNGGU' : 'TIDAK_PERLU',
      });
    });
  }

  /**
   * Dokumen outbox yang MEMBAWA NG ini ke SAP, bila ada.
   *
   *   Kasus A  dokumen PRODUCTION bersumber TT_NG milik NG ini.
   *   Kasus B  dokumen PRODUCTION scan-nya yang sudah memasukkan NG ini
   *            (payload.ngTermasuk, diisi saat didorong).
   *
   * Dokumen scan yang belum memasukkannya (belum didorong, atau kasus C)
   * bukan pembawa — nilai NG terbaru ikut saat didorong, atau tidak pernah.
   */
  private async dokumenSapNg(db: Database, row: typeof ngRecords.$inferSelect) {
    const [a] = await db
      .select({ id: sapOutbox.id, status: sapOutbox.status, stagingNumber: sapOutbox.stagingNumber })
      .from(sapOutbox)
      .where(
        and(
          eq(sapOutbox.sourceTable, 'TT_NG'),
          eq(sapOutbox.sourceId, row.id),
          eq(sapOutbox.docType, 'PRODUCTION'),
        ),
      )
      .limit(1);
    if (a) return a;
    if (!row.scanEventId) return null;
    const [b] = await db
      .select({ id: sapOutbox.id, status: sapOutbox.status, stagingNumber: sapOutbox.stagingNumber })
      .from(sapOutbox)
      .where(
        and(
          eq(sapOutbox.sourceTable, 'TT_HISTORY_SCAN'),
          eq(sapOutbox.sourceId, row.scanEventId),
          eq(sapOutbox.docType, 'PRODUCTION'),
          sql`coalesce(${sapOutbox.payload} -> 'ngTermasuk' @> to_jsonb(${row.id}::bigint), false)`,
        ),
      )
      .limit(1);
    return b ?? null;
  }

  /**
   * Daftar NG untuk layar Koreksi NG — terbaru dulu, beserta keadaan SAP dan
   * riwayat koreksinya.
   */
  async daftarKoreksi(
    params: { q?: string; id?: number; batas?: number },
    principal?: Principal,
  ): Promise<NgKoreksiDaftar> {
    const cari = params.q?.trim();
    const rows = await this.db
      .select({
        id: ngRecords.id,
        occurredAt: ngRecords.occurredAt,
        plantCode: plants.code,
        lineCode: lines.code,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        partName: parts.name,
        serialNumber: ngRecords.serialNumber,
        ngMasterId: ngRecords.ngMasterId,
        ngCode: ngMasters.code,
        ngName: ngMasters.name,
        qty: ngRecords.qty,
        origin: ngRecords.origin,
        npk: ngRecords.npk,
        cancelledAt: ngRecords.cancelledAt,
        scanEventId: ngRecords.scanEventId,
      })
      .from(ngRecords)
      .leftJoin(plants, eq(plants.id, ngRecords.plantId))
      .leftJoin(lines, eq(lines.id, ngRecords.lineId))
      .leftJoin(parts, eq(parts.id, ngRecords.partId))
      .leftJoin(ngMasters, eq(ngMasters.id, ngRecords.ngMasterId))
      .where(
        and(
          params.id ? eq(ngRecords.id, params.id) : undefined,
          principal?.plantId ? eq(ngRecords.plantId, principal.plantId) : undefined,
          cari
            ? or(
                sql`${ngRecords.serialNumber} ILIKE ${'%' + cari + '%'}`,
                sql`${parts.partNumber} ILIKE ${'%' + cari + '%'}`,
                sql`${parts.backNumber} ILIKE ${'%' + cari + '%'}`,
              )
            : undefined,
        ),
      )
      .orderBy(desc(ngRecords.occurredAt))
      .limit(Math.min(params.batas ?? 100, 300));

    const ids = rows.map((r) => r.id);
    const scanIds = rows.map((r) => r.scanEventId).filter((v): v is number => v != null);
    const [dokNg, dokScan, revisi] = await Promise.all([
      ids.length
        ? this.db
            .select({ sourceId: sapOutbox.sourceId, status: sapOutbox.status, doc: sapOutbox.sapDocNumber })
            .from(sapOutbox)
            .where(
              and(
                eq(sapOutbox.sourceTable, 'TT_NG'),
                eq(sapOutbox.docType, 'PRODUCTION'),
                inArray(sapOutbox.sourceId, ids),
              ),
            )
        : [],
      scanIds.length
        ? this.db
            .select({
              sourceId: sapOutbox.sourceId,
              status: sapOutbox.status,
              doc: sapOutbox.sapDocNumber,
              ngTermasuk: sql<number[] | null>`${sapOutbox.payload} -> 'ngTermasuk'`,
            })
            .from(sapOutbox)
            .where(
              and(
                eq(sapOutbox.sourceTable, 'TT_HISTORY_SCAN'),
                eq(sapOutbox.docType, 'PRODUCTION'),
                inArray(sapOutbox.sourceId, scanIds),
              ),
            )
        : [],
      ids.length
        ? this.db
            .select({
              id: ngRevisions.id,
              ngId: ngRevisions.ngId,
              qtyLama: ngRevisions.qtyLama,
              qtyBaru: ngRevisions.qtyBaru,
              jenisLama: sql<string | null>`(SELECT m."CHR_CODE" FROM ${ngMasters} m WHERE m."INT_ID" = ${ngRevisions.ngMasterLamaId})`,
              jenisBaru: sql<string | null>`(SELECT m."CHR_CODE" FROM ${ngMasters} m WHERE m."INT_ID" = ${ngRevisions.ngMasterBaruId})`,
              alasan: ngRevisions.alasan,
              npk: ngRevisions.npk,
              sapStatus: ngRevisions.sapStatus,
              sapPesan: ngRevisions.sapPesan,
              createdAt: ngRevisions.createdAt,
            })
            .from(ngRevisions)
            .where(inArray(ngRevisions.ngId, ids))
            .orderBy(desc(ngRevisions.id))
        : [],
    ]);

    const keadaan = (status: string): NgSapKeadaan =>
      status === 'CONFIRMED'
        ? 'DITERIMA_SAP'
        : status === 'SENT'
          ? 'DI_STAGING'
          : status === 'REJECTED'
            ? 'DITOLAK_SAP'
            : status === 'SKIPPED'
              ? 'TIDAK_DIKIRIM'
              : 'BELUM_TERKIRIM';

    const data: NgKoreksiBaris[] = rows.map((r) => {
      let sap: NgSapKeadaan = 'TIDAK_DIKIRIM';
      let sapDokumen: string | null = null;
      const a = dokNg.find((d) => Number(d.sourceId) === Number(r.id));
      const b = dokScan.find((d) => Number(d.sourceId) === Number(r.scanEventId));
      if (a) {
        sap = keadaan(a.status);
        sapDokumen = a.doc;
      } else if (b) {
        const ikut = Array.isArray(b.ngTermasuk) && b.ngTermasuk.map(Number).includes(Number(r.id));
        const terdorong = b.status === 'SENT' || b.status === 'CONFIRMED';
        sap = ikut ? keadaan(b.status) : terdorong ? 'PERLU_KOREKSI' : keadaan(b.status);
        sapDokumen = ikut ? b.doc : null;
      }
      return {
        id: Number(r.id),
        occurredAt: r.occurredAt.toISOString(),
        plantCode: r.plantCode,
        lineCode: r.lineCode,
        partNumber: r.partNumber,
        backNumber: r.backNumber,
        partName: r.partName,
        serialNumber: r.serialNumber,
        ngMasterId: Number(r.ngMasterId),
        ngCode: r.ngCode,
        ngName: r.ngName,
        qty: r.qty,
        origin: r.origin,
        npk: r.npk,
        dibatalkan: r.cancelledAt != null,
        sap,
        sapDokumen,
        revisi: revisi
          .filter((v) => Number(v.ngId) === Number(r.id))
          .map((v) => ({
            id: Number(v.id),
            qtyLama: v.qtyLama,
            qtyBaru: v.qtyBaru,
            jenisLama: v.jenisLama,
            jenisBaru: v.jenisBaru,
            alasan: v.alasan,
            npk: v.npk,
            sapStatus: v.sapStatus,
            sapPesan: v.sapPesan,
            createdAt: v.createdAt.toISOString(),
          })),
      };
    });

    return { data, boleh: await this.bolehKoreksi(principal) };
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
      line?.id,
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
    lineId?: number,
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

    const { part: dikenali, ambigu } = await this.scan.kenaliPart(
      parsed,
      plantId,
      lineId ? { id: lineId, processType } : undefined,
    );
    if (!dikenali) {
      const sebab = ambigu
        ? `QR ini cocok ke beberapa part di line ini: ${ambigu.join(', ')}`
        : parsed.programCode
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
        partId: scanEvents.partId,
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

    /*
     * QR yang sama dibawa dari Casting sampai FG dengan nomor part yang berganti,
     * jadi part milik scan yang dibalik itulah yang benar, bukan tebakan dari QR.
     */
    const [dariScan] =
      scanProduksi?.partId && scanProduksi.partId !== dikenali.id
        ? await this.db.select().from(parts).where(eq(parts.id, scanProduksi.partId)).limit(1)
        : [];
    const part = dariScan ?? dikenali;

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
    const katalog = await this.processTypes.katalog();

    if (!row || row.isActive !== '1') {
      throw new NgRejected('NG_TYPE_UNKNOWN', `${NG_REJECT_MESSAGES.NG_TYPE_UNKNOWN} (id ${id})`);
    }
    if (row.plantId !== plantId) {
      throw new NgRejected('NG_TYPE_WRONG_PLANT', NG_REJECT_MESSAGES.NG_TYPE_WRONG_PLANT);
    }
    // Lingkup kosong berarti berlaku di semua proses — padanan tombol "DLL".
    if (row.processGroup && processType && row.processGroup !== grupProses(katalog, processType)) {
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
  /**
   * Dokumen PRODUCTION bersumber TT_NG untuk NG tanpa scan produksi (kasus A).
   *
   * Work center dan PV dari rute part di lini tempat NG ditemukan — sama
   * dengan yang akan dipakai baris OK-nya seandainya barang itu lolos. Tanpa
   * lini (NG outline tanpa lini) tidak ada work center untuk SAP, jadi tidak
   * dikirim. Unit yang sudah punya NG lain tidak dikirim lagi: satu barang
   * hanya sekali dibuang, berapa pun jenis cacatnya.
   */
  private async outboxNgTanpaProduksi(
    tx: Database,
    k: {
      plantId: number;
      part: typeof parts.$inferSelect;
      lineId: number | null;
      processType: ProcessType | null;
      qtyPerUnit: number;
      waktu: Date;
      ngId: number;
      serialNumber: string;
    },
  ): Promise<boolean> {
    const [lain] = await tx
      .select({ id: ngRecords.id })
      .from(ngRecords)
      .where(
        and(
          eq(ngRecords.serialNumber, k.serialNumber),
          isNull(ngRecords.cancelledAt),
          ne(ngRecords.id, k.ngId),
        ),
      )
      .limit(1);
    // Barang yang sudah NG tidak dihitung dua kali — tidak ke SAP, tidak ke RE.
    if (lain) return false;
    // Tanpa lini tidak ada work center untuk SAP; stok RE tetap dicatat.
    if (!k.lineId) return true;

    const [line] = await tx
      .select({ sapWorkCenter: lines.sapWorkCenter, code: lines.code })
      .from(lines)
      .where(eq(lines.id, k.lineId))
      .limit(1);
    const [rute] = await tx
      .select({ pv: partProcesses.productionVersion, sap: partProcesses.sapProductionEnabled })
      .from(partProcesses)
      .where(
        and(
          eq(partProcesses.partId, k.part.id),
          eq(partProcesses.isActive, true),
          or(
            eq(partProcesses.lineId, k.lineId),
            and(isNull(partProcesses.lineId), eq(partProcesses.processType, k.processType ?? '')),
          ),
        ),
      )
      .limit(1);

    const dasar = {
      plantId: k.plantId,
      sourceTable: 'TT_NG',
      sourceId: k.ngId,
      docType: 'PRODUCTION',
      movementType: '101',
      idempotencyKey: `TT_NG:${k.ngId}:PRODUCTION`,
      occurredAt: k.waktu,
    };
    // Rute yang push produksinya dimatikan juga tidak mengirim NG-nya.
    if (!rute?.sap) {
      await tx.insert(sapOutbox).values({
        ...dasar,
        status: 'SKIPPED',
        lastError: rute
          ? 'push staging SAP dimatikan untuk langkah rute ini'
          : `part ${k.part.partNumber} tidak punya rute di ${line?.code ?? 'lini ini'}`,
        payload: { docType: 'PRODUCTION', lines: [] },
      });
      return true;
    }
    await tx.insert(sapOutbox).values({
      ...dasar,
      status: 'PENDING',
      payload: {
        docType: 'PRODUCTION',
        movementType: '101',
        plantId: k.plantId,
        sourceTable: 'TT_NG',
        sourceId: k.ngId,
        occurredAt: k.waktu,
        lineCode: line?.sapWorkCenter ?? null,
        backNumber: k.part.backNumber,
        partName: k.part.name,
        productionVersion: rute.pv ?? k.part.productionVersion ?? null,
        serialNumber: k.serialNumber,
        ngQty: k.qtyPerUnit,
        lines: [
          {
            mutationId: null,
            mutationType: 'NG_OUT',
            movementType: null,
            partNumber: k.part.partNumber,
            uom: k.part.uom,
            sloc: null,
            slocFrom: null,
            slocTo: null,
            qty: -k.qtyPerUnit,
            qtyAbsolute: k.qtyPerUnit,
            lotNumber: null,
            note: 'NG tanpa scan produksi',
          },
        ],
      },
    });
    return true;
  }

  /** SLOC reject pabrik ini (RE70 Body, RE80 Unit, RE90 Electric). */
  private async slocReject(tx: Database, plantId: number): Promise<number | null> {
    const [lokasi] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.plantId, plantId), eq(locations.kind, 'NG')))
      .orderBy(locations.code)
      .limit(1);
    return lokasi?.id ?? null;
  }

  private async slocHasilScan(
    tx: Database,
    scanEventId: number | null,
    lineId: number | null,
  ): Promise<number | null> {
    if (scanEventId) {
      const [scan] = await tx
        .select({ meta: scanEvents.meta })
        .from(scanEvents)
        .where(eq(scanEvents.id, scanEventId))
        .limit(1);
      const rute = (
        scan?.meta as {
          sapRoute?: {
            transferLocationId?: number | null;
            outputLocationId?: number | null;
          };
        } | null
      )?.sapRoute;
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
    const [row] = await this.db.select().from(lines).where(eq(lines.code, code.trim())).limit(1);
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
      if (galatDuplikat(err)) return true;
      current = e.cause;
    } else {
      return false;
    }
  }
  return false;
}
