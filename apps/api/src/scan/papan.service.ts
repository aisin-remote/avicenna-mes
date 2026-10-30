import { Injectable, BadRequestException } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  inArray,
  ne,
  sql,
  sum,
  type Database,
  lines,
  plants,
  parts,
  customers,
  productionPlans,
  scanEvents,
  kanbans,
  kanbanItems,
  workTimes,
} from '@avicenna/db';
import { productionDayWindow } from '@avicenna/domain';
import type { PapanAntrean, PapanStasiun } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';

/**
 * Papan perintah kerja di lini finish good.
 *
 * ── Kenapa ini layar yang BERBEDA, bukan layar scan yang dipercantik ────────
 *
 * Layar scan menjawab "apa yang barusan discan". Papan ini menjawab "apa yang
 * sedang dikerjakan, sudah berapa, dan apa berikutnya" — pertanyaan yang
 * dipakai leader dari jarak lima meter, bukan operator yang memegang barang.
 * Karena itu isinya datang dari ANTREAN RENCANA, bukan dari riwayat scan:
 * nomor perintah kerja, qty rencana, dan urutan berikutnya semuanya baris
 * TT_PRODUCTION_PLAN. Scan hanya menambah satu angka ke baris yang berjalan.
 *
 * Bila lini belum punya rencana hari ini, papannya tetap tampil dengan bagian
 * rencana kosong — bukan galat. Itu keadaan yang sah selama rencana produksi
 * belum diisi, dan layar yang menolak tampil hanya membuat lini berhenti.
 */

@Injectable()
export class PapanService {
  constructor(@InjectDb() private readonly db: Database) {}

