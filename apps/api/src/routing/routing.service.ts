import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { eq, and, asc, inArray, type Database } from '@avicenna/db';
import { partProcesses, parts, plants, lines } from '@avicenna/db';
import { PROCESS_TYPES, type ProcessType } from '@avicenna/contracts';
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

    if (daftarPart.length === 0) return { proses: PROCESS_TYPES, baris: [] };

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

    return {
      proses: PROCESS_TYPES,
      baris: daftarPart.map((p) => ({ ...p, rute: perPart.get(p.partId) ?? {} })),
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
  ): Promise<{ partId: number; jumlah: number }> {
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
    }

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
      await tx.delete(partProcesses).where(eq(partProcesses.partId, partId));
      if (unik.length === 0) return;
      await tx.insert(partProcesses).values(
        unik.map((processType, i) => ({
          plantId: part.plantId,
          partId,
          processType,
          seqNo: (i + 1) * 10,
        })),
      );
    });

    this.logger.log(`rute ${part.partNumber}: ${unik.join(' → ') || '(dikosongkan)'}`);
    return { partId, jumlah: unik.length };
  }

  /** Line yang tersedia per jenis proses — untuk keterangan di layar. */
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
