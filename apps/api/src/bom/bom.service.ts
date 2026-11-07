import { Injectable, Logger } from '@nestjs/common';
import { eq, type Database } from '@avicenna/db';
import { parts, plants } from '@avicenna/db';
import type { DaftarPartFg, PartMasterBom, PohonPartFg } from '@avicenna/contracts';
import {
  akarBom,
  normalkanNomorPart,
  ratakanPohonBom,
  type BarisBomSap,
} from '@avicenna/domain';
import { InjectDb } from '../db/db.module';
import { RoutingService } from '../routing/routing.service';
import { StagingDbService } from '../staging/staging-db.service';
import { tabelAman } from '../staging/staging-push.service';
import { TABEL_BOM } from '../staging/staging-tables';

const bersih = (v: string | null | undefined) => v?.trim() || null;

/**
 * BOM SAP dipadukan dengan part dan rute Avicenna.
 *
 * BOM hanya dibaca: pemiliknya SAP, dan salinan yang disunting di sini akan
 * berbeda diam-diam dari yang dipakai SAP. Yang disunting orang adalah part dan
 * rutenya, lewat master generik.
 */
@Injectable()
export class BomService {
  private readonly logger = new Logger(BomService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly staging: StagingDbService,
    private readonly routing: RoutingService,
  ) {}

  private async bacaBom(): Promise<BarisBomSap[]> {
    const baris = await this.staging.query<{
      induk: string;
      komponen: string;
      qty: number | null;
      uom: string | null;
      source: string | null;
      sloc: string | null;
      phantom: string | null;
    }>(
      `SELECT CHR_PART_NO_FG AS induk, CHR_PART_NO_COMP AS komponen, INT_QTY AS qty, CHR_UOM AS uom, ` +
        `CHR_SOURCE AS source, CHR_SLOC AS sloc, CHR_FLG_PHANTOM AS phantom ` +
        `FROM ${tabelAman(TABEL_BOM)} WHERE INT_FLG_DELETE = 0 ORDER BY INT_ID`,
    );
    return baris.map((b) => ({
      induk: b.induk.trim(),
      komponen: b.komponen.trim(),
      qty: b.qty,
      uom: bersih(b.uom),
      source: bersih(b.source),
      sloc: bersih(b.sloc),
      phantom: bersih(b.phantom),
    }));
  }

  private galatStaging(err: unknown): string {
    this.logger.warn(`BOM SAP tidak terbaca: ${String(err)}`);
    return 'BOM SAP tidak bisa dibaca dari staging. Periksa sambungan ke server staging.';
  }

  /** Part master per nomor baku. Nomor yang sama di beberapa pabrik disimpan semua. */
  private async petaPart() {
    const semua = await this.db.select().from(parts);
    const peta = new Map<string, typeof semua>();
    for (const p of semua) {
      const kunci = normalkanNomorPart(p.partNumber);
      peta.set(kunci, [...(peta.get(kunci) ?? []), p]);
    }
    return peta;
  }

  async daftarFg(): Promise<DaftarPartFg> {
    let bom: BarisBomSap[];
    try {
      bom = await this.bacaBom();
    } catch (err) {
      return { tersedia: false, galat: this.galatStaging(err), daftar: [] };
    }

    const [peta, pabrik] = await Promise.all([
      this.petaPart(),
      this.db.select({ id: plants.id, code: plants.code }).from(plants),
    ]);
    const kodePabrik = new Map(pabrik.map((p) => [p.id, p.code]));

    return {
      tersedia: true,
      daftar: akarBom(bom).map((partNumber) => {
        const part = peta.get(normalkanNomorPart(partNumber))?.[0];
        return {
          partNumber,
          jumlahKomponen: ratakanPohonBom(bom, partNumber).length - 1,
          partId: part?.id ?? null,
          name: part?.name ?? null,
          backNumber: part?.backNumber ?? null,
          plantCode: part ? (kodePabrik.get(part.plantId) ?? null) : null,
        };
      }),
    };
  }

  async pohon(partNumber: string): Promise<PohonPartFg> {
    let bom: BarisBomSap[];
    try {
      bom = await this.bacaBom();
    } catch (err) {
      return { tersedia: false, galat: this.galatStaging(err), ditemukan: false, simpul: [] };
    }

    const simpul = ratakanPohonBom(bom, partNumber);
    if (simpul.length === 0) return { tersedia: true, ditemukan: false, simpul: [] };

    const [peta, { semua: rute }] = await Promise.all([
      this.petaPart(),
      this.routing.semuaBaris(),
    ]);

    // BOM tidak menyebut pabrik: komponen mengikuti pabrik FG-nya bila ada di sana.
    const pabrikAkar = peta.get(normalkanNomorPart(partNumber))?.[0]?.plantId;

    return {
      tersedia: true,
      ditemukan: true,
      simpul: simpul.map((s) => {
        const calon = peta.get(normalkanNomorPart(s.partNumber)) ?? [];
        const part = calon.find((p) => p.plantId === pabrikAkar) ?? calon[0];
        return {
          ...s,
          partNumberMaster: normalkanNomorPart(s.partNumber),
          part: (part as unknown as PartMasterBom) ?? null,
          rute: part ? rute.filter((r) => r.partId === part.id) : [],
        };
      }),
    };
  }
}
