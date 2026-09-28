import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { eq, and, asc, inArray, count, type Database } from '@avicenna/db';
import { partProcesses, routeProcesses, parts, plants, lines } from '@avicenna/db';
import { PROCESS_TYPES, menghasilkanFinishGood, type ProcessType } from '@avicenna/contracts';
import { periksaRute } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';

export interface BarisMatriks {
  partId: number;
  partNumber: string;
  backNumber: string | null;
  name: string;
  project: string | null;
  plantId: number;
  plantCode: string | null;
  /** processType -> urutan. Tidak ada kunci = part tidak melewati proses itu. */
  rute: Record<string, number>;
  /**
   * Masalah pada rute ini, kosong bila wajar.
   *
   * Ikut dihitung saat MEMBACA, bukan hanya saat menyimpan: rute bisa tersimpan
   * sebelum sebuah aturan ada, atau menjadi tidak wajar karena jenis proses
   * berubah. Rute rusak yang tidak terlihat akan tetap rusak sampai ada yang
   * kebetulan membukanya.
   */
  masalah: string[];
}

/**
 * Rute proses per part.
 *
 * ── Kenapa disimpan dan diubah sebagai SATU rute utuh ───────────────────────
 *
 * Rute adalah urutan, bukan kumpulan baris lepas. Menyunting baris satu per
 * satu membuka keadaan setengah jadi yang tidak masuk akal: part yang sedang
 * punya dua langkah bernomor sama, atau punya Machining tetapi Casting-nya
 * sudah terhapus. Validasi scan membaca rute pada saat yang sama operator
 * men-scan, jadi keadaan setengah jadi itu benar-benar terlihat di lantai
 * produksi.
 *
 * Karena itu penyimpanan mengganti SELURUH rute satu part dalam satu transaksi.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /** Seluruh part beserta rutenya — bahan layar matriks. */
  async matriks(plantId?: number): Promise<{
    proses: readonly ProcessType[];
    /** Proses yang lininya menghasilkan finish good — dipakai layar menandainya. */
    finishGood: readonly ProcessType[];
    /** plantId -> processType -> push SAP aktif. Dari TM_ROUTE_PROCESS. */
    sapAktif: Record<number, Record<string, boolean>>;
    /**
     * plantId -> proses yang TERDAFTAR di master Rute Proses (Integrasi).
     * Inilah yang menentukan kolom mana yang boleh diklik untuk part pabrik itu.
     */
    prosesTerdaftar: Record<number, ProcessType[]>;
    /**
     * plantId -> proses yang DIPAKAI (lini atau rute part) tetapi tidak ada di
     * master. Tetap ditampilkan dengan tanda: proses yang masih dipakai tidak
     * boleh lenyap dari layar hanya karena barisnya dihapus dari master.
     */
    prosesTakTerdaftar: Record<number, Array<{ processType: ProcessType; lini: number; rute: number }>>;
    baris: BarisMatriks[];
  }> {
    const daftarPart = await this.db
      .select({
        partId: parts.id,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        name: parts.name,
        project: parts.project,
        plantId: parts.plantId,
        plantCode: plants.code,
      })
      .from(parts)
      .leftJoin(plants, eq(parts.plantId, plants.id))
      .where(
        plantId ? and(eq(parts.isActive, true), eq(parts.plantId, plantId)) : eq(parts.isActive, true),
      )
      .orderBy(plants.code, parts.project, parts.partNumber);

    const finishGood = PROCESS_TYPES.filter(menghasilkanFinishGood);
    if (daftarPart.length === 0) {
      return { proses: PROCESS_TYPES, finishGood, sapAktif: {}, prosesTerdaftar: {}, prosesTakTerdaftar: {}, baris: [] };
    }

    const langkah = await this.db
      .select({
        partId: partProcesses.partId,
        processType: partProcesses.processType,
        seqNo: partProcesses.seqNo,
      })
      .from(partProcesses)
      .where(
        and(
          inArray(
            partProcesses.partId,
            daftarPart.map((p) => p.partId),
          ),
          eq(partProcesses.isActive, true),
        ),
      )
      .orderBy(asc(partProcesses.seqNo));

    const perPart = new Map<number, Record<string, number>>();
    for (const l of langkah) {
      const r = perPart.get(l.partId) ?? {};
      r[l.processType] = l.seqNo;
      perPart.set(l.partId, r);
    }

    /*
     * Penanda SAP per PROSES per pabrik — bukan per part.
     *
     * Pengaturannya ada di TM_ROUTE_PROCESS; matriks hanya menampilkannya
     * sebagai tanda baca-saja di kolom, supaya leader tahu proses mana yang
     * terhubung SAP tanpa membuka menu Integrasi.
     */
    const aturan = await this.db
      .select({
        plantId: routeProcesses.plantId,
        processType: routeProcesses.processType,
        productionEnabled: routeProcesses.sapProductionEnabled,
        transferEnabled: routeProcesses.sapTransferEnabled,
      })
      .from(routeProcesses)
      .where(eq(routeProcesses.isActive, true));
    const sapAktif: Record<number, Record<string, boolean>> = {};
    const prosesTerdaftar: Record<number, ProcessType[]> = {};
    for (const a of aturan) {
      (sapAktif[a.plantId] ??= {})[a.processType] = a.productionEnabled || a.transferEnabled;
      (prosesTerdaftar[a.plantId] ??= []).push(a.processType);
    }

    /*
     * Proses yang dipakai tetapi tidak terdaftar di master.
     *
     * Master Rute Proses (Integrasi) menentukan kolom matriks. Tetapi menghapus
     * barisnya tidak menghapus lini yang berjenis proses itu, rute part yang
     * melewatinya, maupun scan yang sudah tercatat — dan kolom yang hilang
     * membuat rute part tampak lebih pendek dari kenyataan. Yang dipakai tetap
     * ditampilkan, dengan tanda dan angka supaya orang tahu sebabnya.
     */
    const liniPerPabrik = await this.db
      .select({ plantId: lines.plantId, processType: lines.processType, n: count() })
      .from(lines)
      .where(eq(lines.isActive, true))
      .groupBy(lines.plantId, lines.processType);

    const pabrikPart = new Map(daftarPart.map((p) => [p.partId, p.plantId]));
    const rutePerPabrik = new Map<string, number>();
    for (const l of langkah) {
      const k = `${pabrikPart.get(l.partId)}|${l.processType}`;
      rutePerPabrik.set(k, (rutePerPabrik.get(k) ?? 0) + 1);
    }

    const prosesTakTerdaftar: Record<number, Array<{ processType: ProcessType; lini: number; rute: number }>> = {};
    const kandidat = new Map<string, { plantId: number; processType: ProcessType; lini: number; rute: number }>();
    for (const l of liniPerPabrik) {
      kandidat.set(`${l.plantId}|${l.processType}`, {
        plantId: l.plantId, processType: l.processType, lini: Number(l.n), rute: 0,
      });
    }
    for (const [k, n] of rutePerPabrik) {
      const [plantId, processType] = k.split('|');
      const ada = kandidat.get(k);
      if (ada) ada.rute = n;
      else kandidat.set(k, { plantId: Number(plantId), processType: processType as ProcessType, lini: 0, rute: n });
    }
    for (const c of kandidat.values()) {
      if (prosesTerdaftar[c.plantId]?.includes(c.processType)) continue;
      (prosesTakTerdaftar[c.plantId] ??= []).push({ processType: c.processType, lini: c.lini, rute: c.rute });
    }

    return {
      proses: PROCESS_TYPES,
      finishGood,
      sapAktif,
      prosesTerdaftar,
      prosesTakTerdaftar,
      baris: daftarPart.map((p) => {
        const rute = perPart.get(p.partId) ?? {};
        return {
          ...p,
          rute,
          masalah: periksaRute(
            Object.entries(rute).map(([processType, seqNo]) => ({
              processType: processType as ProcessType,
              seqNo,
            })),
          ),
        };
      }),
    };
  }

  /**
   * Mengganti seluruh rute satu part.
   *
   * `proses` diberikan TERURUT sesuai jalannya barang. Nomor urut dibangkitkan
   * di sini dengan jarak 10, bukan diterima dari pemanggil: nomor hanya alat
   * pengurut, dan membiarkan layar menentukannya berarti dua layar bisa
   * memakai skema penomoran yang berbeda pada tabel yang sama.
   */
  async simpanRute(
    partId: number,
    proses: ProcessType[],
  ): Promise<{ partId: number; jumlah: number; masalah: string[] }> {
    const [part] = await this.db
      .select({ id: parts.id, plantId: parts.plantId, partNumber: parts.partNumber })
      .from(parts)
      .where(eq(parts.id, partId))
      .limit(1);
    if (!part) throw new BadRequestException(`Part id=${partId} tidak ditemukan`);

    const unik = [...new Set(proses)];
    if (unik.length !== proses.length) {
      throw new BadRequestException('Satu proses tidak boleh muncul dua kali dalam satu rute');
    }
    for (const p of unik) {
      if (!PROCESS_TYPES.includes(p)) {
        throw new BadRequestException(`Jenis proses "${p}" tidak dikenal`);
      }

    /*
     * Proses yang BARU ditambahkan harus terdaftar di master Rute Proses
     * (Integrasi) untuk pabrik part itu. Yang sudah ada di rute lama boleh
     * tetap — mencabutnya harus tetap bisa, walau masternya sudah dihapus.
     *
     * Diperiksa di server, bukan hanya dengan menonaktifkan tombol di layar:
     * endpoint ini bisa dipanggil langsung.
     */
    const terdaftar = new Set(
      (
        await this.db
          .select({ processType: routeProcesses.processType })
          .from(routeProcesses)
          .where(and(eq(routeProcesses.plantId, part.plantId), eq(routeProcesses.isActive, true)))
      ).map((r) => r.processType),
    );
    const sebelumnya = new Set(
      (await this.db.select({ processType: partProcesses.processType }).from(partProcesses).where(eq(partProcesses.partId, partId)))
        .map((r) => r.processType),
    );
    const tidakTerdaftar = unik.filter((p) => !terdaftar.has(p) && !sebelumnya.has(p));
    if (tidakTerdaftar.length > 0) {
      throw new BadRequestException(
        `Proses ${tidakTerdaftar.join(', ')} tidak terdaftar untuk pabrik ini. ` +
          'Daftarkan dulu di Integrasi › Rute Proses.',
      );
    }
    }

    /*
     * Aturan lini finish good jadi PERINGATAN, bukan penolakan.
     *
     * Dulu ditolak, dan itu membuat rute ber-FG mustahil disusun: matriks
     * menyimpan tiap klik, sedangkan satu langkah FG tanpa Delivery ditolak
     * ("tidak seharusnya melewati lini finish good") dan satu Delivery tanpa
     * FG juga ditolak ("tidak akan punya kanban"). Mana pun yang diklik lebih
     * dulu, rutenya buntu — orang tidak bisa menyusun MACHINING_FG →
     * DELIVERY sama sekali.
     *
     * Rute yang belum lengkap adalah keadaan yang WAJAR saat menyunting, jadi
     * yang benar adalah menyimpannya lalu menandainya. Peringatannya ikut
     * kembali ke layar dan tetap terlihat di kolom keterangan matriks sampai
     * rutenya dibereskan. Yang tetap ditolak hanyalah yang merusak data:
     * proses kembar, proses tak dikenal, dan proses yang belum terdaftar di
     * master Rute Proses pabrik itu.
     */
    const masalah = periksaRute(unik.map((processType, i) => ({ processType, seqNo: (i + 1) * 10 })));

    /*
     * Hapus lalu tulis ulang, di dalam SATU transaksi.
     *
     * Menyandingkan yang lama dengan yang baru terdengar lebih hemat, tetapi
     * unique index (partId, seqNo) membuatnya bergantung pada urutan operasi:
     * menggeser langkah ke atas menabrak baris yang belum sempat dipindahkan.
     * Mengganti seluruhnya menghindari seluruh kelas persoalan itu, dan
     * jumlah barisnya per part hanya segelintir.
     */
    await this.db.transaction(async (tx) => {
      const lama = await tx.select().from(partProcesses).where(eq(partProcesses.partId, partId));
      const perProses = new Map(lama.map((l) => [l.processType, l]));
      await tx.delete(partProcesses).where(eq(partProcesses.partId, partId));
      if (unik.length === 0) return;
      await tx.insert(partProcesses).values(
        unik.map((processType, i) => {
          const sebelum = perProses.get(processType);
          return {
            plantId: part.plantId,
            partId,
            processType,
            seqNo: (i + 1) * 10,
            lineId: sebelum?.lineId ?? null,
            isActive: sebelum?.isActive ?? true,
          };
        }),
      );
    });

    this.logger.log(
      `rute ${part.partNumber}: ${unik.join(' → ') || '(dikosongkan)'}` +
        (masalah.length > 0 ? ` — belum wajar: ${masalah.join('; ')}` : ''),
    );
    return { partId, jumlah: unik.length, masalah };
  }

  /** Lini aktif per jenis proses — kepala kolom matriks. */
  async liniPerProses(): Promise<Record<string, string[]>> {
    const rows = await this.db
      .select({ processType: lines.processType, code: lines.code })
      .from(lines)
      .where(eq(lines.isActive, true))
      .orderBy(lines.sortOrder);
    const peta: Record<string, string[]> = {};
    for (const r of rows) (peta[r.processType] ??= []).push(r.code);
    return peta;
  }
}
