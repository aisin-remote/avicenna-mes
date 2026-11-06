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
  routeProcesses,
} from '@avicenna/db';
import {
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
 * Mencocokkan satu kartu FG dengan kartu WIP yang isinya sesuai Part Pairing.
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

  /** Menyusun keadaan sesi dari kartu FG dan daftar id kartu WIP. */
  private async sesi(plantId: number, fg: KartuDb, wipIds: number[]): Promise<SesiBelanja> {
    const kartuWip = wipIds.length > 0 ? await this.kartuPerId(this.db, plantId, wipIds) : [];
    const komponen = await this.komponenBelanja(fg.partId);
    const hasil = periksaBelanja({
      kartuFg: this.kartuBelanja(fg),
      komponen,
      kartuWip: kartuWip.map((k) => this.kartuBelanja(k)),
    });

    const namaKomponen = new Map(kartuWip.map((k) => [k.partId, k.partName]));
    return {
      fg: this.ringkas(fg),
      unitFg: hasil.unitFg,
      komponen: hasil.perKomponen.map((r) => ({
        partId: r.partId,
        partNumber: r.partNumber,
        partName: namaKomponen.get(r.partId) ?? null,
        dibutuhkan: r.dibutuhkan,
        dibawa: r.dibawa,
        jumlahKartu: r.jumlahKartu,
        selisih: r.selisih,
        pas: r.pas,
        tidakAkanPas: r.tidakAkanPas ?? null,
      })),
      /*
       * Urutannya mengikuti urutan penembakan, bukan urutan id: operator
       * membaca baris terakhir untuk memastikan tembakan tadi masuk.
       */
      kartuWip: wipIds
        .map((id) => kartuWip.find((k) => k.kanbanId === id))
        .filter((k): k is KartuDb => Boolean(k))
        .map((k) => this.ringkas(k)),
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

  private tolak(sebab: TolakBelanja, raw: string, sisi: 'FG' | 'WIP' | null): ScanBelanjaResult {
    return { hasil: 'DITOLAK', pesan: PESAN_BELANJA[sebab], rawCode: raw, sisi, sesi: null };
  }

  /* ── Layar ───────────────────────────────────────────────────────────────── */

  async stasiun(plantCode: string): Promise<StasiunBelanja> {
    const pabrik = await this.pabrikDari(plantCode);

    const wajib = await this.db
      .select({ processType: routeProcesses.processType })
      .from(routeProcesses)
      .where(and(eq(routeProcesses.plantId, pabrik.id), eq(routeProcesses.requirePairing, true)));

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

  async scan(input: ScanBelanjaInput): Promise<ScanBelanjaResult> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const sisi = input.fgKanbanId ? 'WIP' : 'FG';

    const cari = await this.cariKartu(pabrik.id, input.rawCode);
    if (!cari.ada) {
      if (cari.sebab === 'BUKAN_KARTU') return this.tolak('BUKAN_KARTU', input.rawCode, null);
      return this.tolak(
        sisi === 'FG' ? 'FG_TIDAK_TERDAFTAR' : 'WIP_TIDAK_TERDAFTAR',
        input.rawCode,
        sisi,
      );
    }
    const kartu = cari.kartu;
    if (!kartu.isActive) return this.tolak('FG_TIDAK_AKTIF', input.rawCode, sisi);

    return sisi === 'FG'
      ? this.bukaSesi(pabrik.id, kartu, input.rawCode)
      : this.tambahWip(pabrik.id, kartu, input);
  }

  /** Tembakan pertama: kartu FG yang akan diisi. */
  private async bukaSesi(plantId: number, kartu: KartuDb, raw: string): Promise<ScanBelanjaResult> {
    const tolak = fgSiapBelanja(kartu.status);
    if (tolak) return this.tolak(tolak, raw, 'FG');

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
        sisi: 'FG',
        sesi: null,
      };
    }

    const sesi = await this.sesi(plantId, kartu, []);
    return {
      hasil: 'DITERIMA',
      pesan: `Belanja untuk ${kartu.partNumber} — ambil ${sesi.komponen
        .map((k) => `${k.dibutuhkan} ${k.partNumber}`)
        .join(', ')}`,
      rawCode: raw,
      sisi: 'FG',
      sesi,
    };
  }

  /** Tembakan berikutnya: kartu WIP yang dibawa. */
  private async tambahWip(
    plantId: number,
    kartu: KartuDb,
    input: ScanBelanjaInput,
  ): Promise<ScanBelanjaResult> {
    const [fg] = await this.kartuPerId(this.db, plantId, [input.fgKanbanId!]);
    if (!fg) return this.tolak('FG_TIDAK_TERDAFTAR', input.rawCode, 'FG');

    const sudah = input.wipKanbanIds;
    if (sudah.includes(kartu.kanbanId)) {
      return {
        hasil: 'DITOLAK',
        pesan: `Kartu ${kartu.partNumber} seri ${kartu.serialNumber} sudah ditembak di sesi ini.`,
        rawCode: input.rawCode,
        sisi: 'WIP',
        sesi: await this.sesi(plantId, fg, sudah),
      };
    }

    // Kartu FG yang ikut tertembak sebagai kartu WIP: kejadian biasa di lantai,
    // dan pesannya harus menyebut apa yang terjadi, bukan "bukan komponen".
    if (kartu.kanbanId === fg.kanbanId) {
      return {
        hasil: 'DITOLAK',
        pesan: 'Itu kartu FG yang sedang dibelanjakan, bukan kartu WIP.',
        rawCode: input.rawCode,
        sisi: 'WIP',
        sesi: await this.sesi(plantId, fg, sudah),
      };
    }

    const tolakWip = wipSiapBelanja(kartu.status);
    if (tolakWip) {
      return {
        ...this.tolak(tolakWip, input.rawCode, 'WIP'),
        sesi: await this.sesi(plantId, fg, sudah),
      };
    }

    /*
     * Terikat pada kartu FG LAIN diperiksa dari tabel pasangan, bukan hanya
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
      return {
        hasil: 'DITOLAK',
        pesan: `Kartu ini sudah terikat pada ${terikat.fgPart} seri ${terikat.fgSerial}.`,
        rawCode: input.rawCode,
        sisi: 'WIP',
        sesi: await this.sesi(plantId, fg, sudah),
      };
    }

    const sesi = await this.sesi(plantId, fg, [...sudah, kartu.kanbanId]);
    const bukan = sesi.komponen.every((k) => k.partId !== kartu.partId);
    if (bukan) {
      return {
        hasil: 'DITOLAK',
        pesan: `${kartu.partNumber} bukan komponen ${fg.partNumber} menurut Part Pairing.`,
        rawCode: input.rawCode,
        sisi: 'WIP',
        sesi: await this.sesi(plantId, fg, sudah),
      };
    }

    const komp = sesi.komponen.find((k) => k.partId === kartu.partId)!;
    return {
      hasil: 'DITERIMA',
      pesan: komp.pas
        ? `${komp.partNumber} pas — ${komp.dibawa}/${komp.dibutuhkan}`
        : `${komp.partNumber} ${komp.dibawa}/${komp.dibutuhkan}`,
      rawCode: input.rawCode,
      sisi: 'WIP',
      sesi,
    };
  }

  /* ── Menyimpan ──────────────────────────────────────────────────────────── */

  async simpan(input: SimpanBelanjaInput, principal?: Principal): Promise<SimpanBelanjaResult> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const npk = principal?.kind === 'user' ? principal.npk : null;
    const userId = principal?.kind === 'user' ? principal.sub : null;
    const sekarang = new Date();

    try {
      return await this.db.transaction(async (tx) => {
        /*
         * Seluruh kartu dikunci — kartu FG dan tiap kartu WIP.
         *
         * Pemeriksaan di layar terjadi sebelum ini dan tidak mengikat apa pun:
         * dua orang bisa membelanjakan box yang sama dalam selisih detik, dan
         * keduanya melihat "pas" di layarnya masing-masing.
         */
        const [fg] = await tx
          .select({ id: kanbans.id, status: kanbans.status, plantId: kanbans.plantId })
          .from(kanbans)
          .where(eq(kanbans.id, input.fgKanbanId))
          .for('update');

        if (!fg || fg.plantId !== pabrik.id) {
          return { hasil: 'DITOLAK' as const, pesan: PESAN_BELANJA.FG_TIDAK_TERDAFTAR, sesi: null };
        }
        const tolakFg = fgSiapBelanja(fg.status);
        if (tolakFg) {
          return { hasil: 'DITOLAK' as const, pesan: PESAN_BELANJA[tolakFg], sesi: null };
        }

        await tx
          .select({ id: kanbans.id })
          .from(kanbans)
          .where(inArray(kanbans.id, input.wipKanbanIds))
          .for('update');

        const [fgKartu] = await this.kartuPerId(tx, pabrik.id, [input.fgKanbanId]);
        const wip = await this.kartuPerId(tx, pabrik.id, input.wipKanbanIds);
        if (!fgKartu || wip.length !== input.wipKanbanIds.length) {
          return {
            hasil: 'DITOLAK' as const,
            pesan: 'Ada kartu yang tidak terdaftar di pabrik ini. Ulangi belanjanya.',
            sesi: null,
          };
        }

        // Status diperiksa ULANG di bawah kunci, bukan dipercaya dari layar.
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

        const komponen = await this.komponenBelanja(fgKartu.partId);
        const hasil = periksaBelanja({
          kartuFg: this.kartuBelanja(fgKartu),
          komponen,
          kartuWip: wip.map((k) => this.kartuBelanja(k)),
        });
        if (!hasil.bolehDisimpan) {
          return {
            hasil: 'DITOLAK' as const,
            pesan: hasil.galat[0] ?? 'Jumlahnya belum pas.',
            sesi: await this.sesi(pabrik.id, fgKartu, input.wipKanbanIds),
          };
        }

        await tx.insert(kanbanPairings).values(
          wip.map((k) => ({
            fgKanbanId: fgKartu.kanbanId,
            wipKanbanId: k.kanbanId,
            qty: k.qty,
            // Keadaan box SEBELUM kartunya dilepas, supaya pembatalan bisa
            // memasangnya kembali dengan waktu produksi yang benar.
            wipProducedAt: k.producedAt,
            npk,
            userId,
            pairedAt: sekarang,
          })),
        );

        // Kartu induk menunggu discan produksi.
        await tx.update(kanbans).set({ status: 'SHOPPED' }).where(eq(kanbans.id, fgKartu.kanbanId));

        /*
         * Kartu box DILEPAS DI SINI — inilah titik yang membuat interlock ke
         * hulu bekerja.
         *
         * Di sinilah kartunya benar-benar dicopot dari box dan dibawa pulang ke
         * posnya; box-nya berjalan ke proses berikutnya diantar kartu induk.
         * Selama belum dibelanjakan, kartu itu masih PRODUCED dan stasiun scan
         * menolaknya — jadi lini pembuatnya tidak bisa membuat box baru sebelum
         * box lamanya terambil.
         *
         * Satu per satu karena cycleCount tiap kartu berbeda: satu putaran
         * penuh adalah pergi-dan-kembali, dan di sinilah kembalinya.
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
         * Dua event per pasangan, satu di tiap kartu — plus pelepasan.
         *
         * Riwayat sebuah kartu harus bisa dibaca dari kartunya sendiri. Satu
         * baris saja memaksa setiap penelusuran menyapu tabel mencari dirinya
         * di kolom pasangan — dan yang lupa melakukannya akan melaporkan kartu
         * box seolah tidak pernah dibelanjakan.
         *
         * Kartu box mendapat DUA event: SHOPPED (box-nya masuk ke kartu induk)
         * dan RELEASED (kartunya kembali ke pos). Keduanya terjadi bersamaan,
         * dan keduanya perlu — yang pertama menjawab "box ini masuk ke mana",
         * yang kedua menutup putaran kartunya.
         */
        await tx.insert(kanbanEvents).values(
          wip.flatMap((k) => [
            {
              kanbanId: fgKartu.kanbanId,
              type: 'SHOPPED' as const,
              pairedKanbanId: k.kanbanId,
              qty: k.qty,
              userId,
              occurredAt: sekarang,
              meta: { module: 'BELANJA', sisi: 'INDUK', serialPasangan: k.serialNumber },
            },
            {
              kanbanId: k.kanbanId,
              type: 'SHOPPED' as const,
              pairedKanbanId: fgKartu.kanbanId,
              qty: k.qty,
              userId,
              occurredAt: sekarang,
              meta: { module: 'BELANJA', sisi: 'BOX', serialPasangan: fgKartu.serialNumber },
            },
            {
              kanbanId: k.kanbanId,
              type: 'RELEASED' as const,
              pairedKanbanId: fgKartu.kanbanId,
              qty: k.qty,
              userId,
              occurredAt: sekarang,
              meta: { module: 'BELANJA', sebab: 'dibelanjakan proses berikutnya' },
            },
          ]),
        );

        this.logger.log(
          `belanja ${fgKartu.partNumber} seri ${fgKartu.serialNumber}: ` +
            `${wip.length} kartu, ${hasil.perKomponen.map((k) => `${k.partNumber} ${k.dibawa}`).join(', ')}`,
        );

        return {
          hasil: 'DITERIMA' as const,
          pesan:
            `Belanja tersimpan. Kartu ${fgKartu.serialNumber} siap discan produksi, ` +
            `${wip.length} kartu kembali ke pos.`,
          sesi: null,
        };
      });
    } catch (err) {
      /*
       * Penjaga sesungguhnya adalah kunci baris dan status kartu: dua belanja
       * yang menyertakan box yang sama diserialkan oleh `for('update')`, dan
       * yang kedua membaca statusnya sudah AVAILABLE lalu ditolak.
       *
       * Duplikat masih mungkin datang dari arah lain, dan pesannya tetap
       * diarahkan ke tindakan yang benar.
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

  async batal(
    input: BatalBelanjaInput,
    principal?: Principal,
  ): Promise<{ hasil: 'DITERIMA' | 'DITOLAK'; pesan: string }> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const userId = principal?.kind === 'user' ? principal.sub : null;
    const sekarang = new Date();

    return this.db.transaction(async (tx) => {
      const [fg] = await tx
        .select({ id: kanbans.id, status: kanbans.status, plantId: kanbans.plantId })
        .from(kanbans)
        .where(eq(kanbans.id, input.fgKanbanId))
        .for('update');
      if (!fg || fg.plantId !== pabrik.id) {
        return { hasil: 'DITOLAK' as const, pesan: PESAN_BELANJA.FG_TIDAK_TERDAFTAR };
      }
      if (fg.status !== 'SHOPPED') {
        return {
          hasil: 'DITOLAK' as const,
          pesan: 'Kartu ini tidak sedang dalam keadaan sudah belanja.',
        };
      }

      const pasangan = await tx
        .select({
          wipKanbanId: kanbanPairings.wipKanbanId,
          qty: kanbanPairings.qty,
          wipProducedAt: kanbanPairings.wipProducedAt,
        })
        .from(kanbanPairings)
        .where(eq(kanbanPairings.fgKanbanId, input.fgKanbanId));

      /*
       * Pembatalan harus MEMASANG KEMBALI kartu box ke box-nya, dan itu hanya
       * mungkin kalau kartu itu belum dipakai lagi.
       *
       * Belanja melepaskan kartunya ke pos, jadi lini pembuatnya boleh saja
       * sudah memakainya untuk box baru. Kalau itu terjadi, kartu itu sekarang
       * membawa barang LAIN — dan menariknya kembali ke box lama berarti box
       * baru kehilangan kartunya tanpa ada yang tahu. Lebih baik pembatalannya
       * ditolak dengan menyebut kartu mana yang sudah jalan.
       */
      const kartuBox =
        pasangan.length > 0
          ? await tx
              .select({
                id: kanbans.id,
                status: kanbans.status,
                cycleCount: kanbans.cycleCount,
                serialNumber: kanbans.serialNumber,
              })
              .from(kanbans)
              .where(
                inArray(
                  kanbans.id,
                  pasangan.map((p) => p.wipKanbanId),
                ),
              )
              .for('update')
          : [];

      const sudahJalan = kartuBox.filter((k) => k.status !== 'AVAILABLE');
      if (sudahJalan.length > 0) {
        return {
          hasil: 'DITOLAK' as const,
          pesan:
            `Tidak bisa dibatalkan: kartu ${sudahJalan.map((k) => k.serialNumber).join(', ')} ` +
            'sudah dipakai lagi di lini. Selesaikan saja scan produksinya.',
        };
      }

      await tx.delete(kanbanPairings).where(eq(kanbanPairings.fgKanbanId, input.fgKanbanId));
      await tx.update(kanbans).set({ status: 'AVAILABLE' }).where(eq(kanbans.id, input.fgKanbanId));

      /*
       * Kartu box kembali ke PRODUCED dengan waktu produksi ASLINYA: box-nya
       * masih penuh dan masih di rak, dan waktu itulah yang dipakai laporan
       * maupun FIFO. Putarannya ikut dikurangi — pergi-dan-kembali itu tidak
       * benar-benar terjadi, dan angka yang menggelembung membuat pertanyaan
       * "kartu mana yang sudah terlalu sering dipakai" dijawab keliru.
       */
      for (const p of pasangan) {
        const kartu = kartuBox.find((k) => k.id === p.wipKanbanId);
        await tx
          .update(kanbans)
          .set({
            status: 'PRODUCED',
            producedAt: p.wipProducedAt,
            cycleCount: Math.max(0, (kartu?.cycleCount ?? 1) - 1),
          })
          .where(eq(kanbans.id, p.wipKanbanId));
      }

      // Koreksi dicatat sebagai ADJUSTED, mengikuti aturan TT_KANBAN_EVENT:
      // baris lama tidak pernah diubah atau dihapus.
      await tx.insert(kanbanEvents).values([
        {
          kanbanId: input.fgKanbanId,
          type: 'ADJUSTED' as const,
          userId,
          occurredAt: sekarang,
          meta: { module: 'BELANJA', sebab: 'belanja dibatalkan', jumlahKartu: pasangan.length },
        },
        ...pasangan.map((p) => ({
          kanbanId: p.wipKanbanId,
          type: 'ADJUSTED' as const,
          pairedKanbanId: input.fgKanbanId,
          qty: p.qty,
          userId,
          occurredAt: sekarang,
          meta: { module: 'BELANJA', sebab: 'belanja dibatalkan' },
        })),
      ]);

      this.logger.log(
        `belanja kartu ${input.fgKanbanId} dibatalkan: ${pasangan.length} kartu lepas`,
      );
      return {
        hasil: 'DITERIMA' as const,
        pesan: `Belanja dibatalkan. ${pasangan.length} kartu dipasang kembali ke box-nya.`,
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
      .innerJoin(parts, eq(parts.id, partPairings.parentPartId))
      .innerJoin(
        routeProcesses,
        and(
          eq(routeProcesses.plantId, plantId),
          eq(routeProcesses.processType, parts.processType),
          eq(routeProcesses.requirePairing, true),
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
