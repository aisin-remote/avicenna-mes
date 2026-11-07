import { Injectable } from '@nestjs/common';
import { eq, type Database } from '@avicenna/db';
import { lines, locations, partProcesses, parts, plants } from '@avicenna/db';
import type { BarisRutePart, DaftarRutePart } from '@avicenna/contracts';
import { masalahBarisRute } from '@avicenna/domain';
import { modeScanBerlaku, scanPerBox } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { ProcessTypeService } from '../master/process-type.service';

export interface SaringanRutePart {
  page: number;
  perPage: number;
  q?: string;
  plantId?: number;
  project?: string;
  /** Hanya baris yang masih perlu dilengkapi. */
  perluDilengkapi?: boolean;
}

/**
 * Daftar rute per part untuk layar master.
 *
 * Penulisannya lewat master generik (formulir dan unggah Excel). Yang ada di
 * sini hanya bacaan yang tidak bisa dilayani master generik: kolom dari part
 * dan line, serta kelengkapan yang dihitung per part.
 *
 * Seluruh baris dimuat lalu disaring di memori, karena kelengkapan dihitung dari
 * seluruh langkah part dan ringkasannya harus tetap menghitung semua baris.
 * Tabelnya master, bukan transaksi: jumlahnya ratusan baris.
 */
@Injectable()
export class RoutingService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly processTypes: ProcessTypeService,
  ) {}

  async daftarRute(s: SaringanRutePart): Promise<DaftarRutePart> {
    const [rows, lokasi, katalog, partAktif] = await Promise.all([
      this.db
        .select({
          id: partProcesses.id,
          plantId: partProcesses.plantId,
          plantCode: plants.code,
          partId: partProcesses.partId,
          partNumber: parts.partNumber,
          backNumber: parts.backNumber,
          partName: parts.name,
          project: parts.project,
          lineId: partProcesses.lineId,
          lineCode: lines.code,
          workCenter: lines.sapWorkCenter,
          lineProcess: lines.processType,
          lineMode: lines.scanMode,
          processType: partProcesses.processType,
          seqNo: partProcesses.seqNo,
          inputLocationId: partProcesses.inputLocationId,
          outputLocationId: partProcesses.outputLocationId,
          transferLocationId: partProcesses.transferLocationId,
          scanMode: partProcesses.scanMode,
          sapProductionEnabled: partProcesses.sapProductionEnabled,
          isPrimary: partProcesses.isPrimary,
          isActive: partProcesses.isActive,
        })
        .from(partProcesses)
        .innerJoin(parts, eq(partProcesses.partId, parts.id))
        .leftJoin(plants, eq(partProcesses.plantId, plants.id))
        .leftJoin(lines, eq(partProcesses.lineId, lines.id))
        .orderBy(plants.code, parts.project, parts.partNumber, partProcesses.seqNo),
      this.db.select({ id: locations.id, code: locations.code }).from(locations),
      this.processTypes.katalog(),
      this.db.select({ id: parts.id }).from(parts).where(eq(parts.isActive, true)),
    ]);

    const kodeLokasi = new Map(lokasi.map((l) => [l.id, l.code]));
    const punyaRute = new Set(rows.map((r) => r.partId));

    const langkahAktif = new Map<number, typeof rows>();
    for (const r of rows) {
      if (!r.isActive) continue;
      langkahAktif.set(r.partId, [...(langkahAktif.get(r.partId) ?? []), r]);
    }

    /*
     * Tanpa UTAMA adalah kekurangan part, jadi ditempel di langkah terakhirnya
     * saja. Menempelkannya ke semua langkah membuatnya terbaca seperti empat.
     *
     * `periksaRute` sengaja tidak dipakai: aturannya menuntut langkah Delivery,
     * sedangkan rute per work center berakhir di SLOC FG tanpa baris Delivery.
     */
    const barisTanpaUtama = new Set<number>();
    for (const langkah of langkahAktif.values()) {
      const punyaWorkCenter = langkah.some((l) => l.lineId !== null);
      if (punyaWorkCenter && !langkah.some((l) => l.isPrimary)) {
        barisTanpaUtama.add(langkah[langkah.length - 1]!.id);
      }
    }

    const semua: BarisRutePart[] = rows.map((r) => {
      const masalah = r.isActive ? masalahBarisRute(r) : [];
      /*
       * Layar stasiun memilih alur per box atau per barang dari line, sebelum
       * part-nya dikenal. Metode yang lain jenis akan selalu ditolak saat scan.
       */
      if (r.isActive && r.lineProcess && r.scanMode) {
        const bawaanLine = modeScanBerlaku(katalog, { modeLini: r.lineMode, proses: r.lineProcess });
        if (scanPerBox(r.scanMode) !== scanPerBox(bawaanLine)) {
          masalah.push(
            `Mode ${r.scanMode} tidak bisa dipakai di ${r.lineCode}, yang layarnya ${bawaanLine}`,
          );
        }
      }
      if (barisTanpaUtama.has(r.id)) masalah.push('Belum ada work center utama untuk QR kanban');
      return {
        ...r,
        transferLocationCode:
          r.transferLocationId === null ? null : (kodeLokasi.get(r.transferLocationId) ?? null),
        processLabel: katalog.label(r.processType),
        inputLocationCode: r.inputLocationId === null ? null : (kodeLokasi.get(r.inputLocationId) ?? null),
        outputLocationCode: r.outputLocationId === null ? null : (kodeLokasi.get(r.outputLocationId) ?? null),
        // Langkah nonaktif tidak dipakai scan, jadi tidak ada yang perlu dilengkapi.
        masalah,
      };
    });

    const q = s.q?.trim().toUpperCase();
    const tersaring = semua.filter(
      (b) =>
        (!s.plantId || b.plantId === s.plantId) &&
        (!s.project || b.project === s.project) &&
        (!s.perluDilengkapi || b.masalah.length > 0) &&
        (!q ||
          [b.partNumber, b.backNumber, b.partName, b.lineCode, b.workCenter].some((t) =>
            t?.toUpperCase().includes(q),
          )),
    );

    const total = tersaring.length;
    const totalPages = Math.max(1, Math.ceil(total / s.perPage));
    const page = Math.min(s.page, totalPages);

    return {
      data: tersaring.slice((page - 1) * s.perPage, page * s.perPage),
      meta: { page, perPage: s.perPage, total, totalPages },
      ringkasan: {
        baris: semua.length,
        perluDilengkapi: semua.filter((b) => b.masalah.length > 0).length,
        partTanpaRute: partAktif.filter((p) => !punyaRute.has(p.id)).length,
      },
      projects: [...new Set(semua.flatMap((b) => (b.project ? [b.project] : [])))].sort(),
    };
  }
}