  async papan(lineCode: string, batasAntrean = 10): Promise<PapanStasiun> {
    const [line] = await this.db
      .select({
        id: lines.id,
        code: lines.code,
        name: lines.name,
        processType: lines.processType,
        plantId: lines.plantId,
        plantCode: plants.code,
        plantName: plants.name,
      })
      .from(lines)
      .innerJoin(plants, eq(plants.id, lines.plantId))
      .where(eq(lines.code, lineCode))
      .limit(1);
    if (!line) throw new BadRequestException(`Line ${lineCode} tidak ditemukan`);

    /*
     * Hari PRODUKSI, bukan hari kalender — sama dengan penghitung di layar
     * scan. Pada pukul 02:00 shift malam, rencana yang berlaku masih rencana
     * tanggal kemarin, dan papan yang memakai CURRENT_DATE akan kosong di
     * tengah shift tanpa sebab yang terlihat.
     */
    const { start } = productionDayWindow(new Date());
    const tanggalProduksi = tanggalLokal(start);

    const barisRencana = await this.db
      .select({
        id: productionPlans.id,
        seqNo: productionPlans.seqNo,
        cycle: productionPlans.cycle,
        orderQty: productionPlans.orderQty,
        status: productionPlans.status,
        partId: productionPlans.partId,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        partName: parts.name,
        qtyPerKanban: parts.qtyPerKanban,
        customerCode: customers.code,
        customerName: customers.name,
        customerDock: customers.dock,
        dock: productionPlans.dock,
      })
      .from(productionPlans)
      .innerJoin(parts, eq(parts.id, productionPlans.partId))
      .leftJoin(customers, eq(customers.id, productionPlans.customerId))
      .where(
        and(
          eq(productionPlans.lineId, line.id),
          eq(productionPlans.planDate, tanggalProduksi),
          ne(productionPlans.status, 'CANCELLED'),
        ),
      )
      .orderBy(asc(productionPlans.cycle), asc(productionPlans.seqNo));

    const dasar = {
      line: {
        code: line.code,
        name: line.name,
        processType: line.processType,
        plantCode: line.plantCode,
        plantName: line.plantName,
      },
      shift: await this.shiftSekarang(line.plantId),
      tanggalProduksi,
    };

    if (barisRencana.length === 0) {
      return {
        ...dasar,
        berjalan: null,
        antrean: [],
        catatan: `Belum ada rencana produksi untuk ${line.code} tanggal ${tanggalProduksi}.`,
      };
    }

    const aktual = await this.aktualPerRencana(barisRencana.map((r) => r.id));

    /*
     * Baris yang BERJALAN: urutan terkecil yang belum penuh.
     *
     * Bukan yang berstatus RUNNING — status itu diubah manusia dan gampang
     * tertinggal; yang tidak pernah bohong adalah hitungannya sendiri. Begitu
     * sebuah baris genap, baris berikutnya otomatis menjadi yang berjalan,
     * tanpa seorang pun harus menekan apa pun.
     */
    const berjalanRow =
      barisRencana.find((r) => (aktual.get(r.id)?.pcs ?? 0) < r.orderQty) ?? null;

    const antrean: PapanAntrean[] = barisRencana.slice(0, batasAntrean).map((r, i) => ({
      urut: i + 1,
      planId: r.id,
      nomor: this.nomorPerintah(line.code, tanggalProduksi, r.seqNo),
      backNumber: r.backNumber,
      partNumber: r.partNumber,
      aktualPcs: aktual.get(r.id)?.pcs ?? 0,
      rencanaPcs: r.orderQty,
      status: r.status,
      berjalan: berjalanRow?.id === r.id,
    }));

    if (!berjalanRow) {
      return {
        ...dasar,
        berjalan: null,
        antrean,
        catatan: 'Seluruh rencana hari ini sudah genap.',
      };
    }

    const isiKartu = await this.unitPerKanban(berjalanRow.partId, berjalanRow.qtyPerKanban);
    const pcs = aktual.get(berjalanRow.id)?.pcs ?? 0;

    /*
     * Kemajuan box DITURUNKAN dari jumlah pcs, bukan dihitung dari kartu.
     *
     * Box diisi berurutan, jadi sisa bagi terhadap kapasitas adalah isi box
     * yang sedang berjalan. Sisa 0 dengan pcs > 0 berarti box barusan genap —
     * ditampilkan penuh, bukan kosong, supaya operator melihat "1/1" pada
     * detik box itu selesai dan bukan "0/1".
     */
    const sisa = isiKartu > 0 ? pcs % isiKartu : 0;
    const kotakTerisi = pcs > 0 && sisa === 0 ? isiKartu : sisa;

    return {
      ...dasar,
      antrean,
      catatan: null,
      berjalan: {
        planId: berjalanRow.id,
        nomor: this.nomorPerintah(line.code, tanggalProduksi, berjalanRow.seqNo),
        /*
         * Kode customer + dock, bukan nama panjangnya.
         *
         * Baris ini duduk tepat di atas back number raksasa dan harus muat
         * dalam satu baris pada layar lebar mana pun. "Toyota Motor
         * Manufacturing Indonesia" memaksa barisnya membungkus dan mendorong
         * angka utama turun; "TMMIN A1" mengatakan hal yang sama kepada orang
         * yang berdiri di lini. Dock diambil dari rencananya dulu — satu
         * customer bisa punya beberapa dock, dan yang menentukan dock mana
         * adalah perintah kerjanya.
         */
        customer:
          [berjalanRow.customerCode, berjalanRow.dock ?? berjalanRow.customerDock]
            .filter(Boolean)
            .join(' ') || null,
        partNumber: berjalanRow.partNumber,
        backNumber: berjalanRow.backNumber,
        partName: berjalanRow.partName,
        unitPerKanban: isiKartu,
        rencanaPcs: berjalanRow.orderQty,
        rencanaKanban: isiKartu > 0 ? Math.ceil(berjalanRow.orderQty / isiKartu) : 0,
        aktualPcs: pcs,
        aktualKanban: aktual.get(berjalanRow.id)?.kanban ?? 0,
        kotakTerisi,
        kotakKapasitas: isiKartu,
      },
    };
  }

  /** `ASCC01/20261022/032` — kode lini, tanggal rapat, urutan tiga angka. */
  private nomorPerintah(kodeLini: string, tanggal: string, seq: number): string {
    return `${kodeLini}/${tanggal.replaceAll('-', '')}/${String(seq).padStart(3, '0')}`;
  }

