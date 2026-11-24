import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, type Database } from '@avicenna/db';
import { lines, locations, parts, plants, scanEvents } from '@avicenna/db';
import { productionDayWindow, sepertiKanbanSupplierElc } from '@avicenna/domain';
import type {
  RiwayatKomponen,
  ScanKomponenInput,
  ScanKomponenResult,
  StasiunKomponen,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';
import { ProcessTypeService } from '../master/process-type.service';
import { ScanService } from '../scan/scan.service';

const RIWAYAT_MAKS = 15;

/** Jenis kartu dari isi barcodenya — hanya untuk tampilan. */
function jenisKartu(raw: string): 'ARES' | 'SUPPLIER' | null {
  if (/^ARES:/i.test(raw)) return 'ARES';
  return sepertiKanbanSupplierElc(raw) ? 'SUPPLIER' : null;
}

/**
 * Stasiun komponen — layar genggam untuk work center receiving pabrik.
 *
 * ── Satu area per pabrik, satu line receiving di baliknya ──────────────────
 *
 * Operator memilih pabrik (UNIT, BODY, ELEC), bukan lini. Di balik tiap pabrik
 * ada satu line ber-jenis proses grup RECEIVING (SE0800 di Unit, SE0700 di
 * Body, SE0900 di Electric), dan setiap scan di sini adalah scan line itu:
 * lewat ScanService yang sama dengan Scan Produksi, sehingga aturan kanban
 * ARES, pemeriksaan komponen beli, SLOC WH -> WP, transfer 311 ke SAP, dan
 * penolakan box dobel berlaku persis sama. Stasiun ini hanya tampilannya.
 *
 * Layar Scan Produksi tidak menampilkan line receiving; tempatnya di sini.
 */
@Injectable()
export class KomponenService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly scanService: ScanService,
    private readonly processTypes: ProcessTypeService,
  ) {}

  private tolak(pesan: string, raw: string): ScanKomponenResult {
    return {
      hasil: 'DITOLAK',
      jenisKartu: jenisKartu(raw),
      pesan,
      rawCode: raw,
      partNumber: null,
      partName: null,
      backNumber: null,
      qty: null,
      dariSloc: null,
      keSloc: null,
      keSap: false,
      scannedAt: new Date().toISOString(),
    };
  }

  /**
   * Pabrik tempat stasiun ini berdiri.
   *
   * Pabrik yang sudah dimatikan TIDAK dilayani: alamat stasiun lama yang masih
   * tersimpan di browser scanner akan tetap bisa dibuka berbulan-bulan setelah
   * pabriknya ditutup.
   */
  private async pabrikDari(plantCode: string) {
    const [row] = await this.db
      .select({
        id: plants.id,
        code: plants.code,
        name: plants.name,
        sapCode: plants.sapCode,
      })
      .from(plants)
      .where(and(eq(plants.code, plantCode), eq(plants.isActive, true)))
      .limit(1);
    if (!row) throw new NotFoundException(`Pabrik ${plantCode} tidak ada`);
    return row;
  }

  /** Line receiving pabrik ini beserta kode SLOC asal dan tujuannya. */
  private async lineReceiving(plantId: number) {
    const katalog = await this.processTypes.katalog();
    const daftar = await this.db
      .select({
        id: lines.id,
        code: lines.code,
        processType: lines.processType,
        inputLocationId: lines.inputLocationId,
        outputLocationId: lines.outputLocationId,
      })
      .from(lines)
      .where(and(eq(lines.plantId, plantId), eq(lines.isActive, true)))
      .orderBy(asc(lines.sortOrder), asc(lines.code));
    const line = daftar.find((l) => katalog.grup(l.processType) === 'RECEIVING');
    if (!line) return null;

    const sloc = await this.db
      .select({ id: locations.id, code: locations.code })
      .from(locations)
      .where(eq(locations.plantId, plantId));
    const kode = (id: number | null) => sloc.find((s) => s.id === id)?.code ?? null;
    return { ...line, gudang: kode(line.inputLocationId), wip: kode(line.outputLocationId) };
  }

  async stasiun(plantCode: string): Promise<StasiunKomponen> {
    const pabrik = await this.pabrikDari(plantCode);
    const line = await this.lineReceiving(pabrik.id);
    /*
     * Batasnya hari produksi, bukan tengah malam: shift 3 menyeberang tanggal,
     * dan angka yang ikut nol pukul 00:00 di tengah shift membuat operator
     * mengira scannya hilang.
     */
    const { start } = productionDayWindow(new Date());

    const [hitung] = line
      ? await this.db
          .select({ n: count() })
          .from(scanEvents)
          .where(and(eq(scanEvents.lineId, line.id), gte(scanEvents.scannedAt, start)))
      : [];

    return {
      pabrik: { code: pabrik.code, name: pabrik.name, sapCode: pabrik.sapCode ?? null },
      gudang: line?.gudang ?? null,
      wip: line?.wip ?? null,
      kartuHariIni: Number(hitung?.n ?? 0),
      terakhir: line ? await this.riwayat(line.id) : [],
    };
  }

  private async riwayat(lineId: number): Promise<RiwayatKomponen[]> {
    const rows = await this.db
      .select({
        id: scanEvents.id,
        rawCode: scanEvents.rawCode,
        qty: scanEvents.qty,
        scannedAt: scanEvents.scannedAt,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
      })
      .from(scanEvents)
      .leftJoin(parts, eq(parts.id, scanEvents.partId))
      .where(eq(scanEvents.lineId, lineId))
      .orderBy(desc(scanEvents.scannedAt))
      .limit(RIWAYAT_MAKS);

    return rows.map((r) => ({
      id: r.id,
      rawCode: r.rawCode ?? '',
      jenisKartu: jenisKartu(r.rawCode ?? ''),
      partNumber: r.partNumber ?? null,
      backNumber: r.backNumber ?? null,
      qty: r.qty ?? null,
      scannedAt: r.scannedAt.toISOString(),
    }));
  }

  async scan(input: ScanKomponenInput, principal?: Principal): Promise<ScanKomponenResult> {
    const pabrik = await this.pabrikDari(input.plantCode);
    const line = await this.lineReceiving(pabrik.id);
    if (!line) {
      throw new BadRequestException(
        `Pabrik ${pabrik.code} belum punya line receiving. Buat line ber-jenis proses ` +
          'Receiving di Master Data › Line.',
      );
    }

    const hasil = await this.scanService.station(
      {
        kind: 'PRODUCTION',
        lineCode: line.code,
        rawCode: input.rawCode,
        // Diganti isi box dari kanban (ARES / label supplier) saat barcode dibaca.
        qty: 1,
        clientRef: input.clientRef,
      },
      principal,
    );
    if (hasil.status !== 'ACCEPTED') return this.tolak(hasil.message, input.rawCode);

    const [part] = hasil.partNumber
      ? await this.db
          .select({ backNumber: parts.backNumber })
          .from(parts)
          .where(and(eq(parts.partNumber, hasil.partNumber), eq(parts.plantId, pabrik.id)))
          .limit(1)
      : [];

    return {
      hasil: 'DITERIMA',
      jenisKartu: jenisKartu(input.rawCode),
      pesan: `${hasil.qty} pcs dipindah ke ${line.wip ?? '-'}`,
      rawCode: input.rawCode,
      partNumber: hasil.partNumber,
      partName: hasil.partName,
      backNumber: part?.backNumber ?? null,
      qty: hasil.qty,
      dariSloc: line.gudang,
      keSloc: line.wip,
      // Transfer 311 line receiving selalu dikirim ke SAP; lihat ScanService.
      keSap: true,
      scannedAt: hasil.scannedAt,
    };
  }
}
