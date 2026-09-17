import { Injectable, Logger } from '@nestjs/common';
import { StagingDbService } from './staging-db.service';
import { GOODS_MOVEMENT, SUMBER_MASTER } from './staging-tables';
import { kolomKepala, kolomBaris } from './field-map';

export interface KolomStaging {
  nama: string;
  tipe: string;
  panjang: number | null;
  bolehNull: boolean;
}

export interface TabelStaging {
  skema: string;
  nama: string;
  jumlahKolom: number;
}

export interface HasilPreflight {
  lulus: boolean;
  tabelDitemukan: boolean;
  kolomHilang: string[];
  indeksUnikIdempotency: boolean;
  catatan: string[];
}

/** Memisah "dbo.MES_STOCK_MOVEMENT" menjadi skema dan nama. */
function pisahNama(penuh: string): { skema: string; nama: string } {
  const bersih = penuh.replace(/[[\]]/g, '');
  const titik = bersih.indexOf('.');
  if (titik === -1) return { skema: 'dbo', nama: bersih };
  return { skema: bersih.slice(0, titik), nama: bersih.slice(titik + 1) };
}

/**
 * Membaca struktur database staging apa adanya.
 *
 * Ada dua kegunaannya, dan keduanya menjawab masalah yang sama: struktur di
 * sisi SAP sudah ada, tetapi belum tertulis di repo ini.
 *
 *   1. Introspeksi — mencetak tabel dan kolom yang benar-benar ada, supaya
 *      staging-tables.ts bisa diisi dari kenyataan, bukan dari dugaan.
 *
 *   2. Preflight — memastikan nama yang dikonfigurasi memang ada SEBELUM
 *      baris pertama ditulis. Tanpa ini, salah satu huruf pada nama kolom
 *      baru ketahuan sebagai ratusan dokumen berstatus FAILED, dan orang akan
 *      mengira datanya yang bermasalah.
 */
@Injectable()
export class StagingSchemaService {
  private readonly logger = new Logger(StagingSchemaService.name);

  constructor(private readonly db: StagingDbService) {}

  /** Seluruh tabel di database staging. */
  async daftarTabel(): Promise<TabelStaging[]> {
    const rows = await this.db.query<{ skema: string; nama: string; jumlahKolom: number }>(`
      SELECT
        t.TABLE_SCHEMA AS skema,
        t.TABLE_NAME   AS nama,
        COUNT(c.COLUMN_NAME) AS jumlahKolom
      FROM INFORMATION_SCHEMA.TABLES t
      JOIN INFORMATION_SCHEMA.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
    `);
    return rows;
  }

  /** Kolom sebuah tabel, apa adanya. */
  async kolomDari(tabelPenuh: string): Promise<KolomStaging[]> {
    const { skema, nama } = pisahNama(tabelPenuh);
    const rows = await this.db.query<{
      nama: string;
      tipe: string;
      panjang: number | null;
      bolehNull: string;
    }>(
      `SELECT
         COLUMN_NAME              AS nama,
         DATA_TYPE                AS tipe,
         CHARACTER_MAXIMUM_LENGTH AS panjang,
         IS_NULLABLE              AS bolehNull
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = @skema AND TABLE_NAME = @nama
       ORDER BY ORDINAL_POSITION`,
      { skema, nama },
    );
    return rows.map((r) => ({
      nama: r.nama,
      tipe: r.tipe,
      panjang: r.panjang,
      bolehNull: r.bolehNull === 'YES',
    }));
  }

  /** Indeks sebuah tabel — dipakai memastikan kunci idempoten benar-benar unik. */
  async indeksDari(tabelPenuh: string): Promise<{ nama: string; unik: boolean; kolom: string[] }[]> {
    const { skema, nama } = pisahNama(tabelPenuh);
    const rows = await this.db.query<{
      indeks: string;
      unik: boolean;
      kolom: string;
      urutan: number;
    }>(
      `SELECT
         i.name      AS indeks,
         i.is_unique AS unik,
         c.name      AS kolom,
         ic.key_ordinal AS urutan
       FROM sys.indexes i
       JOIN sys.index_columns ic
         ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c
         ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.object_id = OBJECT_ID(@tabel) AND i.is_hypothetical = 0
       ORDER BY i.name, ic.key_ordinal`,
      { tabel: `${skema}.${nama}` },
    );

    const peta = new Map<string, { nama: string; unik: boolean; kolom: string[] }>();
    for (const r of rows) {
      const ada = peta.get(r.indeks) ?? { nama: r.indeks, unik: Boolean(r.unik), kolom: [] };
      ada.kolom.push(r.kolom);
      peta.set(r.indeks, ada);
    }
    return [...peta.values()];
  }

