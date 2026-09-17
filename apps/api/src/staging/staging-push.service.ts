import { Injectable, Logger } from '@nestjs/common';
import { eq, and, lt, inArray, asc, type Database } from '@avicenna/db';
import { sapOutbox, plants } from '@avicenna/db';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from './staging-db.service';
import { StagingSchemaService } from './staging-schema.service';
import {
  GOODS_MOVEMENT,
  FLAG,
  bersih,
  keTanggalStaging,
  keJamStaging,
} from './staging-tables';
import { PETA_GM_KEPALA, PETA_GM_BARIS, BELUM_DIDUKUNG } from './field-map';

/** Berhenti mencoba setelah sekian kali; sisanya perlu dilihat orang. */
const MAX_ATTEMPTS = 8;
const BATCH_DORONG = 100;
const BATCH_BALASAN = 200;
const CHUNK_NOMOR = 400;

/** Satu-satunya jenis dokumen yang tabel tujuannya sudah dipetakan. */
const DIDUKUNG = 'TRANSFER';

interface BarisPayload {
  mutationId: number;
  mutationType: string;
  movementType: string | null;
  partNumber: string | null;
  uom: string | null;
  sloc: string | null;
  slocFrom: string | null;
  slocTo: string | null;
  qty: string | number;
  qtyAbsolute: number;
  lotNumber: string | null;
  note: string | null;
}

interface PayloadDokumen {
  docType: string;
  movementType: string | null;
  plantId: number;
  sourceTable: string;
  sourceId: number;
  occurredAt: string | Date;
  lines: BarisPayload[];
}

/** Menolak nama kolom/tabel yang tidak berbentuk identifier. Dirangkai ke SQL, jadi diperiksa. */
function identifierAman(nama: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(nama)) {
    throw new Error(`Nama kolom/tabel staging tidak valid: "${nama}".`);
  }
  return `[${nama}]`;
}

function tabelAman(penuh: string): string {
  return penuh.replace(/[[\]]/g, '').split('.').map(identifierAman).join('.');
}

/** char(n) di staging memotong diam-diam; dipotong di sini supaya terlihat di kode. */
function potong(v: string | null, n: number): string | null {
  if (v === null) return null;
  return v.length > n ? v.slice(0, n) : v;
}

/**
 * Mendorong dokumen ke database jembatan, dan membaca balasannya.
 *
 * ── Kunci idempoten: nomor dokumen, bukan kolom khusus ──────────────────────
 *
 * Staging TIDAK punya kolom kunci idempoten. Kuncinya INT_NUMBER pada kepala,
 * dan INT_NUMBER + INT_NUMBER_ITEM pada barisnya. Id baris outbox dipakai apa
 * adanya sebagai INT_NUMBER: nilainya tidak pernah berubah, jadi dorongan ulang
 * mengenai baris yang sama alih-alih menggandakannya.
 *
 * Setiap INSERT dijaga `WHERE NOT EXISTS`, sehingga percobaan yang sebelumnya
 * berhasil separuh bisa diulang: baris yang sudah ada dilewati, yang belum ada
 * masuk.
 *
 * ── Baru satu jenis dokumen ─────────────────────────────────────────────────
 *
 * Hanya TRANSFER yang tabel tujuannya sudah dipetakan. Penerimaan, pengiriman,
 * dan produksi punya pasangan tabelnya sendiri di staging dan DITAHAN, bukan
 * didorong ke tabel perpindahan yang kebetulan ada — penerimaan barang yang
 * mendarat di TT_GOODS_MOVEMENT akan diposting SAP sebagai perpindahan antar
 * SLOC, dan koreksinya manual oleh orang finance.
 */
@Injectable()
export class StagingPushService {
  private readonly logger = new Logger(StagingPushService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly staging: StagingDbService,
    private readonly skema: StagingSchemaService,
  ) {}

  get aktif(): boolean {
    return this.staging.dorongAktif;
  }

