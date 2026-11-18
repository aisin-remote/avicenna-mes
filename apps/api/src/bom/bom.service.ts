import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, or, type Database } from '@avicenna/db';
import { partPairings, parts, plants } from '@avicenna/db';
import type { DaftarPartFg, HasilSalinBom, PartMasterBom, PohonPartFg } from '@avicenna/contracts';
import {
  akarBom,
  normalkanNomorPart,
  pasanganDariBom,
  ratakanPohonBom,
  toLocalDateKey,
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
 *
 * Satu-satunya salinan adalah Part Pairing, yang dibuat ulang dari BOM lewat
 * salinKePairing(). Scan dan backflush membacanya dari sana, supaya lantai
 * produksi tidak berhenti saat server staging mati.
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

  /**
   * Menyalin BOM SAP ke Part Pairing untuk setiap induk yang ada di master.
   *
   * Pasangan berversi: yang berubah atau hilang diakhiri kemarin, yang baru
   * berlaku hari ini, jadi telusur produksi lama tetap membaca pasangan lamanya.
   * Pasangan yang baru dibuat hari ini dihapus saja, karena rentang berlakunya
   * akan terbalik. Induk yang tidak ada di BOM tidak disentuh.
   */
  async salinKePairing(): Promise<HasilSalinBom> {
    let bom: BarisBomSap[];
    try {
      bom = await this.bacaBom();
    } catch (err) {
      return { tersedia: false, galat: this.galatStaging(err) };
    }

    const peta = await this.petaPart();
    const { pasangan, dilewati, indukTersalin } = pasanganDariBom(bom, (pn) => {
      const p = peta.get(normalkanNomorPart(pn))?.[0];
      return p ? { id: p.id, plantId: p.plantId } : undefined;
    });

    const hariIni = toLocalDateKey(new Date());
    const kemarin = new Date();
    kemarin.setDate(kemarin.getDate() - 1);
    const tglKemarin = toLocalDateKey(kemarin);

    return this.db.transaction(async (tx) => {
      const lama = indukTersalin.length
        ? await tx
            .select()
            .from(partPairings)
            .where(
              and(
                inArray(partPairings.parentPartId, indukTersalin),
                or(isNull(partPairings.effectiveTo), gte(partPairings.effectiveTo, hariIni)),
              ),
            )
        : [];

      const kunci = (indukId: number, komponenId: number, qty: number, uom: string) =>
        `${indukId}>${komponenId}>${qty}>${uom}`;
      const baru = new Map(pasangan.map((p) => [kunci(p.indukId, p.komponenId, p.qtyPer, p.uom), p]));

      let diakhiri = 0;
      let tetap = 0;
      for (const l of lama) {
        const k = kunci(l.parentPartId, l.componentPartId, Number(l.qtyPer), l.uom);
        if (baru.has(k)) {
          baru.delete(k);
          tetap++;
          continue;
        }
        if (l.effectiveFrom >= hariIni) {
          await tx.delete(partPairings).where(eq(partPairings.id, l.id));
        } else {
          await tx.update(partPairings).set({ effectiveTo: tglKemarin }).where(eq(partPairings.id, l.id));
        }
        diakhiri++;
      }

      if (baru.size) {
        await tx.insert(partPairings).values(
          [...baru.values()].map((p) => ({
            plantId: p.plantId,
            parentPartId: p.indukId,
            componentPartId: p.komponenId,
            qtyPer: String(p.qtyPer),
            uom: p.uom,
            effectiveFrom: hariIni,
            note: 'BOM SAP',
          })),
        );
      }

      return {
        tersedia: true as const,
        induk: indukTersalin.length,
        ditambah: baru.size,
        diakhiri,
        tetap,
        dilewati,
      };
    });
  }
}