  /**
   * Memastikan konfigurasi cocok dengan struktur yang benar-benar ada.
   *
   * Dipanggil sebelum putaran dorong pertama. Hasilnya di-cache selama proses
   * hidup — struktur tabel tidak berubah tiap menit, dan memeriksanya tiap
   * putaran hanya menambah beban tanpa menambah keamanan.
   */
  private preflightTersimpan?: HasilPreflight;

  async preflight(paksa = false): Promise<HasilPreflight> {
    if (this.preflightTersimpan && !paksa) return this.preflightTersimpan;

    const catatan: string[] = [];
    const kolomHilang: string[] = [];
    let tabelDitemukan = true;

    /*
     * Dua tabel diperiksa, bukan satu.
     *
     * Dokumen perpindahan ditulis sebagai kepala + baris. Memeriksa salah
     * satunya saja berarti kepala masuk lalu barisnya gagal — dan dokumen
     * setengah jadi di staging akan diposting SAP sebagai perpindahan kosong.
     */
    for (const [tabel, diperlukan] of [
      [GOODS_MOVEMENT.kepala, kolomKepala()],
      [GOODS_MOVEMENT.baris, kolomBaris()],
    ] as [string, string[]][]) {
      const kolom = await this.kolomDari(tabel);
      if (kolom.length === 0) {
        tabelDitemukan = false;
        catatan.push(`Tabel "${tabel}" tidak ada di database staging.`);
        continue;
      }

      // Nama kolom di SQL Server tidak peka huruf besar-kecil pada collation
      // bawaan, tetapi bisa peka bila database dibuat dengan collation _CS_.
      const adaPersis = new Set(kolom.map((k) => k.nama));
      const adaLonggar = new Set(kolom.map((k) => k.nama.toUpperCase()));

      for (const k of diperlukan) {
        if (adaPersis.has(k)) continue;
        if (adaLonggar.has(k.toUpperCase())) {
          catatan.push(`Kolom "${tabel}.${k}" ada tetapi beda huruf besar-kecil.`);
          continue;
        }
        kolomHilang.push(`${tabel}.${k}`);
      }
    }

    /*
     * Staging tidak punya kolom kunci idempoten; kuncinya nomor dokumen.
     * Tanpa indeks unik pada INT_NUMBER + INT_NUMBER_ITEM, satu dorongan ulang
     * yang berlomba dengan dirinya sendiri bisa menggandakan baris — dan
     * koreksinya manual oleh orang finance.
     */
    const indeks = tabelDitemukan ? await this.indeksDari(GOODS_MOVEMENT.baris) : [];
    const kunci = [GOODS_MOVEMENT.kolomBaris.nomor, GOODS_MOVEMENT.kolomBaris.nomorItem].map((k) =>
      k.toUpperCase(),
    );
    const indeksUnikIdempotency = indeks.some(
      (i) =>
        i.unik &&
        i.kolom.length === kunci.length &&
        i.kolom.every((c, n) => c.toUpperCase() === kunci[n]),
    );
    if (tabelDitemukan && !indeksUnikIdempotency) {
      catatan.push(
        `Tidak ada unique index pada ${GOODS_MOVEMENT.baris} (${kunci.join(' + ')}). ` +
          'Tanpa itu, dorongan ulang berpeluang menggandakan baris di SAP. ' +
          'Minta tim SAP menambahkannya.',
      );
    }

    const hasil: HasilPreflight = {
      lulus: tabelDitemukan && kolomHilang.length === 0,
      tabelDitemukan,
      kolomHilang,
      indeksUnikIdempotency,
      catatan,
    };

    if (hasil.lulus) {
      this.logger.log(`preflight staging lulus untuk ${GOODS_MOVEMENT.kepala} + ${GOODS_MOVEMENT.baris}`);
    } else {
      this.logger.warn(`preflight staging GAGAL: ${kolomHilang.length} kolom tidak ditemukan`);
    }

    this.preflightTersimpan = hasil;
    return hasil;
  }

  /** Dipanggil setelah konfigurasi diubah, supaya hasil lama tidak menempel. */
  lupakanPreflight(): void {
    this.preflightTersimpan = undefined;
  }

  /** Gambaran penuh untuk layar diagnostik dan perintah introspeksi. */
  async potret() {
    const tabel = await this.daftarTabel();
    const kepala = await this.kolomDari(GOODS_MOVEMENT.kepala).catch(() => []);
    const baris = await this.kolomDari(GOODS_MOVEMENT.baris).catch(() => []);
    const indeks = baris.length ? await this.indeksDari(GOODS_MOVEMENT.baris) : [];

    return {
      jumlahTabel: tabel.length,
      tabel,
      target: {
        kepala: { nama: GOODS_MOVEMENT.kepala, kolom: kepala },
        baris: { nama: GOODS_MOVEMENT.baris, kolom: baris, indeks },
      },
      sumberMaster: SUMBER_MASTER.map((s) => ({ entitas: s.entitas, tabel: s.tabel })),
    };
  }
}
