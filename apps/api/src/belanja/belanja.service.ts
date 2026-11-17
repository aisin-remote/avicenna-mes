import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sebabGalatDb,
  sql,
  sum,
  type Database,
} from '@avicenna/db';
import {
  partPairings,
  kanbanEvents,
  kanbanPairings,
  kanbans,
  parts,
  plants,
  partProcesses,
} from '@avicenna/db';
import {
  alokasiBelanja,
  bacaKanban,
  fgSiapBelanja,
  KanbanTidakTerbaca,
  modeScanBerlaku,
  periksaBelanja,
  PESAN_BELANJA,
  syaratScan,
  toLocalDateKey,
  wipSiapBelanja,
  type KartuBelanja,
  type KomponenBelanja,
  type TolakBelanja,
} from '@avicenna/domain';
import type {
  BatalBelanjaInput,
  BatalBelanjaResult,
  KartuBelanjaRingkas,
  ScanBelanjaInput,
  ScanBelanjaResult,
  SesiBelanja,
  SimpanBelanjaInput,
  SimpanBelanjaResult,
  StasiunBelanja,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { ProcessTypeService } from '../master/process-type.service';
import type { Principal } from '../auth/auth.types';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Kartu kanban apa adanya dari database, cukup untuk seluruh pemeriksaan. */
interface KartuDb {
  kanbanId: number;
  partId: number;
  partNumber: string;
  partName: string | null;
  backNumber: string | null;
  serialNumber: string;
  qty: number;
  status: string;
  isActive: boolean;
  /** Kapan box-nya dinyatakan penuh. Disalin ke pasangan supaya pembatalan bisa memulihkannya. */
  producedAt: Date | null;
  cycleCount: number;
}

type Pencarian =
  | { ada: true; kartu: KartuDb }
  | { ada: false; sebab: 'BUKAN_KARTU' | 'TIDAK_TERDAFTAR' };

/**
 * ─── STASIUN BELANJA ────────────────────────────────────────────────────────
 *
 * Mencocokkan satu kartu FG dengan SATU kartu turunan dari BOM-nya — pengaman
 * warna/model, bukan hitungan isi (Handika, 13 Nov 2026).
 * Setelah cocok, kartu FG berstatus SHOPPED dan scan produksi di proses yang
 * mewajibkan belanja baru menerimanya. Lihat `periksaBelanja` di @avicenna/domain
 * untuk aturan jumlahnya, dan FLG_REQUIRE_PAIRING di TM_ROUTE_PROCESS untuk
 * proses mana yang mewajibkannya.
 *
 * ── Sesinya di layar, bukan di server ──────────────────────────────────────
 *
 * Setiap tembakan mengirim ulang seluruh daftar kartu WIP yang sudah ditembak,
 * dan server menghitung ulang semuanya. Scanner yang mati baterai di tengah
 * belanja berarti belanja itu hilang — bukan kartu WIP yang tertahan di server
 * entah sampai kapan padahal box-nya masih di rak.
 */
@Injectable()
export class BelanjaService {
  private readonly logger = new Logger(BelanjaService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly processTypes: ProcessTypeService,
  ) {}

  /* ── Pencarian dasar ─────────────────────────────────────────────────────── */

  private async pabrikDari(plantCode: string) {
    const [row] = await this.db
      .select({ id: plants.id, code: plants.code, name: plants.name })
      .from(plants)
      .where(and(eq(plants.code, plantCode), eq(plants.isActive, true)))
      .limit(1);
    if (!row) throw new NotFoundException(`Pabrik ${plantCode} tidak ada`);
    return row;
  }

  /**
   * Mencari kartu dari isi barcode.
   *
   * Seri saja TIDAK cukup: seri yang sama bisa ada pada part berbeda, dan itu
   * disengaja (lihat catatan di skema kanban). Karena itu back number ikut
   * dipakai bila kartunya menyebutkan.
   *
   * "Tidak terbaca" dibedakan dari "tidak terdaftar": yang pertama berarti
   * barcodenya bukan kartu kanban sama sekali — mis. label DN atau kartu ARES —
   * dan menyuruh orang mendaftarkan kartu yang sebenarnya tidak ada hanya
   * membuang waktunya.
   */
  private async cariKartu(plantId: number, raw: string): Promise<Pencarian> {
    let serial: string | undefined;
    let backNumber: string | undefined;
    try {
      const baca = bacaKanban(raw);
      serial = baca.serialNumber;
      backNumber = baca.backNumber;
    } catch (err) {
      if (err instanceof KanbanTidakTerbaca) return { ada: false, sebab: 'BUKAN_KARTU' };
      throw err;
    }
    if (!serial) return { ada: false, sebab: 'BUKAN_KARTU' };

    const rows = await this.db
      .select({
        kanbanId: kanbans.id,
        partId: kanbans.partId,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
        serialNumber: kanbans.serialNumber,
        qty: kanbans.qtyPerBox,
        status: kanbans.status,
        isActive: kanbans.isActive,
        producedAt: kanbans.producedAt,
        cycleCount: kanbans.cycleCount,
      })
      .from(kanbans)
      .innerJoin(parts, eq(parts.id, kanbans.partId))
      .where(and(eq(kanbans.plantId, plantId), eq(kanbans.serialNumber, serial)));

    const kartu = backNumber
      ? (rows.find((r) => r.backNumber === backNumber) ?? null)
      : (rows[0] ?? null);
    return kartu ? { ada: true, kartu } : { ada: false, sebab: 'TIDAK_TERDAFTAR' };
  }

  /**
   * Komponen yang ikut diperiksa saat belanja, menurut Part Pairing.
   *
   * Disaring dua kali, dan keduanya perlu:
   *
   *   sourceType MANUFACTURED   komponen beli datang lewat kartu ARES di
   *                             stasiun kanban, bukan dari rak barang setengah
   *                             jadi, dan tidak punya kartu WIP untuk discan
   *   prosesnya memakai kanban  part buatan sendiri yang prosesnya PART_SAJA
   *                             tidak pernah ditempeli kartu, jadi tidak ada
   *                             yang bisa dibawa ke belanja
   *
   * Tanpa penyaring pertama, operator akan disuruh men-scan kartu untuk baut
   * yang tidak punya kartu — dan belanja menjadi mustahil diselesaikan. Tanpa
   * penyaring kedua, hal yang sama terjadi pada part WIP antar-proses.
   */
  private async komponenBelanja(fgPartId: number): Promise<KomponenBelanja[]> {
    const hariIni = toLocalDateKey(new Date());

    const rows = await this.db
      .select({
        partId: parts.id,
        partNumber: parts.partNumber,
        partName: parts.name,
        qtyPer: partPairings.qtyPer,
        sourceType: parts.sourceType,
        processType: parts.processType,
      })
      .from(partPairings)
      .innerJoin(parts, eq(parts.id, partPairings.componentPartId))
      .where(
        and(
          eq(partPairings.parentPartId, fgPartId),
          lte(partPairings.effectiveFrom, hariIni),
          or(isNull(partPairings.effectiveTo), gte(partPairings.effectiveTo, hariIni)),
        ),
      );

    const katalog = await this.processTypes.katalog();
    const dipakai: KomponenBelanja[] = [];
    for (const r of rows) {
      if (r.sourceType !== 'MANUFACTURED') continue;
      const mode = modeScanBerlaku(katalog, { proses: r.processType });
      if (!syaratScan(katalog, mode, r.processType).kanbanWajib) continue;
      dipakai.push({
        partId: r.partId,
        partNumber: r.partNumber,
        qtyPer: Number(r.qtyPer),
      });
    }
    return dipakai;
  }

  private ringkas(k: KartuDb): KartuBelanjaRingkas {
    return {
      kanbanId: k.kanbanId,
      partId: k.partId,
      partNumber: k.partNumber,
      partName: k.partName,
      backNumber: k.backNumber,
      serialNumber: k.serialNumber,
      qty: k.qty,
    };
  }

  private kartuBelanja(k: KartuDb): KartuBelanja {
    return {
      kanbanId: k.kanbanId,
      partId: k.partId,
      partNumber: k.partNumber,
      serialNumber: k.serialNumber,
      qty: k.qty,
    };
  }

  /** Menyusun keadaan sesi dari daftar id kartu induk dan kartu turunan. */
  private async sesi(plantId: number, indukIds: number[], wipIds: number[]): Promise<SesiBelanja> {
    const semua = await this.kartuPerId(this.db, plantId, [...indukIds, ...wipIds]);
    const induk = urut(semua, indukIds);
    const kartuWip = urut(semua, wipIds);
    const komponen = induk[0] ? await this.komponenBelanja(induk[0].partId) : [];
    const hasil = periksaBelanja({
      kartuInduk: induk.map((k) => this.kartuBelanja(k)),
      komponen,
      kartuWip: kartuWip.map((k) => this.kartuBelanja(k)),
    });

    const namaKomponen = new Map(kartuWip.map((k) => [k.partId, k.partName]));
    return {
      induk: induk.map((k) => this.ringkas(k)),
      unitInduk: hasil.unitInduk,
      komponen: hasil.perKomponen.map((r) => ({
        partId: r.partId,
        partNumber: r.partNumber,
        partName: namaKomponen.get(r.partId) ?? null,
        dibutuhkan: r.dibutuhkan,
        dibawa: r.dibawa,
        jumlahKartu: r.jumlahKartu,
        kartuDibutuhkan: r.kartuDibutuhkan,
        dipilih: r.dipilih,
        cukup: r.cukup,
      })),
      // Urut tembakan: operator membaca baris terakhir untuk memastikan tembakan tadi masuk.
      kartuWip: kartuWip.map((k) => this.ringkas(k)),
      bolehDisimpan: hasil.bolehDisimpan,
      galat: hasil.galat,
    };
  }

  private async kartuPerId(db: Database | Tx, plantId: number, ids: number[]): Promise<KartuDb[]> {
    return db
      .select({
        kanbanId: kanbans.id,
        partId: kanbans.partId,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
        serialNumber: kanbans.serialNumber,
        qty: kanbans.qtyPerBox,
        status: kanbans.status,
        isActive: kanbans.isActive,
        producedAt: kanbans.producedAt,
        cycleCount: kanbans.cycleCount,
      })
      .from(kanbans)
      .innerJoin(parts, eq(parts.id, kanbans.partId))
      .where(and(eq(kanbans.plantId, plantId), inArray(kanbans.id, ids)));
  }

  private tolak(
    sebab: TolakBelanja,
    raw: string,
    sisi: 'INDUK' | 'TURUNAN' | null,
  ): ScanBelanjaResult {
    return { hasil: 'DITOLAK', pesan: PESAN_BELANJA[sebab], rawCode: raw, sisi, sesi: null };
  }

  /* ── Layar ───────────────────────────────────────────────────────────────── */

  async stasiun(plantCode: string): Promise<StasiunBelanja> {
    const pabrik = await this.pabrikDari(plantCode);

    const wajib = await this.db
      .selectDistinct({ processType: partProcesses.processType })
      .from(partProcesses)
      .where(
        and(
          eq(partProcesses.plantId, pabrik.id),
          eq(partProcesses.requirePairing, true),
          eq(partProcesses.isActive, true),
        ),
      );

    const menunggu = await this.db
      .select({
        fgKanbanId: kanbans.id,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        serialNumber: kanbans.serialNumber,
        jumlahKartu: count(kanbanPairings.id),
        unit: sum(kanbanPairings.qty),
        pairedAt: sql<Date>`min(${kanbanPairings.pairedAt})`,
        npk: sql<string | null>`min(${kanbanPairings.npk})`,
      })
      .from(kanbans)
      .innerJoin(kanbanPairings, eq(kanbanPairings.fgKanbanId, kanbans.id))
      .innerJoin(parts, eq(parts.id, kanbans.partId))
      .where(and(eq(kanbans.plantId, pabrik.id), eq(kanbans.status, 'SHOPPED')))
      .groupBy(kanbans.id, parts.partNumber, parts.backNumber, kanbans.serialNumber)
      .orderBy(desc(sql`min(${kanbanPairings.pairedAt})`))
      .limit(20);

    return {
      pabrik: { code: pabrik.code, name: pabrik.name },
      prosesWajib: wajib.map((w) => w.processType).filter((p): p is string => Boolean(p)),
      menunggu: menunggu.map((m) => ({
        fgKanbanId: m.fgKanbanId,
        partNumber: m.partNumber,
        backNumber: m.backNumber,
        serialNumber: m.serialNumber,
        jumlahKartu: Number(m.jumlahKartu ?? 0),
        unit: Number(m.unit ?? 0),
        pairedAt: new Date(m.pairedAt).toISOString(),
        npk: m.npk ?? null,
      })),
    };
  }

  /* ── Satu tembakan ──────────────────────────────────────────────────────── */

  /**
   * Satu tembakan di stasiun belanja.
   *
   * Sisinya ditentukan dari KARTUNYA, bukan dari tombol: belum ada induk →
   * kartu ini induk; part yang sama dengan induk dan turunan belum mulai →
   * tambah induk; selebihnya kartu turunan.
   */
  async scan(input: ScanBelanjaInput): Promise<ScanBelanjaResult> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const indukIds = input.indukKanbanIds;
    const wipIds = input.wipKanbanIds;
    const sisiTebak = indukIds.length === 0 ? 'INDUK' : 'TURUNAN';

    const cari = await this.cariKartu(pabrik.id, input.rawCode);
    if (!cari.ada) {
      if (cari.sebab === 'BUKAN_KARTU') return this.tolak('BUKAN_KARTU', input.rawCode, null);
      return this.tolak(
        sisiTebak === 'INDUK' ? 'FG_TIDAK_TERDAFTAR' : 'WIP_TIDAK_TERDAFTAR',
        input.rawCode,
        sisiTebak,
      );
    }
    const kartu = cari.kartu;
    if (!kartu.isActive) return this.tolak('FG_TIDAK_AKTIF', input.rawCode, sisiTebak);

    if (indukIds.length === 0) return this.bukaSesi(pabrik.id, kartu, input.rawCode);

    const sesiKini = () => this.sesi(pabrik.id, indukIds, wipIds);
    const ditolak = async (pesan: string, sisi: 'INDUK' | 'TURUNAN') => ({
      hasil: 'DITOLAK' as const,
      pesan,
      rawCode: input.rawCode,
      sisi,
      sesi: await sesiKini(),
    });

    if (indukIds.includes(kartu.kanbanId) || wipIds.includes(kartu.kanbanId)) {
      return ditolak(
        `Kartu ${kartu.partNumber} seri ${kartu.serialNumber} sudah ditembak di belanja ini.`,
        indukIds.includes(kartu.kanbanId) ? 'INDUK' : 'TURUNAN',
      );
    }

    const [indukPertama] = await this.kartuPerId(this.db, pabrik.id, [indukIds[0]!]);
    if (!indukPertama) return this.tolak('FG_TIDAK_TERDAFTAR', input.rawCode, 'INDUK');

    // Part yang sama dengan induk = kartu induk tambahan.
    if (kartu.partId === indukPertama.partId) {
      if (wipIds.length > 0) {
        return ditolak(
          'Kartu turunan sudah mulai discan — kartu induk tidak bisa ditambah lagi. ' +
            'Selesaikan belanja ini dulu.',
          'INDUK',
        );
      }
      const tolak = fgSiapBelanja(kartu.status);
      if (tolak) return { ...this.tolak(tolak, input.rawCode, 'INDUK'), sesi: await sesiKini() };
      const sesi = await this.sesi(pabrik.id, [...indukIds, kartu.kanbanId], wipIds);
      return {
        hasil: 'DITERIMA',
        pesan: `Induk ${sesi.induk.length} kartu · ${sesi.unitInduk} unit. Scan induk lagi, atau mulai scan turunan.`,
        rawCode: input.rawCode,
        sisi: 'INDUK',
        sesi,
      };
    }

    return this.tambahWip(pabrik.id, indukIds, kartu, input);
  }

  /** Tembakan pertama: kartu induk yang akan diisi. */
  private async bukaSesi(plantId: number, kartu: KartuDb, raw: string): Promise<ScanBelanjaResult> {
    const tolak = fgSiapBelanja(kartu.status);
    if (tolak) return this.tolak(tolak, raw, 'INDUK');

    /*
     * Kartu tanpa komponen yang bisa dibelanjakan ditolak di sini, bukan
     * dibiarkan membuka sesi yang mustahil disimpan.
     *
     * Dua sebabnya berbeda dan keduanya disebutkan: pasangannya memang belum
     * diisi, atau seluruh komponennya tidak berkartu (part beli lewat ARES).
     * Operator tidak bisa membedakannya sendiri, dan yang harus memperbaiki
     * keduanya bukan dia.
     */
    const komponen = await this.komponenBelanja(kartu.partId);
    if (komponen.length === 0) {
      return {
        hasil: 'DITOLAK',
        pesan:
          `${kartu.partNumber} tidak punya komponen berkartu, jadi tidak ada yang bisa ` +
          'dibelanjakan. Periksa Master Data › Part Pairing.',
        rawCode: raw,
        sisi: 'INDUK',
        sesi: null,
      };
    }

    const sesi = await this.sesi(plantId, [kartu.kanbanId], []);
    return {
      hasil: 'DITERIMA',
      pesan:
        `Belanja ${kartu.partNumber}. Scan induk lain bila ada, lalu kartu turunan: ` +
        sesi.komponen.map((k) => k.partNumber).join(' atau '),
      rawCode: raw,
      sisi: 'INDUK',
      sesi,
    };
  }

  /** Tembakan kartu turunan. */
  private async tambahWip(
    plantId: number,
    indukIds: number[],
    kartu: KartuDb,
    input: ScanBelanjaInput,
  ): Promise<ScanBelanjaResult> {
    const sudah = input.wipKanbanIds;
    const sesiKini = () => this.sesi(plantId, indukIds, sudah);
    const ditolak = async (pesan: string) => ({
      hasil: 'DITOLAK' as const,
      pesan,
      rawCode: input.rawCode,
      sisi: 'TURUNAN' as const,
      sesi: await sesiKini(),
    });

    const tolakWip = wipSiapBelanja(kartu.status);
    if (tolakWip) return ditolak(PESAN_BELANJA[tolakWip]);

    /*
     * Terikat pada kartu induk LAIN diperiksa dari tabel pasangan, bukan hanya
     * dari status. Statusnya bisa ikut benar, tetapi yang menjawab "terikat ke
     * siapa" hanya tabel ini — dan pesan yang menyebut nomor kartunya membuat
     * orang bisa mencarinya, bukan menebak.
     */
    const [terikat] = await this.db
      .select({ fgSerial: kanbans.serialNumber, fgPart: parts.partNumber })
      .from(kanbanPairings)
      .innerJoin(kanbans, eq(kanbans.id, kanbanPairings.fgKanbanId))
      .innerJoin(parts, eq(parts.id, kanbans.partId))
      .where(eq(kanbanPairings.wipKanbanId, kartu.kanbanId))
      .limit(1);
    if (terikat) {
      return ditolak(`Kartu ini sudah terikat pada ${terikat.fgPart} seri ${terikat.fgSerial}.`);
    }

    const sebelum = await sesiKini();
    const indukPart = sebelum.induk[0]?.partNumber ?? 'induk';
    if (sebelum.komponen.every((k) => k.partId !== kartu.partId)) {
      return ditolak(
        `${kartu.partNumber} bukan turunan ${indukPart} menurut BOM — model atau warnanya berbeda.`,
      );
    }
    const dipilih = sebelum.komponen.find((k) => k.dipilih);
    if (dipilih && dipilih.partId !== kartu.partId) {
      return ditolak(
        `Belanja ini memakai turunan ${dipilih.partNumber} — jangan dicampur dengan ${kartu.partNumber}.`,
      );
    }
    if (dipilih?.cukup) {
      return ditolak(`${dipilih.partNumber} sudah cukup ${dipilih.dibawa}/${dipilih.dibutuhkan}.`);
    }

    const sesi = await this.sesi(plantId, indukIds, [...sudah, kartu.kanbanId]);
    const komp = sesi.komponen.find((k) => k.partId === kartu.partId)!;
    const kartuKe = komp.kartuDibutuhkan
      ? ` · kartu ${komp.jumlahKartu}/${komp.kartuDibutuhkan}`
      : ` · ${komp.jumlahKartu} kartu`;
    return {
      hasil: 'DITERIMA',
      pesan: komp.cukup
        ? `${komp.partNumber} cukup ${komp.dibawa}/${komp.dibutuhkan}.`
        : `${komp.partNumber} ${komp.dibawa}/${komp.dibutuhkan}${kartuKe}`,
      rawCode: input.rawCode,
      sisi: 'TURUNAN',
      sesi,
    };
  }

  /* ── Menyimpan ──────────────────────────────────────────────────────────── */

  async simpan(input: SimpanBelanjaInput, principal?: Principal): Promise<SimpanBelanjaResult> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const npk = principal?.kind === 'user' ? principal.npk : null;
    const userId = principal?.kind === 'user' ? principal.sub : null;
    const sekarang = new Date();
    /** Mengikat seluruh kartu satu belanja — dipakai pembatalan. */
    const idBelanja = randomUUID();

    try {
      return await this.db.transaction(async (tx) => {
        /*
         * Seluruh kartu dikunci — kartu induk dan tiap kartu turunan.
         *
         * Pemeriksaan di layar terjadi sebelum ini dan tidak mengikat apa pun:
         * dua orang bisa membelanjakan box yang sama dalam selisih detik, dan
         * keduanya melihat "cukup" di layarnya masing-masing.
         */
        const ids = [...input.indukKanbanIds, ...input.wipKanbanIds];
        await tx.select({ id: kanbans.id }).from(kanbans).where(inArray(kanbans.id, ids)).for('update');

        const semua = await this.kartuPerId(tx, pabrik.id, ids);
        const induk = urut(semua, input.indukKanbanIds);
        const wip = urut(semua, input.wipKanbanIds);
        if (induk.length !== input.indukKanbanIds.length || wip.length !== input.wipKanbanIds.length) {
          return {
            hasil: 'DITOLAK' as const,
            pesan: 'Ada kartu yang tidak terdaftar di pabrik ini. Ulangi belanjanya.',
            sesi: null,
          };
        }

        // Status diperiksa ULANG di bawah kunci, bukan dipercaya dari layar.
        for (const k of induk) {
          const tolak = fgSiapBelanja(k.status);
          if (tolak) {
            return {
              hasil: 'DITOLAK' as const,
              pesan: `Induk seri ${k.serialNumber}: ${PESAN_BELANJA[tolak]}`,
              sesi: null,
            };
          }
        }
        for (const k of wip) {
          const tolak = wipSiapBelanja(k.status);
          if (tolak) {
            return {
              hasil: 'DITOLAK' as const,
              pesan: `${k.partNumber} seri ${k.serialNumber}: ${PESAN_BELANJA[tolak]}`,
              sesi: null,
            };
          }
        }

        const komponen = await this.komponenBelanja(induk[0]!.partId);
        const hasil = periksaBelanja({
          kartuInduk: induk.map((k) => this.kartuBelanja(k)),
          komponen,
          kartuWip: wip.map((k) => this.kartuBelanja(k)),
        });
        if (!hasil.bolehDisimpan) {
          return {
            hasil: 'DITOLAK' as const,
            pesan: hasil.galat[0] ?? 'Belanja belum lengkap.',
            sesi: await this.sesi(pabrik.id, input.indukKanbanIds, input.wipKanbanIds),
          };
        }

        const qtyPer = komponen.find((k) => k.partId === wip[0]!.partId)!.qtyPer;
        const alokasi = alokasiBelanja(
          induk.map((k) => this.kartuBelanja(k)),
          wip.map((k) => this.kartuBelanja(k)),
          qtyPer,
        );
        const perId = new Map(semua.map((k) => [k.kanbanId, k]));

        await tx.insert(kanbanPairings).values(
          alokasi.map((a) => ({
            fgKanbanId: a.indukKanbanId,
            wipKanbanId: a.wipKanbanId,
            qty: Math.round(a.qty),
            // Keadaan box SEBELUM kartunya dilepas, supaya pembatalan bisa
            // memasangnya kembali dengan waktu produksi yang benar.
            wipProducedAt: perId.get(a.wipKanbanId)!.producedAt,
            npk,
            userId,
            pairedAt: sekarang,
          })),
        );

        // Kartu induk menunggu discan produksi.
        await tx
          .update(kanbans)
          .set({ status: 'SHOPPED' })
          .where(inArray(kanbans.id, input.indukKanbanIds));

        /*
         * Kartu box DILEPAS DI SINI — inilah titik yang membuat interlock ke
         * hulu bekerja: kartunya kembali ke pos, box-nya berjalan ke proses
         * berikutnya diantar kartu induk. Satu per satu karena cycleCount tiap
         * kartu berbeda: satu putaran penuh adalah pergi-dan-kembali.
         */
        for (const k of wip) {
          await tx
            .update(kanbans)
            .set({
              status: 'AVAILABLE',
              producedAt: null,
              releasedAt: sekarang,
              cycleCount: k.cycleCount + 1,
            })
            .where(eq(kanbans.id, k.kanbanId));
        }

        /*
         * Event per pasangan di kedua kartu (riwayat bisa dibaca dari kartunya
         * sendiri), plus satu RELEASED per kartu turunan. `belanja` mengikat
         * seluruh kartu satu belanja untuk pembatalan.
         */
        const meta = (lain: Record<string, unknown>) => ({ module: 'BELANJA', belanja: idBelanja, ...lain });
        await tx.insert(kanbanEvents).values([
          ...alokasi.flatMap((a) => [
            {
              kanbanId: a.indukKanbanId,
              type: 'SHOPPED' as const,
              pairedKanbanId: a.wipKanbanId,
              qty: Math.round(a.qty),
              userId,
              occurredAt: sekarang,
              meta: meta({ sisi: 'INDUK', serialPasangan: perId.get(a.wipKanbanId)!.serialNumber }),
            },
            {
              kanbanId: a.wipKanbanId,
              type: 'SHOPPED' as const,
              pairedKanbanId: a.indukKanbanId,
              qty: Math.round(a.qty),
              userId,
              occurredAt: sekarang,
              meta: meta({ sisi: 'BOX', serialPasangan: perId.get(a.indukKanbanId)!.serialNumber }),
            },
          ]),
          ...wip.map((k) => ({
            kanbanId: k.kanbanId,
            type: 'RELEASED' as const,
            qty: k.qty,
            userId,
            occurredAt: sekarang,
            meta: meta({ sebab: 'dibelanjakan proses berikutnya' }),
          })),
        ]);

        this.logger.log(
          `belanja ${induk[0]!.partNumber}: ${induk.length} induk ` +
            `(${induk.map((k) => k.serialNumber).join(', ')}), ${wip.length} kartu ${wip[0]!.partNumber}`,
        );

        return {
          hasil: 'DITERIMA' as const,
          pesan:
            `Belanja tersimpan. ${induk.length} kartu induk siap discan produksi, ` +
            `${wip.length} kartu turunan kembali ke pos.`,
          sesi: null,
        };
      });
    } catch (err) {
      /*
       * Penjaga sesungguhnya adalah kunci baris dan status kartu: dua belanja
       * yang menyertakan box yang sama diserialkan oleh `for('update')`, dan
       * yang kedua membaca statusnya sudah AVAILABLE lalu ditolak.
       */
      if (sebabGalatDb(err) === 'DUPLIKAT') {
        return {
          hasil: 'DITOLAK',
          pesan: 'Ada kartu yang baru saja dipakai orang lain. Ulangi belanjanya.',
          sesi: null,
        };
      }
      throw err;
    }
  }

  /* ── Membatalkan ────────────────────────────────────────────────────────── */

  /**
   * Membatalkan belanja sebuah kartu induk — beserta SELURUH kartu induk satu
   * belanjanya, karena satu box turunan bisa terbagi ke beberapa induk.
   * Belanja lama (sebelum ada penanda `belanja`) dibatalkan per kartu.
   */
  async batal(input: BatalBelanjaInput, principal?: Principal): Promise<BatalBelanjaResult> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const userId = principal?.kind === 'user' ? principal.sub : null;
    const sekarang = new Date();
    const tolak = (pesan: string) => ({ hasil: 'DITOLAK' as const, pesan, indukDibatalkan: [] });

    return this.db.transaction(async (tx) => {
      // Belanja mana kartu ini — dari event SHOPPED terakhirnya.
      const [terakhir] = await tx
        .select({ belanja: sql<string | null>`${kanbanEvents.meta}->>'belanja'` })
        .from(kanbanEvents)
        .where(
          and(
            eq(kanbanEvents.kanbanId, input.fgKanbanId),
            eq(kanbanEvents.type, 'SHOPPED'),
            sql`${kanbanEvents.meta}->>'sisi' = 'INDUK'`,
          ),
        )
        .orderBy(desc(kanbanEvents.id))
        .limit(1);

      const indukIds = terakhir?.belanja
        ? [
            ...new Set(
              (
                await tx
                  .select({ id: kanbanEvents.kanbanId })
                  .from(kanbanEvents)
                  .where(
                    and(
                      eq(kanbanEvents.type, 'SHOPPED'),
                      sql`${kanbanEvents.meta}->>'sisi' = 'INDUK'`,
                      sql`${kanbanEvents.meta}->>'belanja' = ${terakhir.belanja}`,
                    ),
                  )
              ).map((r) => r.id),
            ),
          ]
        : [input.fgKanbanId];

      const induk = await tx
        .select({
          id: kanbans.id,
          status: kanbans.status,
          plantId: kanbans.plantId,
          serialNumber: kanbans.serialNumber,
        })
        .from(kanbans)
        .where(inArray(kanbans.id, indukIds))
        .for('update');

      const milik = induk.find((k) => k.id === input.fgKanbanId);
      if (!milik || milik.plantId !== pabrik.id) return tolak(PESAN_BELANJA.FG_TIDAK_TERDAFTAR);
      if (milik.status !== 'SHOPPED') {
        return tolak('Kartu ini tidak sedang dalam keadaan sudah belanja.');
      }
      /*
       * Satu induk yang sudah discan produksi berarti isi turunannya sudah
       * terpakai sebagian — memasang kembali box turunan ke rak akan
       * menghidupkan barang yang sudah tidak ada.
       */
      const sudahProduksi = induk.filter((k) => k.status !== 'SHOPPED');
      if (sudahProduksi.length > 0) {
        return tolak(
          `Tidak bisa dibatalkan: induk seri ${sudahProduksi.map((k) => k.serialNumber).join(', ')} ` +
            'dari belanja yang sama sudah discan produksi. Selesaikan saja scan produksinya.',
        );
      }

      const pasangan = await tx
        .select({
          fgKanbanId: kanbanPairings.fgKanbanId,
          wipKanbanId: kanbanPairings.wipKanbanId,
          qty: kanbanPairings.qty,
          wipProducedAt: kanbanPairings.wipProducedAt,
        })
        .from(kanbanPairings)
        .where(inArray(kanbanPairings.fgKanbanId, indukIds));
      const wipIds = [...new Set(pasangan.map((p) => p.wipKanbanId))];

      /*
       * Pembatalan harus MEMASANG KEMBALI kartu box ke box-nya, dan itu hanya
       * mungkin kalau kartu itu belum dipakai lagi di lini pembuatnya. Kalau
       * sudah, kartu itu kini membawa barang LAIN — pembatalannya ditolak.
       */
      const kartuBox =
        wipIds.length > 0
          ? await tx
              .select({
                id: kanbans.id,
                status: kanbans.status,
                cycleCount: kanbans.cycleCount,
                serialNumber: kanbans.serialNumber,
              })
              .from(kanbans)
              .where(inArray(kanbans.id, wipIds))
              .for('update')
          : [];
      const sudahJalan = kartuBox.filter((k) => k.status !== 'AVAILABLE');
      if (sudahJalan.length > 0) {
        return tolak(
          `Tidak bisa dibatalkan: kartu ${sudahJalan.map((k) => k.serialNumber).join(', ')} ` +
            'sudah dipakai lagi di lini. Selesaikan saja scan produksinya.',
        );
      }

      await tx.delete(kanbanPairings).where(inArray(kanbanPairings.fgKanbanId, indukIds));
      await tx.update(kanbans).set({ status: 'AVAILABLE' }).where(inArray(kanbans.id, indukIds));

      /*
       * Kartu box kembali ke PRODUCED dengan waktu produksi ASLINYA, dan
       * putarannya dikurangi — pergi-dan-kembali itu tidak benar-benar terjadi.
       */
      for (const k of kartuBox) {
        const p = pasangan.find((x) => x.wipKanbanId === k.id);
        await tx
          .update(kanbans)
          .set({
            status: 'PRODUCED',
            producedAt: p?.wipProducedAt ?? null,
            cycleCount: Math.max(0, k.cycleCount - 1),
          })
          .where(eq(kanbans.id, k.id));
      }

      // Koreksi dicatat sebagai ADJUSTED: baris event lama tidak pernah diubah.
      await tx.insert(kanbanEvents).values([
        ...indukIds.map((id) => ({
          kanbanId: id,
          type: 'ADJUSTED' as const,
          userId,
          occurredAt: sekarang,
          meta: { module: 'BELANJA', sebab: 'belanja dibatalkan', belanja: terakhir?.belanja ?? null },
        })),
        ...pasangan.map((p) => ({
          kanbanId: p.wipKanbanId,
          type: 'ADJUSTED' as const,
          pairedKanbanId: p.fgKanbanId,
          qty: p.qty,
          userId,
          occurredAt: sekarang,
          meta: { module: 'BELANJA', sebab: 'belanja dibatalkan' },
        })),
      ]);

      this.logger.log(
        `belanja dibatalkan: ${indukIds.length} induk, ${kartuBox.length} kartu turunan kembali ke box`,
      );
      return {
        hasil: 'DITERIMA' as const,
        pesan:
          `Belanja dibatalkan: ${indukIds.length} kartu induk kembali kosong, ` +
          `${kartuBox.length} kartu turunan dipasang kembali ke box-nya.`,
        indukDibatalkan: indukIds,
      };
    });
  }

  /* ── Dipakai scan produksi ──────────────────────────────────────────────── */

  /**
   * Menutup pasangan belanja saat scan produksi menerima kartu induknya.
   *
   * Yang dilakukan hanya MENGHAPUS barisnya. Kartu box-nya sudah lepas sejak
   * belanja — di situlah ia benar-benar dicopot — jadi di sini tidak ada status
   * kartu yang berubah selain kartu induknya sendiri, yang diurus pemanggilnya.
   *
   * Riwayat pasangannya tetap ada: TT_KANBAN_EVENT bertipe SHOPPED di kedua
   * kartu, append-only. Jadi menghapus baris keadaan-sekarang di sini tidak
   * menghilangkan jawaban atas "box apa saja yang masuk ke box ini".
   *
   * Dijalankan DI DALAM transaksi scan: pasangan yang masih tertinggal setelah
   * induknya tercatat produksi akan membuat kartu induk itu terbaca seolah
   * masih menunggu, dan muncul terus di daftar tunggu stasiun belanja.
   */
  async tutupPasangan(tx: Tx, fgKanbanId: number): Promise<number> {
    const pasangan = await tx
      .select({ id: kanbanPairings.id })
      .from(kanbanPairings)
      .where(eq(kanbanPairings.fgKanbanId, fgKanbanId));
    if (pasangan.length === 0) return 0;

    await tx.delete(kanbanPairings).where(eq(kanbanPairings.fgKanbanId, fgKanbanId));
    return pasangan.length;
  }

  /**
   * Apakah box part ini sedang menunggu dibelanjakan proses berikutnya.
   *
   * Dipakai HANYA untuk memperjelas pesan penolakan di stasiun scan: kartu yang
   * masih PRODUCED ditolak oleh aturan yang sudah ada, tetapi "sudah discan
   * produksi" tidak menjelaskan apa pun kepada orang yang kehabisan kartu.
   * Yang sebenarnya terjadi: proses berikutnya belum mengambil box-nya.
   *
   * Hanya dipanggil di jalur PENOLAKAN, jadi biayanya tidak menempel pada scan
   * yang berhasil.
   */
  async menungguBelanjaHilir(plantId: number, partId: number): Promise<boolean> {
    const hariIni = toLocalDateKey(new Date());
    const [induk] = await this.db
      .select({ id: partPairings.id })
      .from(partPairings)
      .innerJoin(
        partProcesses,
        and(
          eq(partProcesses.plantId, plantId),
          eq(partProcesses.partId, partPairings.parentPartId),
          eq(partProcesses.requirePairing, true),
          eq(partProcesses.isActive, true),
        ),
      )
      .where(
        and(
          eq(partPairings.componentPartId, partId),
          lte(partPairings.effectiveFrom, hariIni),
          or(isNull(partPairings.effectiveTo), gte(partPairings.effectiveTo, hariIni)),
        ),
      )
      .limit(1);
    return Boolean(induk);
  }

  /** Apakah kartu FG ini sudah belanja — dipakai interlock di scan produksi. */
  async sudahBelanja(kanbanId: number): Promise<boolean> {
    const [ada] = await this.db
      .select({ id: kanbanPairings.id })
      .from(kanbanPairings)
      .where(eq(kanbanPairings.fgKanbanId, kanbanId))
      .limit(1);
    return Boolean(ada);
  }
}

/** Baris kartu dalam urutan id yang diminta (urutan tembakan). */
function urut(kartu: KartuDb[], ids: number[]): KartuDb[] {
  const peta = new Map(kartu.map((k) => [k.kanbanId, k]));
  return ids.map((id) => peta.get(id)).filter((k): k is KartuDb => Boolean(k));
}