  /**
   * Hitungan nyata per baris rencana: berapa pcs, dan berapa kartu kanban.
   *
   * Keduanya DIHITUNG, bukan diturunkan satu dari yang lain. Pcs datang dari
   * scan yang menempel ke baris rencana; kartu datang dari kartu yang
   * benar-benar ditempeli unit hasil scan itu (TT_KANBAN_ITEM.INT_SCAN_EVENT_ID).
   * Menurunkan kartu dari pcs akan menyembunyikan box yang belum tertutup, dan
   * justru box itulah yang menentukan apakah barangnya sudah bisa dikirim.
   */
  private async aktualPerRencana(
    planIds: number[],
  ): Promise<Map<number, { pcs: number; kanban: number }>> {
    const peta = new Map<number, { pcs: number; kanban: number }>();
    if (planIds.length === 0) return peta;

    const pcsRows = await this.db
      .select({ planId: scanEvents.productionPlanId, pcs: sum(scanEvents.qty) })
      .from(scanEvents)
      .where(inArray(scanEvents.productionPlanId, planIds))
      .groupBy(scanEvents.productionPlanId);
    for (const r of pcsRows) {
      if (r.planId == null) continue;
      peta.set(r.planId, { pcs: Number(r.pcs ?? 0), kanban: 0 });
    }

    const kartuRows = await this.db
      .select({
        planId: scanEvents.productionPlanId,
        kanban: sql<number>`count(distinct ${kanbanItems.kanbanId})`,
      })
      .from(kanbanItems)
      .innerJoin(scanEvents, eq(scanEvents.id, kanbanItems.scanEventId))
      .where(inArray(scanEvents.productionPlanId, planIds))
      .groupBy(scanEvents.productionPlanId);
    for (const r of kartuRows) {
      if (r.planId == null) continue;
      const ada = peta.get(r.planId) ?? { pcs: 0, kanban: 0 };
      peta.set(r.planId, { ...ada, kanban: Number(r.kanban ?? 0) });
    }

    return peta;
  }

  /**
   * Isi satu kartu untuk sebuah part.
   *
   * Diambil dari kartu yang BEREDAR lebih dulu, baru master part. Kartu yang
   * sudah dicetak membawa angka yang benar-benar dipakai di lapangan; master
   * boleh saja sudah diubah untuk kartu cetakan berikutnya, dan memakai angka
   * baru untuk box yang sedang diisi membuat box dinyatakan penuh pada jumlah
   * yang tidak sesuai isinya.
   */
  private async unitPerKanban(partId: number, qtyPerKanban: number | null): Promise<number> {
    const [kartu] = await this.db
      .select({ unit: kanbans.unitPerKanban })
      .from(kanbans)
      .where(and(eq(kanbans.partId, partId), eq(kanbans.isActive, true)))
      .orderBy(asc(kanbans.id))
      .limit(1);
    /*
     * INT_UNIT_PER_KANBAN, BUKAN INT_QTY_PER_BOX.
     *
     * Keduanya ada di kartu dan mudah tertukar, tetapi yang menentukan kapan
     * sebuah box dinyatakan penuh — dan karena itu yang dipakai jalur scan —
     * adalah unit per kanban. Sempat kupakai qtyPerBox di sini, dan akibatnya
     * papan menampilkan "0/5" untuk kartu yang bagi operator sudah penuh pada
     * hitungan pertama. Angka di papan harus angka yang sama dengan yang
     * dipakai menolak scan, kalau tidak papan dan lini berdebat.
     */
    return Math.max(1, kartu?.unit ?? qtyPerKanban ?? 1);
  }

  /**
   * Shift yang sedang berjalan menurut jam kerja pabrik.
   *
   * Kosong bila TM_WORK_TIME belum diisi — papannya menampilkan tanda hubung,
   * bukan menebak "SHIFT1". Menebak shift membuat laporan per shift terbagi
   * di tempat yang salah, dan itu baru ketahuan saat angkanya dibandingkan.
   */
  private async shiftSekarang(plantId: number): Promise<string | null> {
    const jam = await this.db
      .select({ code: workTimes.code, mulai: workTimes.startTime, selesai: workTimes.endTime })
      .from(workTimes)
      .where(and(eq(workTimes.plantId, plantId), eq(workTimes.isActive, true)))
      .orderBy(asc(workTimes.startTime));
    if (jam.length === 0) return null;

    const now = new Date();
    const menit = now.getHours() * 60 + now.getMinutes();
    const keMenit = (t: string | null) => {
      if (!t) return null;
      const [h, m] = t.split(':');
      return Number(h) * 60 + Number(m);
    };

    for (const j of jam) {
      const a = keMenit(j.mulai);
      const b = keMenit(j.selesai);
      if (a === null || b === null) continue;
      // Shift malam melewati tengah malam: rentangnya terbelah.
      const cocok = a <= b ? menit >= a && menit < b : menit >= a || menit < b;
      if (cocok) return j.code;
    }
    return null;
  }
}

/** Tanggal lokal sebagai YYYY-MM-DD, tanpa lewat UTC. */
function tanggalLokal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}
