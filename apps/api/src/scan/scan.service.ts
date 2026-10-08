import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  eq, and, or, isNull, desc, asc, gte, lt, count, sum, inArray, type Database,
} from '@avicenna/db';
import {
  scanEvents,
  lines,
  parts,
  machines,
  mutations,
  plants,
  partProcesses,
  routeProcesses,
  locations,
  kanbans,
  kanbanItems,
  kanbanEvents,
  programNumbers,
  users,
  roles,
  lineStops,
  stopReasons,
  deliveries,
  deliveryLines,
  customers,
  customerParts,
} from '@avicenna/db';
import {
  normalizeScan,
  bacaBarcode,
  BarcodeTidakDikenali,
  punyaIdentitasPart,
  rencanaMutasiScanProduksi,
  productionDateKey,
  productionDayWindow,
  statusLini,
  prosesSebelumnya,
  prosesAdaDiRute,
  grupProses,
  prosesDalamGrup,
  bolehScanDi,
  PROCESS_GROUP_LABELS,
  bacaKanban,
  KanbanTidakTerbaca,
  syaratScan,
  modeScanBawaan,
  modeScanBerlaku,
  normalkanModeScan,
  duplikatDariBarcode,
  type ScanMode,
  programCodeOf,
  convertCustomerPartNumber,
  type PartNumberFormat,
  REJECT_MESSAGES,
  type ScanRejectReason,
} from '@avicenna/domain';
import type {
  AlasanBerhenti,
  BerhentiLini,
  DashboardProduksi,
  KartuLini,
  KanbanOwner,
  MulaiBerhentiInput,
  ScanInput,
  ScanModeTersimpan,
  ScanResult,
  StationResult,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { RealtimeService } from '../realtime/realtime.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';
import { LoadingService } from '../loading/loading.service';
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

/** Pilihan jalannya satu scan. */
interface OpsiIngest {
  /**
   * Periksa saja, jangan tulis.
   *
   * Semua pemeriksaan berjalan — barcode, part, rute, duplikat, SLOC, kartu
   * bila ada — lalu berhenti sebelum transaksi. Dipakai layar FG untuk menahan
   * part sampai box penuh dan kartunya discan.
   */
  ujiSaja?: boolean;
}

interface HasilIngest {
  duplicated: boolean;
  partId?: number;
  productionDate: string;
  qty: number;
  serialNumber: string | null;
  /** Pemilik kartu yang ditempel: INTERNAL (kanban pabrik) atau CUSTOMER (direct kanban). */
  kanbanOwner: KanbanOwner | null;
  /** Loading list yang ditunjuk label DN, bila kartunya label DN. */
  loadingList: StationResult['loadingList'];
  /** Catatan yang perlu dibaca operator meski scannya diterima. */
  peringatan: string | null;
}

/** Label DN yang sudah diperiksa: loading list dan barisnya untuk part ini. */
interface LabelDn {
  deliveryId: number;
  deliveryLineId: number;
  documentNumber: string;
  customerId: number;
  customerPartNumber: string;
  dnNumber: string;
  dnSeq: number;
  /** Isi box menurut loading list — dipakai saat mendaftarkan label sebagai kartu. */
  qtyPerKanban: number;
}

@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly realtime: RealtimeService,
    private readonly queue: QueueService,
    private readonly loading: LoadingService,
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
    opsi: OpsiIngest = {},
  ): Promise<HasilIngest> {
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
    /*
     * Mode scan dibaca DI SINI, sebelum barcode diurai: aturan mana yang boleh
     * membaca barcode bergantung padanya (nomor part polos hanya sah di mode
     * per-kanban). Master per prosesnya dibaca sekali lagi di bawah bersama
     * SLOC — murah, dan lebih jelas daripada mengoper hasilnya melintasi
     * seluruh fungsi.
     */
    const prosesAwal = normalized.processType ?? line?.processType ?? null;
    const modeAwal: ScanMode =
      line && prosesAwal
        ? await this.modeScanLini(line.plantId, prosesAwal, line.scanMode)
        : 'PART_SAJA';
    const konteksBarcode = {
      processType: prosesAwal,
      scanMode: modeAwal,
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

    const plantId = line?.plantId ?? part?.plantId ?? principal?.plantId ?? undefined;
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
        .select()
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
     * SLOC dan kebijakan SAP diambil PER PROSES (TM_ROUTE_PROCESS), bukan per
     * langkah tiap part.
     *
     * Sempat per part × proses. Dengan 13 part × ~4 langkah itu 50-an baris
     * pengaturan yang isinya nyaris sama, dan satu yang terlewat membuat satu
     * part diam-diam tidak pernah sampai ke SAP. Di pabrik ini SLOC memang
     * ditentukan prosesnya — semua hasil casting masuk gudang yang sama.
     *
     * Urutan cadangan: master proses -> lini. Kosong di master berarti "pakai
     * milik lini", bukan "tidak ada SLOC".
     */
    const [aturanProses] = processType
      ? await this.db
          .select()
          .from(routeProcesses)
          .where(
            and(
              eq(routeProcesses.plantId, plantId),
              eq(routeProcesses.processType, processType),
              eq(routeProcesses.isActive, true),
            ),
          )
          .limit(1)
      : [];

    const inputLocationId = aturanProses?.inputLocationId ?? line?.inputLocationId ?? null;
    const outputLocationId = aturanProses?.outputLocationId ?? line?.outputLocationId ?? null;
    const transferLocationId = aturanProses?.transferLocationId ?? null;
    /*
     * Kebijakan DISALIN ke meta scan (lihat insert di bawah). Outbox SAP dan
     * pencatatan NG membaca salinan itu, bukan master — supaya mengubah
     * pengaturan hari ini tidak mengubah nasib scan kemarin yang belum terkirim.
     */
    const sapRoute = {
      productionEnabled: aturanProses?.sapProductionEnabled ?? false,
      transferEnabled: aturanProses?.sapTransferEnabled ?? false,
      transferMovementType: aturanProses?.sapTransferMovementType ?? null,
      inputLocationId,
      outputLocationId,
      transferLocationId,
    };

    if (normalized.kind === 'PRODUCTION') {
      /*
       * Galat SLOC menyebut SEBABNYA, bukan hanya "tidak valid".
       *
       * Ini galat pengaturan, bukan galat operator: yang harus dibereskan ada
       * di Integrasi › Rute Proses. Pesan yang hanya berbunyi "SLOC rute belum
       * lengkap" membuat leader menebak di antara empat kemungkinan — dan
       * selama menebak, seluruh lini proses itu berhenti. Pernah terjadi: SLOC
       * Transfer diisi sama dengan SLOC Keluar, dan SETIAP scan casting
       * ditolak tanpa ada yang tahu kolom mana.
       */
      const tolakSloc = (sebab: string): never => {
        throw new ScanRejected(
          'STOCK_LOCATION_INVALID',
          `${REJECT_MESSAGES.STOCK_LOCATION_INVALID} (${processType}: ${sebab})`,
        );
      };

      const ids = [inputLocationId, outputLocationId, transferLocationId].filter(
        (id): id is number => id !== null,
      );
      const daftar =
        ids.length > 0
          ? await this.db
              .select({ id: locations.id, code: locations.code, plantId: locations.plantId })
              .from(locations)
              .where(inArray(locations.id, ids))
          : [];
      const kode = (id: number | null) =>
        id === null ? '(kosong)' : (daftar.find((l) => l.id === id)?.code ?? `id=${id}`);

      if ((sapRoute.productionEnabled || transferLocationId) && !outputLocationId) {
        tolakSloc(
          'SLOC Keluar kosong padahal push produksi atau transfer aktif — isi SLOC Keluar di Integrasi › Rute Proses',
        );
      }
      if (sapRoute.transferEnabled && !transferLocationId) {
        tolakSloc('push transfer aktif tetapi SLOC Transfer kosong');
      }
      if (transferLocationId && transferLocationId === outputLocationId) {
        tolakSloc(
          `SLOC Transfer sama dengan SLOC Keluar (${kode(outputLocationId)}) — ` +
            'pindah ke gudang yang sama bukan perpindahan; kosongkan SLOC Transfer',
        );
      }
      const salahPabrik = ids.filter((id) => !daftar.some((l) => l.id === id && l.plantId === plantId));
      if (salahPabrik.length > 0) {
        tolakSloc(`SLOC ${salahPabrik.map(kode).join(', ')} bukan milik pabrik lini ini`);
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
    /*
     * METODE SCAN proses ini, dari master Rute Proses.
     *
     * Dari master per proses, dengan bawaan per jenis proses bila barisnya
     * belum ada. Semua syarat kanban di bawah diturunkan dari sini lewat
     * syaratScan(), bukan dari "apakah ini lini FG" — aturan FG/WIP itu milik
     * UNIT, sedangkan di BODY setiap lini men-scan kanban.
     */
    // Penimpa lini didahulukan: satu pabrik bisa punya dua lini dengan cara
    // berbeda pada proses yang sama (injection vs assembling BODY).
    const modeScan: ScanMode = modeScanBerlaku({
      modeLini: line?.scanMode,
      modeProses: aturanProses?.scanMode,
      proses: processType,
    });
    const syarat = processType ? syaratScan(modeScan, processType) : null;

    /*
     * Metode yang dikenal tetapi alurnya belum dibangun ditolak di sini.
     *
     * Diam-diam memperlakukannya sebagai metode lain adalah kegagalan yang
     * paling mahal: PART_PINDAH_KARTU yang dijalankan seperti PART_KANBAN akan
     * menempelkan unit ke kartu customer TANPA melepasnya dari kartu internal,
     * dan barang yang sama tercatat di dua kartu sekaligus.
     */
    if (normalized.kind === 'PRODUCTION' && syarat?.belumTersedia) {
      throw new ScanRejected(
        'SCAN_MODE_UNSUPPORTED',
        `${REJECT_MESSAGES.SCAN_MODE_UNSUPPORTED} (${modeScan})`,
      );
    }

    let labelDn: LabelDn | null = null;
    let kanbanTerpilih:
      | {
          id: number;
          capacity: number;
          qtyPerBox: number;
          serial: string;
          status: string;
          owner: KanbanOwner;
        }
      | undefined;

    if (normalized.kind === 'PRODUCTION' && processType && part && syarat) {
      if (syarat.kanbanDilarang && normalized.kanbanCode) {
        throw new ScanRejected('KANBAN_NOT_EXPECTED', REJECT_MESSAGES.KANBAN_NOT_EXPECTED);
      }

      /*
       * Uji tanpa kartu: layar FG menahan part dulu, kartunya menyusul setelah
       * box penuh. Pemeriksaan part-nya tetap lengkap; yang dilewati hanya
       * pemeriksaan kartu — dan scan sungguhannya nanti tetap mewajibkannya.
       */
      const tundaKartu = opsi.ujiSaja && !normalized.kanbanCode;
      if (syarat.kanbanWajib && !tundaKartu) {
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
        /*
         * Kartu BODY menyebut nomor part-nya sendiri. Harus sama dengan master
         * sample yang sedang aktif — kartu part lain yang terscan di lini tidak
         * boleh menambah hasil part yang sedang dikerjakan. Ini pemeriksaan
         * yang bella tidak punya (ia hanya mencocokkan seri), dan kekeliruannya
         * di sana baru ketahuan saat stok dua part sama-sama tidak cocok.
         */
        /*
         * Label DN = direct pulling: box ini menuju loading list tertentu,
         * tidak melewati pulling. Labelnya bukan kartu terdaftar, jadi yang
         * diperiksa adalah DOKUMENNYA — ada, masih terbuka, memuat part ini —
         * lalu labelnya didaftarkan sebagai kartu milik customer supaya aturan
         * kapasitas dan penempelan unit berlaku sama seperti kartu biasa.
         */
        if (kb.dnNumber) {
          labelDn = await this.periksaLabelDn(kb, part, plantId, opsi);
        }

        if (kb.partNumber && kb.partNumber.toUpperCase() !== part.partNumber.toUpperCase()) {
          throw new ScanRejected(
            'KANBAN_PART_MISMATCH',
            `${REJECT_MESSAGES.KANBAN_PART_MISMATCH} (kartu untuk ${kb.partNumber}, sample ${part.partNumber})`,
          );
        }

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
            qtyPerBox: kanbans.qtyPerBox,
            serialNumber: kanbans.serialNumber,
            status: kanbans.status,
            isActive: kanbans.isActive,
            owner: kanbans.owner,
          })
          .from(kanbans)
          .where(and(eq(kanbans.partId, part.id), eq(kanbans.serialNumber, kb.serialNumber ?? '')))
          .limit(1);

        if (!kartu && labelDn && opsi.ujiSaja) {
          // Mode uji tidak mendaftarkan label; sampai di sini berarti label
          // dan dokumennya sah. Tidak ada kartu untuk diperiksa lebih jauh.
          return {
            duplicated: false,
            partId: part.id,
            productionDate: prodDate,
            qty: parsed.qty ?? normalized.qty,
            serialNumber: parsed.serialNumber ?? null,
            kanbanOwner: 'CUSTOMER',
            loadingList: await this.ringkasanLoadingList(labelDn.deliveryId),
            peringatan: null,
          };
        }

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

        if (syarat.tolakKartuTerproduksi && kartu.status === 'PRODUCED') {
          /*
           * Inilah duplikat di mode per-kanban. Barcode part-nya sama untuk
           * seluruh shift, jadi yang membedakan satu scan dari yang lain
           * adalah KARTUNYA — dan kartu yang sudah tercatat produksi belum
           * boleh dicatat lagi sampai pulling mengambilnya.
           */
          throw new ScanRejected(
            'KANBAN_ALREADY_PRODUCED',
            `${REJECT_MESSAGES.KANBAN_ALREADY_PRODUCED} (seri ${kb.serialNumber})`,
          );
        }

        if (syarat.tempelUnitKeKartu) {
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
        }
        kanbanTerpilih = {
          id: kartu.id,
          capacity: kartu.unitPerKanban,
          qtyPerBox: kartu.qtyPerBox,
          serial: kartu.serialNumber,
          status: kartu.status,
          owner: kartu.owner,
        };
      }
    }

    /*
     * Jumlah dan seri yang dicatat mengikuti modenya.
     *
     * PER_KANBAN: satu scan = isi satu kartu, seri = seri kartunya (persis
     * `serial_number` di mutasi bella). PER_PIECE: satu scan = satu barang,
     * seri = barcode barangnya.
     */
    const qtyScan =
      syarat?.qtyDariKartu && kanbanTerpilih ? kanbanTerpilih.qtyPerBox : (parsed.qty ?? normalized.qty);
    const seriScan =
      syarat?.qtyDariKartu && kanbanTerpilih ? kanbanTerpilih.serial : (parsed.serialNumber ?? null);

    const hasilDasar: HasilIngest = {
      duplicated: false,
      partId: part?.id,
      productionDate: prodDate,
      qty: qtyScan,
      serialNumber: seriScan,
      kanbanOwner: kanbanTerpilih?.owner ?? null,
      loadingList: labelDn ? await this.ringkasanLoadingList(labelDn.deliveryId) : null,
      peringatan: null,
    };

    /*
     * Mode uji berhenti DI SINI — setelah seluruh pemeriksaan, sebelum satu
     * pun tulisan. Layar FG memakainya untuk menahan part sebelum kartunya
     * ada; yang diperiksa persis sama dengan scan sungguhan, jadi part yang
     * lolos uji hanya bisa gagal nanti karena kartunya.
     */
    if (opsi.ujiSaja) return hasilDasar;

    let insertedId: number | undefined;
    let isiSetelahScan = 0;

    try {
      await this.db.transaction(async (tx) => {
        if (kanbanTerpilih) {
          // Satu kartu dikunci sampai isi dan scan tersimpan. Dua scanner yang
          // menyentuh kartu yang sama bersamaan tidak boleh sama-sama diterima.
          const [terkunci] = await tx
            .select({ id: kanbans.id, status: kanbans.status })
            .from(kanbans)
            .where(eq(kanbans.id, kanbanTerpilih.id))
            .for('update');

          if (syarat?.tolakKartuTerproduksi && terkunci?.status === 'PRODUCED') {
            // Diperiksa ulang DI BAWAH KUNCI: dua scanner mengirim kartu yang
            // sama dalam selisih milidetik, keduanya lolos pemeriksaan di atas.
            throw new ScanRejected('KANBAN_ALREADY_PRODUCED', REJECT_MESSAGES.KANBAN_ALREADY_PRODUCED);
          }

          if (syarat?.tempelUnitKeKartu) {
            const [isi] = await tx
              .select({ n: count() })
              .from(kanbanItems)
              .where(eq(kanbanItems.kanbanId, kanbanTerpilih.id));
            if (Number(isi?.n ?? 0) >= kanbanTerpilih.capacity) {
              throw new ScanRejected('KANBAN_FULL', REJECT_MESSAGES.KANBAN_FULL);
            }
            // Dihitung di bawah kunci kartu: unit inilah yang memenuhi box
            // atau bukan, dan dua scanner tidak bisa sama-sama "yang terakhir".
            isiSetelahScan = Number(isi?.n ?? 0) + 1;
          }
        }
        const inserted = await tx.insert(scanEvents).values({
          plantId,
          kind: normalized.kind,
          processType,
          lineId: line?.id ?? null,
          partId: part?.id ?? null,
          machineId: machine?.id ?? null,
          rawCode: normalized.rawCode,
          serialNumber: seriScan,
          qty: qtyScan,
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
            sapRoute,
            scanMode: modeScan,
            ...(kanbanTerpilih ? { kanbanSerial: kanbanTerpilih.serial } : {}),
          },
        });
        // mysql2 mengembalikan insertId pada elemen pertama hasil insert.
        insertedId = Number((inserted as unknown as Array<{ insertId: number }>)[0]?.insertId);

        /*
         * Menempelkan unit ke kartu.
         *
         * Sesudah scan tersimpan supaya bisa menunjuk balik ke scan-nya. Unique
         * index pada nomor seri unit yang menjaga satu barang tidak ikut dua
         * kanban — bukan pemeriksaan di sini, yang bisa kalah balapan saat dua
         * operator men-scan bersamaan.
         */
        if (kanbanTerpilih && insertedId && syarat?.qtyDariKartu) {
          /*
           * PER_KANBAN: kartu ditandai PRODUCED, tanpa daftar unit — barangnya
           * memang tidak berseri. Statusnya yang menjadi penjaga duplikat, dan
           * pulling nanti yang mengembalikannya ke siklus.
           */
          await tx
            .update(kanbans)
            .set({ status: 'PRODUCED', producedAt: normalized.scannedAt })
            .where(eq(kanbans.id, kanbanTerpilih.id));
          await tx.insert(kanbanEvents).values({
            kanbanId: kanbanTerpilih.id,
            type: 'PRODUCED',
            lineId: line?.id ?? null,
            qty: qtyScan,
            userId: principal?.kind === 'user' ? principal.sub : null,
            deviceId: principal?.kind === 'device' ? principal.sub : null,
            occurredAt: normalized.scannedAt,
            meta: { scanEventId: insertedId, scanMode: modeScan },
          });
        }

        if (kanbanTerpilih && insertedId && syarat?.tempelUnitKeKartu) {
          const seriUnit = parsed.serialNumber ?? normalized.rawCode;
          await tx.insert(kanbanItems).values({
            kanbanId: kanbanTerpilih.id,
            serialNumber: seriUnit,
            scanEventId: insertedId,
            attachedAt: normalized.scannedAt,
          });
          await tx.insert(kanbanEvents).values({
            kanbanId: kanbanTerpilih.id,
            type: 'PAIRED',
            lineId: line?.id ?? null,
            userId: principal?.kind === 'user' ? principal.sub : null,
            deviceId: principal?.kind === 'device' ? principal.sub : null,
            occurredAt: normalized.scannedAt,
            meta: { serialUnit: seriUnit, scanEventId: insertedId },
          });
        }

        // Scan produksi menambah stok; jenis scan lain belum menulis mutasi
        // sampai aturannya dikonfirmasi tim produksi. `part` di sini sudah pasti
        // ada — scan produksi tanpa part ditolak jauh di atas.
        if (normalized.kind === 'PRODUCTION' && part) {
          const qty = qtyScan;
          const dasar = {
            plantId,
            partId: part.id,
            lineId: line?.id ?? null,
            sourceTable: 'TT_HISTORY_SCAN',
            sourceId: insertedId,
            npk: normalized.npk ?? (principal?.kind === 'user' ? principal.npk : null),
            userId: principal?.kind === 'user' ? principal.sub : null,
            occurredAt: normalized.scannedAt,
          };
          const rencana = rencanaMutasiScanProduksi(qty, outputLocationId, transferLocationId);
          // Hasil produksi dan dua sisi transfer adalah satu perubahan stok.
          // Jika sisi masuk gagal, sisi keluar juga harus dibatalkan.
          await tx.insert(mutations).values(
            rencana.map((m) => ({
              ...dasar,
              locationId: m.locationId,
              type: m.type,
              qty: String(m.qty),
            })),
          );
        }
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        const [scanSama] = await this.db
          .select({ id: scanEvents.id })
          .from(scanEvents)
          .where(eq(scanEvents.dedupeKey, normalized.dedupeKey))
          .limit(1);
        if (scanSama) {
          return { ...hasilDasar, duplicated: true, qty: 0, serialNumber: null, kanbanOwner: null };
        }
        throw new ScanRejected(
          'KANBAN_UNIT_ALREADY_PAIRED',
          REJECT_MESSAGES.KANBAN_UNIT_ALREADY_PAIRED,
        );
      }
      throw err;
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

    /*
     * ── Direct pulling ────────────────────────────────────────────────────
     *
     * Unit yang memenuhi box berlabel DN sekaligus mengambil box itu untuk
     * loading list-nya — di sistem lama, `api_save_ldlist_dn` dipanggil saat
     * box disimpan. Dikerjakan SETELAH produksi tersimpan dan lewat
     * LoadingService yang sama dengan layar pulling, supaya hitungan, jejak
     * scan, dan kemajuan dokumennya satu sumber.
     *
     * Kegagalan di sini tidak membatalkan produksi yang sudah tercatat —
     * barangnya sudah jadi. Yang dilakukan: dicatat keras, dan operator diberi
     * tahu lewat peringatan supaya box-nya di-pull manual.
     */
    if (
      labelDn &&
      kanbanTerpilih &&
      insertedId &&
      syarat?.tempelUnitKeKartu &&
      isiSetelahScan >= kanbanTerpilih.capacity &&
      part
    ) {
      try {
        const tarik = await this.loading.scan(
          {
            deliveryId: labelDn.deliveryId,
            phase: 'PULLING',
            customerPart: labelDn.customerPartNumber,
            internalPart: part.partNumber,
            serialNumber: kanbanTerpilih.serial,
            // Satu box = satu kunci: label yang sama tidak terhitung dua kali.
            clientRef: `fg-box:${kanbanTerpilih.id}`,
          },
          principal,
        );
        if (tarik.status === 'REJECTED') {
          hasilDasar.peringatan = `Box tersimpan, tetapi TIDAK masuk loading list: ${tarik.message}`;
        } else {
          await this.db
            .update(kanbans)
            .set({ status: 'PULLED' })
            .where(eq(kanbans.id, kanbanTerpilih.id));
          await this.db.insert(kanbanEvents).values({
            kanbanId: kanbanTerpilih.id,
            type: 'PULLED',
            lineId: line?.id ?? null,
            qty: kanbanTerpilih.qtyPerBox,
            userId: principal?.kind === 'user' ? principal.sub : null,
            deviceId: principal?.kind === 'device' ? principal.sub : null,
            occurredAt: normalized.scannedAt,
            meta: {
              deliveryId: labelDn.deliveryId,
              dnNumber: labelDn.dnNumber,
              dnSeq: labelDn.dnSeq,
              scanEventId: insertedId,
              directPulling: true,
            },
          });
          if (tarik.status === 'OVER') hasilDasar.peringatan = tarik.message;
        }
      } catch (err) {
        this.logger.error(
          `direct pulling gagal untuk kartu ${kanbanTerpilih.serial} → loading list ${labelDn.documentNumber}: ${String(err)}`,
        );
        hasilDasar.peringatan =
          'Box tersimpan, tetapi belum masuk loading list. Pull box ini manual di menu Delivery.';
      }
      hasilDasar.loadingList = await this.ringkasanLoadingList(labelDn.deliveryId);
    }

    if (line) {
      try {
        await this.realtime.publish(`line:${line.code}`, 'scan', {
          kind: normalized.kind,
          partNumber: part?.partNumber ?? parsed.partNumber ?? null,
          serialNumber: parsed.serialNumber ?? null,
          qty: qtyScan,
          scannedAt: normalized.scannedAt.toISOString(),
        });
      } catch (err) {
        this.logger.warn(`gagal menyiarkan scan ke line:${line.code}: ${String(err)}`);
      }
    }

    return hasilDasar;
  }

  /**
   * Memeriksa label DN terhadap loading list-nya, lalu memastikan labelnya
   * terdaftar sebagai kartu milik customer.
   *
   * Nomor pada label dicocokkan ke nomor dokumen kita ATAU nomor PDS customer:
   * label bisa dicetak dari sisi mana pun. Part dicocokkan lewat baris
   * loading list — bukan lewat master saja — karena yang membuktikan box ini
   * boleh berangkat adalah dokumennya memuat part itu.
   */
  private async periksaLabelDn(
    kb: { dnNumber?: string; dnSeq?: number; customerPartNumber?: string; serialNumber?: string },
    part: { id: number; partNumber: string; qtyPerKanban: number | null },
    plantId: number,
    opsi: OpsiIngest,
  ): Promise<LabelDn> {
    const dn = kb.dnNumber ?? '';
    const [doc] = await this.db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        status: deliveries.status,
        customerId: deliveries.customerId,
        format: customers.partNumberFormat,
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .where(
        and(
          eq(deliveries.plantId, plantId),
          or(eq(deliveries.documentNumber, dn), eq(deliveries.pdsNumber, dn)),
        ),
      )
      .limit(1);

    if (!doc) {
      throw new ScanRejected('DN_NOT_FOUND', `${REJECT_MESSAGES.DN_NOT_FOUND} (${dn})`);
    }
    if (doc.status === 'SHIPPED' || doc.status === 'RECEIVED' || doc.status === 'CANCELLED') {
      throw new ScanRejected('DN_CLOSED', `${REJECT_MESSAGES.DN_CLOSED} (${doc.documentNumber})`);
    }

    const [baris] = await this.db
      .select({
        id: deliveryLines.id,
        qtyPerKanban: deliveryLines.qtyPerKanban,
        customerPartNumber: customerParts.customerPartNumber,
      })
      .from(deliveryLines)
      .leftJoin(customerParts, eq(deliveryLines.customerPartId, customerParts.id))
      .where(and(eq(deliveryLines.deliveryId, doc.id), eq(deliveryLines.partId, part.id)))
      .limit(1);

    if (!baris) {
      throw new ScanRejected(
        'DN_PART_NOT_LISTED',
        `${REJECT_MESSAGES.DN_PART_NOT_LISTED} (${part.partNumber} tidak ada di ${doc.documentNumber})`,
      );
    }

    /*
     * Nomor part customer pada label harus milik part ini: lewat pemetaan
     * customer part bila ada, atau lewat konversi format customer bila tidak.
     * Label part lain yang menempel keliru ketahuan di sini, bukan di dock.
     */
    const labelPart = (kb.customerPartNumber ?? '').trim();
    const cocok = baris.customerPartNumber
      ? baris.customerPartNumber.toUpperCase() === labelPart.toUpperCase()
      : convertCustomerPartNumber(labelPart, (doc.format ?? 'NONE') as PartNumberFormat) ===
          part.partNumber || labelPart.toUpperCase() === part.partNumber.toUpperCase();
    if (!cocok) {
      throw new ScanRejected(
        'CUSTOMER_PART_UNKNOWN',
        `${REJECT_MESSAGES.CUSTOMER_PART_UNKNOWN} (label ${labelPart}, part ${part.partNumber})`,
      );
    }

    const qtyPerKanban = baris.qtyPerKanban > 0 ? baris.qtyPerKanban : (part.qtyPerKanban ?? 1);

    // Mode uji tidak mendaftarkan apa pun.
    if (!opsi.ujiSaja) {
      const serial = kb.serialNumber ?? `${dn}/${kb.dnSeq ?? 0}`;
      const [ada] = await this.db
        .select({ id: kanbans.id })
        .from(kanbans)
        .where(and(eq(kanbans.partId, part.id), eq(kanbans.serialNumber, serial)))
        .limit(1);
      if (!ada) {
        /*
         * Label didaftarkan sebagai kartu CUSTOMER dengan isi menurut loading
         * list. Satu label = satu box = satu kartu, jadi aturan kapasitas dan
         * penempelan unit di bawah berlaku tanpa jalur khusus.
         */
        await this.db.insert(kanbans).values({
          plantId,
          partId: part.id,
          serialNumber: serial,
          owner: 'CUSTOMER',
          kanbanType: 'REGULER',
          qtyPerBox: qtyPerKanban,
          unitPerKanban: qtyPerKanban,
          customerId: doc.customerId,
          status: 'CREATED',
        });
      }
    }

    return {
      deliveryId: doc.id,
      deliveryLineId: baris.id,
      documentNumber: doc.documentNumber,
      customerId: doc.customerId,
      customerPartNumber: labelPart,
      dnNumber: dn,
      dnSeq: kb.dnSeq ?? 0,
      qtyPerKanban,
    };
  }

  /** Detail loading list untuk panel di layar FG: tiap part, box terambil dari rencana. */
  private async ringkasanLoadingList(deliveryId: number): Promise<StationResult['loadingList']> {
    const [doc] = await this.db
      .select({
        id: deliveries.id,
        documentNumber: deliveries.documentNumber,
        pdsNumber: deliveries.pdsNumber,
        status: deliveries.status,
        customerName: customers.name,
      })
      .from(deliveries)
      .leftJoin(customers, eq(deliveries.customerId, customers.id))
      .where(eq(deliveries.id, deliveryId))
      .limit(1);
    if (!doc) return null;

    const items = await this.db
      .select({
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        customerPartNumber: customerParts.customerPartNumber,
        pickedKanban: deliveryLines.pickedKanban,
        plannedKanban: deliveryLines.plannedKanban,
        qtyPerKanban: deliveryLines.qtyPerKanban,
      })
      .from(deliveryLines)
      .leftJoin(parts, eq(deliveryLines.partId, parts.id))
      .leftJoin(customerParts, eq(deliveryLines.customerPartId, customerParts.id))
      .where(eq(deliveryLines.deliveryId, deliveryId))
      .orderBy(deliveryLines.id);

    return {
      deliveryId: doc.id,
      documentNumber: doc.documentNumber,
      pdsNumber: doc.pdsNumber ?? null,
      customerName: doc.customerName ?? null,
      status: doc.status,
      items,
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
  async station(
    input: ScanInput,
    principal?: Principal,
    opsi: OpsiIngest = {},
  ): Promise<StationResult> {
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
    const modeScan = await this.modeScanFor(input);
    /*
     * Cek duplikat lewat barcode HANYA di mode per barang.
     *
     * Di PER_KANBAN barcode = master sample yang sama sepanjang shift; memeriksa
     * "barcode ini sudah discan di proses ini" akan menolak scan kedua dan
     * seterusnya. Di mode itu duplikatnya ditentukan status kartu, di ingestOne.
     */
    if (processType && duplikatDariBarcode(modeScan, processType)) {
      const already = await this.db
        .select({ id: scanEvents.id })
        .from(scanEvents)
        .where(and(eq(scanEvents.rawCode, input.rawCode), eq(scanEvents.processType, processType)))
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
          serialNumber: null,
          ...(await this.hitunganUntukHasil(input.lineCode)),
          scannedAt: now.toISOString(),
        };
      }
    }

    try {
      const outcome = await this.ingestOne(input, principal, opsi);

      if (outcome.duplicated) {
        return {
          status: 'DUPLICATE',
          reason: 'DUPLICATE',
          message: REJECT_MESSAGES.DUPLICATE,
          rawCode: input.rawCode,
          partNumber: null,
          partName: null,
          qty: 0,
          serialNumber: null,
          ...(await this.hitunganUntukHasil(input.lineCode)),
          scannedAt: now.toISOString(),
        };
      }

      // Hitung ulang saldo di luar request; kegagalan tidak menggagalkan scan.
      if (outcome.partId && !opsi.ujiSaja) {
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

      /*
       * Scan yang diterima MENUTUP berhenti yang masih terbuka.
       *
       * Operator yang lupa menekan "Mulai" tetap berproduksi. Membiarkan baris
       * berhenti terbuka membuat lini terlihat STOP di dashboard sambil terus
       * mengeluarkan barang, dan loss time-nya membengkak tanpa dasar.
       */
      if (!opsi.ujiSaja && input.lineCode) {
        try {
          const line = await this.findLine(input.lineCode);
          if (line) await this.tutupBerhenti(line.id, 'SCAN');
        } catch (err) {
          // Tidak boleh menggagalkan scan yang datanya sudah tersimpan.
          this.logger.warn(`gagal menutup berhenti di ${input.lineCode}: ${String(err)}`);
        }
      }

      return {
        status: 'ACCEPTED',
        message: outcome.peringatan ? `OK — ${outcome.peringatan}` : 'OK',
        rawCode: input.rawCode,
        partNumber: part?.partNumber ?? null,
        partName: part?.name ?? null,
        qty: outcome.qty,
        serialNumber: outcome.serialNumber,
        // Layar FG: berapa unit harus ditahan sebelum kartu discan.
        qtyPerKanban: part?.qtyPerKanban ?? null,
        kanbanOwner: outcome.kanbanOwner,
        loadingList: outcome.loadingList ?? null,
        ...(await this.hitunganUntukHasil(input.lineCode)),
        scannedAt: now.toISOString(),
      };
    } catch (err) {
      if (err instanceof ScanRejected) {
        /*
         * Kartu yang sudah tercatat produksi = "sudah discan" di layar (kuning),
         * bukan "ditolak" (merah). Bagi operator BODY ini kejadian biasa —
         * kartu yang belum sempat dipull terscan lagi — bukan kesalahan.
         */
        if (err.reason === 'KANBAN_ALREADY_PRODUCED') {
          return {
            status: 'DUPLICATE',
            reason: err.reason,
            message: err.message,
            rawCode: input.rawCode,
            partNumber: null,
            partName: null,
            qty: 0,
            serialNumber: null,
            ...(await this.hitunganUntukHasil(input.lineCode)),
            scannedAt: now.toISOString(),
          };
        }
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
      serialNumber: null,
      ...(await this.hitunganUntukHasil(input.lineCode)),
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

  /** Metode scan yang berlaku di lini ini — dari master per proses, atau bawaannya. */
  private async modeScanFor(input: ScanInput): Promise<ScanMode> {
    if (!input.lineCode) return 'PART_SAJA';
    const line = await this.findLine(input.lineCode);
    if (!line) return 'PART_SAJA';
    return this.modeScanLini(line.plantId, line.processType, line.scanMode);
  }

  /**
   * Metode scan sebuah lini, SELALU dalam bentuk nilai yang berlaku sekarang.
   *
   * Nilai lama diterjemahkan di sini, jadi pemanggil — termasuk layar operator
   * yang menerimanya lewat `summary` — tidak perlu tahu nilai lama pernah ada.
   */
  private async modeScanLini(
    plantId: number,
    processType: ScanInput['processType'] & {},
    modeLini?: ScanModeTersimpan | null,
  ): Promise<ScanMode> {
    const [aturan] = await this.db
      .select({ scanMode: routeProcesses.scanMode })
      .from(routeProcesses)
      .where(
        and(
          eq(routeProcesses.plantId, plantId),
          eq(routeProcesses.processType, processType),
          eq(routeProcesses.isActive, true),
        ),
      )
      .limit(1);
    return modeScanBerlaku({ modeLini, modeProses: aturan?.scanMode, proses: processType });
  }

  private async partById(id: number) {
    const rows = await this.db.select().from(parts).where(eq(parts.id, id)).limit(1);
    return rows[0];
  }

  /** Jumlah scan yang diterima hari ini pada satu line. */
  /** Bentuk hitungan sebagaimana dikirim ke layar (StationResult / StationSummary). */
  private async hitunganUntukHasil(lineCode?: string | null) {
    const h = await this.hitungHariIni(lineCode);
    return { counterToday: h.scans, pcsToday: h.pcs };
  }

  /**
   * Hitungan hari produksi ini di satu lini: berapa scan, dan berapa pcs.
   *
   * Dua angka, bukan satu, karena di lini per-kanban keduanya berbeda jauh —
   * satu scan = satu box berisi puluhan pcs. Layar per barang menampilkan
   * scan-nya; layar per kanban menampilkan pcs-nya, dengan jumlah kartu sebagai
   * keterangan.
   */
  private async hitungHariIni(lineCode?: string | null): Promise<{ scans: number; pcs: number }> {
    const kosong = { scans: 0, pcs: 0 };
    if (!lineCode) return kosong;
    const line = await this.findLine(lineCode);
    if (!line) return kosong;

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
      .select({ scans: count(), pcs: sum(scanEvents.qty) })
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
    // SUM() datang sebagai string desimal dari driver MySQL.
    return { scans: rows[0]?.scans ?? 0, pcs: Number(rows[0]?.pcs ?? 0) };
  }

  /**
   * Memeriksa master sample di lini per-kanban.
   *
   * Operator BODY memulai shift dengan men-scan master sample yang tertempel
   * di lini — nomor part apa adanya. Yang diperiksa: part-nya dikenal di pabrik
   * lini ini, dan rutenya memang melewati proses lini ini. Sample part lain
   * yang tertempel keliru akan membuat satu shift penuh tercatat atas nama
   * part yang salah — dan setiap scan kanbannya terlihat wajar.
   *
   * Tidak menulis apa pun. Layar menyimpan sample yang lolos dan mengirimnya
   * sebagai rawCode pada tiap scan kanban sesudahnya.
   */
  async periksaSample(kode: string, lineCode: string) {
    const line = await this.findLine(lineCode);
    if (!line) throw new BadRequestException(`${REJECT_MESSAGES.LINE_NOT_FOUND} (${lineCode})`);

    const mode = await this.modeScanLini(line.plantId, line.processType, line.scanMode);
    if (mode !== 'KANBAN_BOX') {
      throw new BadRequestException(
        `Lini ${line.code} men-scan per barang, bukan per kanban — tidak memakai master sample.`,
      );
    }

    let parsed;
    try {
      parsed = bacaBarcode(kode.trim(), { processType: line.processType, scanMode: mode });
    } catch (err) {
      if (err instanceof BarcodeTidakDikenali) {
        throw new BadRequestException(REJECT_MESSAGES.BARCODE_UNREADABLE);
      }
      throw err;
    }

    const { part } = await this.kenaliPart(parsed, line.plantId);
    if (!part) {
      throw new BadRequestException(
        `Master sample "${kode.trim()}" tidak dikenal sebagai part di pabrik ini.`,
      );
    }

    const rute = await this.db
      .select({ processType: partProcesses.processType })
      .from(partProcesses)
      .where(and(eq(partProcesses.partId, part.id), eq(partProcesses.isActive, true)));

    if (rute.length > 0 && !rute.some((r) => r.processType === line.processType)) {
      throw new BadRequestException(
        `${part.partNumber} tidak melewati ${line.processType} menurut rutenya. Periksa sample yang tertempel.`,
      );
    }

    return {
      partId: part.id,
      partNumber: part.partNumber,
      backNumber: part.backNumber,
      partName: part.name,
      /** Isi kartu menurut master part — ditampilkan supaya operator tahu tiap scan = berapa pcs. */
      qtyPerKanban: part.qtyPerKanban,
      /** Foto part untuk dicocokkan operator dengan barang di tangannya. */
      photoPath: part.photoPath ?? null,
      ruteDiperiksa: rute.length > 0,
    };
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
        /*
         * Layar memakai ini untuk memilih alurnya: kotak scan part (PER_PIECE)
         * atau master sample lalu kanban (PER_KANBAN). Diputuskan server, bukan
         * ditebak layar dari nama pabriknya.
         */
        scanMode: await this.modeScanLini(line.plantId, line.processType, line.scanMode),
      },
      ...(await this.hitunganUntukHasil(lineCode)),
      berhenti: await this.berhentiTerbuka(line.id),
      alasanBerhenti: await this.alasanUntukLini(line.plantId, line.id),
      recent: await this.recent(lineCode, limit),
    };
  }

  /**
   * Baris berhenti yang belum ditutup di sebuah lini.
   *
   * Paling banyak satu — dijaga saat membuka. Dibaca tiap kali layar dimuat,
   * supaya operator yang datang setelah pergantian shift melihat keadaan
   * sebenarnya, bukan layar yang seolah lini sedang berjalan.
   */
  private async berhentiTerbuka(lineId: number): Promise<BerhentiLini | null> {
    const [baris] = await this.db
      .select({
        id: lineStops.id,
        reasonId: lineStops.reasonId,
        reasonCode: stopReasons.code,
        reasonName: stopReasons.name,
        isPlanned: stopReasons.isPlanned,
        startedAt: lineStops.startedAt,
        endedAt: lineStops.endedAt,
        note: lineStops.note,
        npk: lineStops.npk,
      })
      .from(lineStops)
      .leftJoin(stopReasons, eq(lineStops.reasonId, stopReasons.id))
      .where(and(eq(lineStops.lineId, lineId), isNull(lineStops.endedAt)))
      .orderBy(desc(lineStops.startedAt))
      .limit(1);

    if (!baris) return null;
    return {
      id: baris.id,
      reasonId: baris.reasonId ?? null,
      reasonCode: baris.reasonCode ?? null,
      reasonName: baris.reasonName ?? null,
      isPlanned: baris.isPlanned ?? false,
      startedAt: baris.startedAt.toISOString(),
      endedAt: baris.endedAt ? baris.endedAt.toISOString() : null,
      note: baris.note ?? null,
      npk: baris.npk ?? null,
    };
  }

  /**
   * Alasan yang boleh dipilih di sebuah lini.
   *
   * Milik lini itu sendiri DAN yang berlaku se-pabrik. Daftar panjang berisi
   * alasan yang tidak relevan akan selalu diisi asal pilih, dan laporan loss
   * time kehilangan gunanya.
   */
  private async alasanUntukLini(plantId: number, lineId: number): Promise<AlasanBerhenti[]> {
    return this.db
      .select({
        id: stopReasons.id,
        code: stopReasons.code,
        name: stopReasons.name,
        category: stopReasons.category,
        isPlanned: stopReasons.isPlanned,
      })
      .from(stopReasons)
      .where(
        and(
          eq(stopReasons.plantId, plantId),
          eq(stopReasons.isActive, true),
          or(isNull(stopReasons.lineId), eq(stopReasons.lineId, lineId)),
        ),
      )
      .orderBy(asc(stopReasons.sortOrder), asc(stopReasons.code));
  }

  /**
   * Operator menekan tombol berhenti.
   *
   * Satu lini hanya boleh punya satu baris terbuka: menekan tombol dua kali
   * tidak membuat dua catatan yang saling tumpang tindih — yang kedua
   * mengembalikan baris yang sudah ada apa adanya.
   */
  async mulaiBerhenti(input: MulaiBerhentiInput, principal?: Principal): Promise<BerhentiLini> {
    const line = await this.findLine(input.lineCode);
    if (!line) throw new BadRequestException(`${REJECT_MESSAGES.LINE_NOT_FOUND} (${input.lineCode})`);

    const sudah = await this.berhentiTerbuka(line.id);
    if (sudah) return sudah;

    const [alasan] = await this.db
      .select({ id: stopReasons.id, plantId: stopReasons.plantId, lineId: stopReasons.lineId })
      .from(stopReasons)
      .where(and(eq(stopReasons.id, input.reasonId), eq(stopReasons.isActive, true)))
      .limit(1);
    if (!alasan || alasan.plantId !== line.plantId || (alasan.lineId && alasan.lineId !== line.id)) {
      throw new BadRequestException('Alasan berhenti itu tidak berlaku untuk lini ini.');
    }

    const sekarang = new Date();
    // Part yang sedang dikerjakan diambil dari scan terakhir hari ini — supaya
    // laporan loss time bisa dipilah per model tanpa menyuruh operator memilih.
    const [terakhir] = await this.db
      .select({ partId: scanEvents.partId })
      .from(scanEvents)
      .where(eq(scanEvents.lineId, line.id))
      .orderBy(desc(scanEvents.scannedAt))
      .limit(1);

    await this.db.insert(lineStops).values({
      plantId: line.plantId,
      lineId: line.id,
      partId: terakhir?.partId ?? null,
      reasonId: alasan.id,
      productionDate: productionDateKey(sekarang),
      startedAt: sekarang,
      npk: principal?.kind === 'user' ? principal.npk : null,
      userId: principal?.kind === 'user' ? principal.sub : null,
      note: input.note ?? null,
    });

    const dibuka = await this.berhentiTerbuka(line.id);
    if (!dibuka) throw new BadRequestException('Gagal mencatat berhenti. Coba lagi.');
    this.logger.log(`lini ${line.code} berhenti: ${dibuka.reasonName ?? dibuka.reasonCode}`);
    return dibuka;
  }

  /** Operator menekan "Mulai" — menutup baris berhenti yang terbuka. */
  async selesaiBerhenti(
    lineCode: string,
    penutup: 'TOMBOL' | 'SCAN' = 'TOMBOL',
  ): Promise<BerhentiLini | null> {
    const line = await this.findLine(lineCode);
    if (!line) throw new BadRequestException(`${REJECT_MESSAGES.LINE_NOT_FOUND} (${lineCode})`);
    return this.tutupBerhenti(line.id, penutup);
  }

  /**
   * Menutup berhenti yang terbuka di sebuah lini.
   *
   * Dipanggil tombol "Mulai" dan juga oleh scan produksi: operator yang lupa
   * menekan tombol tetap berproduksi, dan menolak scannya berarti hasil
   * produksi hilang hanya karena tombol terlewat. Penutupnya dicatat supaya
   * selisih keduanya bisa diperiksa nanti.
   */
  private async tutupBerhenti(
    lineId: number,
    penutup: 'TOMBOL' | 'SCAN' | 'SISTEM',
  ): Promise<BerhentiLini | null> {
    const terbuka = await this.berhentiTerbuka(lineId);
    if (!terbuka) return null;
    await this.db
      .update(lineStops)
      .set({ endedAt: new Date(), closedBy: penutup })
      .where(and(eq(lineStops.id, terbuka.id), isNull(lineStops.endedAt)));
    return { ...terbuka, endedAt: new Date().toISOString() };
  }

  /**
   * Kartu per lini untuk dashboard produksi.
   *
   * Satu kueri per lini terlalu mahal untuk layar yang menyala sepanjang hari
   * dan menampilkan puluhan lini, jadi semuanya dikumpulkan secara borongan:
   * hitungan hari ini, scan terakhir, dan berhenti yang terbuka.
   *
   * Statusnya DITURUNKAN di sini (statusLini), bukan dibaca dari kolom —
   * kolom status pasti melenceng begitu satu proses lupa memperbaruinya, dan
   * papan monitor di lantai produksi menjadi bohong tanpa ada yang menyadari.
   */
  async dashboard(plantCode?: string): Promise<DashboardProduksi> {
    const sekarang = new Date();
    const { start, end } = productionDayWindow(sekarang);

    const daftarLini = await this.db
      .select({
        id: lines.id,
        code: lines.code,
        name: lines.name,
        processType: lines.processType,
        sortOrder: lines.sortOrder,
        plantCode: plants.code,
      })
      .from(lines)
      .leftJoin(plants, eq(lines.plantId, plants.id))
      .where(
        plantCode
          ? and(eq(lines.isActive, true), eq(plants.code, plantCode))
          : eq(lines.isActive, true),
      )
      .orderBy(asc(lines.sortOrder), asc(lines.code));

    if (daftarLini.length === 0) {
      return { hariProduksi: productionDateKey(sekarang), kartu: [] };
    }
    const idLini = daftarLini.map((l) => l.id);

    /*
     * Hitungan hari produksi ini per lini.
     *
     * Waktu scan terakhir SENGAJA tidak diambil lewat MAX() di sini. Agregat
     * lewat sql mentah kembali sebagai string tanpa zona waktu, lalu diurai
     * sebagai waktu lokal — padahal kolomnya disimpan UTC. Selisih tujuh jam
     * membuat SELURUH lini terbaca IDLE di papan monitor, dan tidak ada yang
     * salah di layar kecuali semuanya. Waktunya diambil dari baris scan
     * terakhir di bawah, yang dibaca sebagai kolom sungguhan.
     */
    const hitungan = await this.db
      .select({
        lineId: scanEvents.lineId,
        pcs: sum(scanEvents.qty),
      })
      .from(scanEvents)
      .where(
        and(
          inArray(scanEvents.lineId, idLini),
          eq(scanEvents.kind, 'PRODUCTION'),
          gte(scanEvents.scannedAt, start),
          lt(scanEvents.scannedAt, end),
        ),
      )
      .groupBy(scanEvents.lineId);
    const perLini = new Map(hitungan.map((h) => [Number(h.lineId), h]));

    /*
     * Model yang sedang dikerjakan = part pada scan TERAKHIR hari ini, beserta
     * kapan model itu mulai dikerjakan. Diambil per lini lewat satu kueri yang
     * mengurutkan menurun, lalu baris pertama tiap lini yang dipakai.
     */
    const terakhirPerLini = await this.db
      .select({
        lineId: scanEvents.lineId,
        partId: scanEvents.partId,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
        scannedAt: scanEvents.scannedAt,
      })
      .from(scanEvents)
      .leftJoin(parts, eq(scanEvents.partId, parts.id))
      .where(
        and(
          inArray(scanEvents.lineId, idLini),
          eq(scanEvents.kind, 'PRODUCTION'),
          gte(scanEvents.scannedAt, start),
          lt(scanEvents.scannedAt, end),
        ),
      )
      .orderBy(desc(scanEvents.scannedAt));

    const modelLini = new Map<number, (typeof terakhirPerLini)[number]>();
    /** Scan paling awal untuk model yang sedang berjalan — "Start Date" di kartu. */
    const mulaiModel = new Map<number, Date>();
    for (const r of terakhirPerLini) {
      const id = Number(r.lineId);
      const ada = modelLini.get(id);
      if (!ada) {
        modelLini.set(id, r);
        mulaiModel.set(id, r.scannedAt);
        continue;
      }
      // Selama part-nya masih sama, mundurkan waktu mulainya.
      if (ada.partId === r.partId) mulaiModel.set(id, r.scannedAt);
    }

    const berhentiTerbuka = await this.db
      .select({
        lineId: lineStops.lineId,
        startedAt: lineStops.startedAt,
        reasonName: stopReasons.name,
        reasonCode: stopReasons.code,
      })
      .from(lineStops)
      .leftJoin(stopReasons, eq(lineStops.reasonId, stopReasons.id))
      .where(and(inArray(lineStops.lineId, idLini), isNull(lineStops.endedAt)));
    const stopLini = new Map(berhentiTerbuka.map((b) => [Number(b.lineId), b]));

    const kartu: KartuLini[] = daftarLini.map((l) => {
      const h = perLini.get(l.id);
      const model = modelLini.get(l.id);
      const stop = stopLini.get(l.id);
      const scanTerakhir = model?.scannedAt ?? null;
      return {
        lineCode: l.code,
        lineName: l.name,
        processType: l.processType,
        plantCode: l.plantCode ?? null,
        status: statusLini({
          adaBerhentiTerbuka: Boolean(stop),
          scanTerakhir,
          sekarang,
        }),
        partNumber: model?.partNumber ?? null,
        partName: model?.partName ?? null,
        backNumber: model?.backNumber ?? null,
        startedAt: mulaiModel.get(l.id)?.toISOString() ?? null,
        scanTerakhir: scanTerakhir ? scanTerakhir.toISOString() : null,
        qtyOk: Number(h?.pcs ?? 0),
        alasanBerhenti: stop ? (stop.reasonName ?? stop.reasonCode ?? 'Berhenti') : null,
        berhentiSejak: stop ? stop.startedAt.toISOString() : null,
      };
    });

    return { hariProduksi: productionDateKey(sekarang), kartu };
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