  async dorong(): Promise<{ terkirim: number; gagal: number; dilewati: number; alasan?: string }> {
    const antre = await this.db
      .select()
      .from(sapOutbox)
      .where(and(eq(sapOutbox.status, 'PENDING'), lt(sapOutbox.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(sapOutbox.occurredAt))
      .limit(BATCH_DORONG);

    if (antre.length === 0) return { terkirim: 0, gagal: 0, dilewati: 0 };

    if (!this.aktif) {
      // Dibiarkan PENDING: menandainya SENT akan berbohong, menandainya FAILED
      // menghabiskan jatah percobaan sebelum servernya bahkan dipakai.
      const alasan = this.staging.terkonfigurasi
        ? 'STAGING_PUSH_ENABLED masih false'
        : 'koneksi staging belum dikonfigurasi';
      this.logger.debug(`${antre.length} dokumen menunggu; ${alasan}`);
      return { terkirim: 0, gagal: 0, dilewati: antre.length, alasan };
    }

    // Struktur diperiksa SEBELUM baris pertama ditulis. Salah satu huruf pada
    // nama kolom akan menggagalkan setiap dokumen satu per satu dan menumpuk
    // sebagai ratusan baris FAILED yang terlihat seperti masalah data.
    const pre = await this.skema.preflight();
    if (!pre.lulus) {
      const alasan =
        'struktur staging tidak cocok: ' +
        (pre.tabelDitemukan ? `kolom tidak ditemukan — ${pre.kolomHilang.join(', ')}` : pre.catatan[0]) +
        '. Jalankan `pnpm staging:compare --live`.';
      this.logger.error(alasan);
      return { terkirim: 0, gagal: 0, dilewati: antre.length, alasan };
    }

    const kodePabrik = await this.petaKodePabrik();
    let terkirim = 0;
    let gagal = 0;
    let ditahan = 0;

    for (const row of antre) {
      // Jenis dokumen yang belum punya pendorong DITAHAN, bukan digagalkan:
      // yang kurang adalah pemetaan tabelnya, dan itu bukan kesalahan teknis
      // yang bisa pulih dengan mencoba lagi.
      if (row.docType !== DIDUKUNG) {
        const tujuan = BELUM_DIDUKUNG[row.docType] ?? '(belum ditentukan)';
        await this.db
          .update(sapOutbox)
          .set({
            status: 'HELD',
            lastError: `pendorong untuk ${row.docType} belum ada — tujuannya ${tujuan}`,
          })
          .where(eq(sapOutbox.id, row.id));
        ditahan++;
        continue;
      }

      try {
        await this.dorongSatu(row, kodePabrik);
        await this.db
          .update(sapOutbox)
          .set({
            // SENT = sudah mendarat di staging. BUKAN berarti SAP menerimanya;
            // itu ditentukan flag yang dibaca ambilBalasan().
            status: 'SENT',
            sentAt: new Date(),
            lastError: null,
            attempts: row.attempts + 1,
          })
          .where(eq(sapOutbox.id, row.id));
        terkirim++;
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        await this.db
          .update(sapOutbox)
          .set({ status: 'FAILED', attempts: row.attempts + 1, lastError: pesan.slice(0, 1000) })
          .where(eq(sapOutbox.id, row.id));
        gagal++;
        this.logger.warn(`dokumen outbox ${row.id} gagal didorong: ${pesan}`);
      }
    }

    if (terkirim + gagal + ditahan > 0) {
      this.logger.log(
        `dorong ke staging: ${terkirim} berhasil, ${gagal} gagal, ${ditahan} ditahan (jenis belum didukung)`,
      );
    }
    return { terkirim, gagal, dilewati: ditahan };
  }

  /** Menulis kepala + seluruh barisnya, dalam satu transaksi di sisi staging. */
  private async dorongSatu(
    row: typeof sapOutbox.$inferSelect,
    kodePabrik: Map<number, string>,
  ): Promise<void> {
    const payload = row.payload as unknown as PayloadDokumen;
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];
    if (lines.length === 0) throw new Error('dokumen tidak punya baris yang bisa didorong');

    const nomor = row.id;
    const terjadi = new Date(payload.occurredAt ?? row.occurredAt);
    const sekarang = new Date();
    /*
     * Kode pabrik untuk SAP diambil dari CHR_SAP_CODE, bukan CHR_CODE.
     *
     * CHR_PLANT di staging hanya char(3) sedangkan kode kita "UNIT"/"BODY"
     * empat karakter. Memotongnya menjadi "UNI"/"BOD" berarti mengirim kode
     * pabrik yang tidak ada di SAP — ditolak di sana, dan sebabnya tidak
     * terbaca dari dokumen yang terkirim.
     */
    const pabrik = kodePabrik.get(row.plantId) ?? null;
    if (!pabrik) {
      throw new Error(
        `kode SAP untuk pabrik id=${row.plantId} belum diisi. ` +
          'Isi CHR_SAP_CODE di master pabrik — maksimal 3 karakter, sesuai lebar CHR_PLANT di staging.',
      );
    }
    if (pabrik.length > 3) {
      throw new Error(
        `kode SAP pabrik "${pabrik}" lebih dari 3 karakter, sedangkan CHR_PLANT di staging char(3). ` +
          'Perpendek CHR_SAP_CODE di master pabrik.',
      );
    }

    const nilaiKepala: Record<string, unknown> = {
      nomor,
      plant: pabrik,
      tanggal: keTanggalStaging(terjadi),
      tanggalDokumen: keTanggalStaging(terjadi),
      movementType: potong(row.movementType, 3),
      jenisTransaksi: potong(row.docType, 4),
      keterangan: potong(`${row.sourceTable}#${row.sourceId}`, 25),
      user: potong('AVICENNA', 12),
      tanggalEntry: keTanggalStaging(sekarang),
      jamEntry: keJamStaging(sekarang),
    };

    await this.staging.transaksi(async (tx) => {
      // ── kepala ──────────────────────────────────────────────────────────
      const tKepala = tabelAman(GOODS_MOVEMENT.kepala);
      const kolKepala = PETA_GM_KEPALA.map((f) => f.staging);
      const reqH = tx.request();
      for (const f of PETA_GM_KEPALA) reqH.input(f.field, nilaiKepala[f.field] ?? null);
      reqH.input('__nomor', nomor);
      await reqH.query(
        `INSERT INTO ${tKepala} (${kolKepala.map(identifierAman).join(', ')})\n` +
          `SELECT ${PETA_GM_KEPALA.map((f) => `@${f.field}`).join(', ')}\n` +
          `WHERE NOT EXISTS (SELECT 1 FROM ${tKepala} WHERE ${identifierAman(GOODS_MOVEMENT.kolomKepala.nomor)} = @__nomor)`,
      );

      // ── baris ───────────────────────────────────────────────────────────
      const tBaris = tabelAman(GOODS_MOVEMENT.baris);
      const kolBaris = PETA_GM_BARIS.map((f) => f.staging);
      const kNomor = identifierAman(GOODS_MOVEMENT.kolomBaris.nomor);
      const kItem = identifierAman(GOODS_MOVEMENT.kolomBaris.nomorItem);

      let item = 0;
      for (const b of lines) {
        item += 1;
        const nilai: Record<string, unknown> = {
          nomor,
          nomorItem: item,
          partNo: potong(bersih(b.partNumber), 18),
          partName: null,
          backNo: null,
          slocFrom: potong(bersih(b.slocFrom), 4),
          slocTo: potong(bersih(b.slocTo), 4),
          // INT_TOTAL_QTY bertipe int di staging; pecahan dibulatkan di sini
          // supaya pembulatannya terjadi di tempat yang terbaca, bukan diam-diam
          // di sisi SQL Server.
          qty: Math.round(b.qtyAbsolute ?? Math.abs(Number(b.qty ?? 0))),
          uom: potong(bersih(b.uom), 3),
          serialNo: potong(bersih(b.lotNumber), 20),
          movementTypeBaris: potong(b.movementType ?? row.movementType, 3),
          tanggalEntry: keTanggalStaging(sekarang),
          jamEntry: keJamStaging(sekarang),
          status: FLAG.baru,
        };

        const req = tx.request();
        for (const f of PETA_GM_BARIS) req.input(f.field, nilai[f.field] ?? null);
        req.input('__nomor', nomor);
        req.input('__item', item);
        await req.query(
          `INSERT INTO ${tBaris} (${kolBaris.map(identifierAman).join(', ')})\n` +
            `SELECT ${PETA_GM_BARIS.map((f) => `@${f.field}`).join(', ')}\n` +
            `WHERE NOT EXISTS (SELECT 1 FROM ${tBaris} WHERE ${kNomor} = @__nomor AND ${kItem} = @__item)`,
        );
      }
    });
  }

  /**
   * Membaca balasan SAP dan menutup dokumen di outbox.
   *
   * Dokumen dianggap CONFIRMED hanya bila SELURUH barisnya berflag berhasil.
   * Satu baris yang ditolak membuat seluruh dokumen REJECTED — perpindahan yang
   * tercatat separuh di SAP lebih berbahaya daripada yang tidak tercatat sama
   * sekali, karena selisihnya tidak terlihat sampai tutup buku.
   */
  async ambilBalasan(): Promise<{
    dikonfirmasi: number;
    ditolak: number;
    menunggu: number;
    alasan?: string;
  }> {
    const menunggu = await this.db
      .select()
      .from(sapOutbox)
      .where(eq(sapOutbox.status, 'SENT'))
      .orderBy(asc(sapOutbox.sentAt))
      .limit(BATCH_BALASAN);

    if (menunggu.length === 0) return { dikonfirmasi: 0, ditolak: 0, menunggu: 0 };
    if (!this.aktif) {
      return {
        dikonfirmasi: 0,
        ditolak: 0,
        menunggu: menunggu.length,
        alasan: 'pendorongan ke staging belum dinyalakan',
      };
    }

    const balasan = await this.bacaFlag(menunggu.map((r) => r.id));

    let dikonfirmasi = 0;
    let ditolak = 0;
    let masih = 0;

    for (const row of menunggu) {
      const baris = balasan.get(row.id) ?? [];
      if (baris.length === 0 || baris.some((b) => !b.status || b.status === FLAG.baru)) {
        masih++;
        continue;
      }

      const gagal = baris.filter((b) => b.status === FLAG.gagal);
      if (gagal.length > 0) {
        const pesan = gagal.map((g) => g.pesan).filter(Boolean).join(' | ');
        await this.db
          .update(sapOutbox)
          .set({
            status: 'REJECTED',
            confirmedAt: new Date(),
            lastError: (pesan || `SAP menolak ${gagal.length} baris tanpa keterangan`).slice(0, 1000),
          })
          .where(eq(sapOutbox.id, row.id));
        ditolak++;
        continue;
      }

      const dok = baris.map((b) => b.matdoc).find(Boolean) ?? null;
      const tahun = baris.map((b) => b.matdocTahun).find(Boolean) ?? null;
      await this.db
        .update(sapOutbox)
        .set({
          status: 'CONFIRMED',
          sapDocNumber: dok ? (tahun ? `${dok}/${tahun}` : dok) : null,
          confirmedAt: new Date(),
          lastError: null,
        })
        .where(eq(sapOutbox.id, row.id));
      dikonfirmasi++;
    }

    if (dikonfirmasi + ditolak > 0) {
      this.logger.log(
        `balasan SAP: ${dikonfirmasi} dikonfirmasi, ${ditolak} ditolak, ${masih} masih menunggu`,
      );
    }
    return { dikonfirmasi, ditolak, menunggu: masih };
  }

  /** Membaca kolom flag untuk sekumpulan nomor dokumen, dikelompokkan per dokumen. */
  private async bacaFlag(
    nomorDokumen: number[],
  ): Promise<Map<number, { status: string | null; pesan: string | null; matdoc: string | null; matdocTahun: string | null }[]>> {
    const L = GOODS_MOVEMENT.kolomBaris;
    const tabel = tabelAman(GOODS_MOVEMENT.baris);
    const peta = new Map<
      number,
      { status: string | null; pesan: string | null; matdoc: string | null; matdocTahun: string | null }[]
    >();

    for (let i = 0; i < nomorDokumen.length; i += CHUNK_NOMOR) {
      const bagian = nomorDokumen.slice(i, i + CHUNK_NOMOR);
      const params: Record<string, unknown> = {};
      const penampung = bagian.map((n, idx) => {
        params[`n${idx}`] = n;
        return `@n${idx}`;
      });

      const rows = await this.staging.query<{
        nomor: number;
        status: string | null;
        pesan: string | null;
        matdoc: string | null;
        matdocTahun: string | null;
      }>(
        `SELECT ${identifierAman(L.nomor)}       AS nomor,
                ${identifierAman(L.status)}      AS status,
                ${identifierAman(L.pesan)}       AS pesan,
                ${identifierAman(L.matdoc)}      AS matdoc,
                ${identifierAman(L.matdocTahun)} AS matdocTahun
         FROM ${tabel}
         WHERE ${identifierAman(L.nomor)} IN (${penampung.join(', ')})`,
        params,
      );

      for (const r of rows) {
        const daftar = peta.get(Number(r.nomor)) ?? [];
        daftar.push({
          status: bersih(r.status),
          pesan: bersih(r.pesan),
          matdoc: bersih(r.matdoc),
          matdocTahun: bersih(r.matdocTahun),
        });
        peta.set(Number(r.nomor), daftar);
      }
    }
    return peta;
  }

  /**
   * Kode pabrik MENURUT SAP, bukan kode yang dipakai orang lapangan.
   *
   * Pabrik yang belum punya kode SAP sengaja tidak masuk peta — dokumennya akan
   * ditolak dengan pesan yang menyebutkan apa yang harus diisi, bukan didorong
   * dengan kode tebakan.
   */
  private async petaKodePabrik(): Promise<Map<number, string>> {
    const rows = await this.db
      .select({ id: plants.id, sapCode: plants.sapCode })
      .from(plants);
    return new Map(
      rows.filter((r) => r.sapCode?.trim()).map((r) => [r.id, r.sapCode!.trim()]),
    );
  }

  /** Mengembalikan dokumen yang ditolak SAP ke antrean, setelah datanya diperbaiki. */
  async dorongUlang(ids: number[]): Promise<{ diulang: number }> {
    if (ids.length === 0) return { diulang: 0 };
    await this.db
      .update(sapOutbox)
      .set({ status: 'PENDING', attempts: 0, lastError: null, sentAt: null, confirmedAt: null })
      .where(and(inArray(sapOutbox.id, ids), inArray(sapOutbox.status, ['REJECTED', 'FAILED'])));
    return { diulang: ids.length };
  }
}
