import { Injectable, Logger } from '@nestjs/common';
import { eq, and, lt, inArray, asc, type Database } from '@avicenna/db';
import { sapOutbox, plants } from '@avicenna/db';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from './staging-db.service';
import { StagingSchemaService } from './staging-schema.service';
import {
  GOODS_MOVEMENT,
  PRODUCTION_RESULT,
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

/** Jenis dokumen yang sudah punya pemetaan nyata ke tabel staging. */
const DIDUKUNG = new Set(['TRANSFER', 'PRODUCTION']);

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
  lineCode?: string | null;
  backNumber?: string | null;
  partName?: string | null;
  serialNumber?: string | null;
  npk?: string | null;
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

/**
 * Rujukan kita pada dokumen di staging.
 *
 * INT_NUMBER di sana kolom IDENTITY, jadi nomornya baru diketahui SETELAH
 * insert berhasil. Tanpa penanda milik sendiri, satu percobaan yang gagal
 * tepat di antara "insert berhasil" dan "nomor tersimpan di outbox" akan
 * mendorong dokumen yang sama dua kali pada percobaan berikutnya — dan
 * koreksinya manual oleh orang finance. Penanda inilah yang diperiksa lebih
 * dulu, dan bentuknya sengaja khas supaya tidak bisa tertukar dengan isian
 * aplikasi lain.
 */
function rujukan(idOutbox: number): string {
  return `AVI-${idOutbox}`;
}

/** char(n) di staging memotong diam-diam; dipotong di sini supaya terlihat di kode. */
function potong(v: string | null, n: number): string | null {
  if (v === null) return null;
  return v.length > n ? v.slice(0, n) : v;
}

/**
 * Nilai yang MENGENALI barang tidak boleh dipotong — harus ditolak.
 *
 * Memotong nama part hanya membuat laporan kurang enak dibaca. Memotong back
 * number mengubah IDENTITAS: "BN-001" dan "BN-002" sama-sama menjadi "BN-0",
 * dan dua part berbeda terposting sebagai satu di SAP. Yang seperti itu tidak
 * boleh lewat diam-diam.
 */
function wajibMuat(nilai: string | null, n: number, nama: string): string | null {
  if (nilai === null) return null;
  if (nilai.length > n) {
    throw new Error(
      `${nama} "${nilai}" lebih dari ${n} karakter, sedangkan kolomnya char(${n}) di staging. ` +
        'Perbaiki di master — memotongnya akan mengubah identitas barang di SAP.',
    );
  }
  return nilai;
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
 * ── Setiap jenis dokumen punya tabelnya sendiri ────────────────────────────
 *
 * TRANSFER dan PRODUCTION sudah dipetakan. Penerimaan dan pengiriman punya
 * pasangan tabelnya sendiri di staging dan DITAHAN, bukan
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

    const kodePabrik = await this.petaKodePabrik();
    const preflight = new Map<string, Awaited<ReturnType<StagingSchemaService['preflight']>>>();
    let terkirim = 0;
    let gagal = 0;
    let ditahan = 0;

    for (const row of antre) {
      // Jenis dokumen yang belum punya pendorong DITAHAN, bukan digagalkan:
      // yang kurang adalah pemetaan tabelnya, dan itu bukan kesalahan teknis
      // yang bisa pulih dengan mencoba lagi.
      if (!DIDUKUNG.has(row.docType)) {
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

      // Setiap jenis punya tabelnya sendiri. Kegagalan skema produksi tidak
      // boleh menahan transfer yang tabelnya sudah benar, dan sebaliknya.
      let pre = preflight.get(row.docType);
      if (!pre) {
        pre =
          row.docType === 'PRODUCTION'
            ? await this.skema.preflightProduksi()
            : await this.skema.preflight();
        preflight.set(row.docType, pre);
      }
      if (!pre.lulus) {
        this.logger.error(
          `preflight ${row.docType} gagal: ${[...pre.kolomHilang, ...pre.catatan].join('; ')}`,
        );
        ditahan++;
        continue;
      }

      try {
        if (row.docType === 'PRODUCTION') await this.dorongProduksi(row, kodePabrik);
        else await this.dorongSatu(row, kodePabrik);
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

  /** Satu scan hasil produksi menjadi satu baris pada TT_PRODUCTION_RESULT. */
  private async dorongProduksi(
    row: typeof sapOutbox.$inferSelect,
    kodePabrik: Map<number, string>,
  ): Promise<void> {
    const payload = row.payload as unknown as PayloadDokumen;
    const hasil = payload.lines.find((b) => b.mutationType === 'PRODUCTION_IN');
    if (!hasil?.partNumber) throw new Error('hasil produksi tidak punya nomor part');
    if (!payload.lineCode) throw new Error('work center dari line scan kosong');
    const plant = kodePabrik.get(row.plantId);
    if (!plant || plant.length > 4)
      throw new Error('kode SAP pabrik belum diisi atau melebihi 4 karakter');
    if (payload.lineCode.length > 10)
      throw new Error('kode line melebihi 10 karakter work center staging');
    if (hasil.partNumber.length > 18) throw new Error('nomor part melebihi 18 karakter staging');

    const terjadi = new Date(payload.occurredAt ?? row.occurredAt);
    const sekarang = new Date();
    const C = PRODUCTION_RESULT.kolom;
    const nilai: Record<string, unknown> = {
      // INT_NUMBER TIDAK diisi — kolom IDENTITY di SQL Server.
      [C.woNumber]: potong(`${rujukan(row.id)} ${payload.sourceTable}`, 30),
      [C.tanggal]: `${keTanggalStaging(terjadi).slice(0, 4)}-${keTanggalStaging(terjadi).slice(4, 6)}-${keTanggalStaging(terjadi).slice(6)}`,
      [C.bulan]: terjadi.getMonth() + 1,
      [C.tahun]: terjadi.getFullYear(),
      [C.plant]: plant,
      [C.workCenter]: payload.lineCode,
      [C.partNo]: hasil.partNumber,
      [C.backNo]: wajibMuat(payload.backNumber ?? null, 4, 'Back number'),
      [C.partName]: potong(payload.partName ?? null, 40),
      [C.uom]: potong(hasil.uom ?? null, 3),
      [C.qtyOk]: hasil.qtyAbsolute,
      [C.qtyTotal]: hasil.qtyAbsolute,
      [C.qtyActual]: hasil.qtyAbsolute,
      [C.ngProcess]: 0,
      [C.ngTotal]: 0,
      [C.tanggalEntry]: keTanggalStaging(sekarang),
      [C.jamEntry]: keJamStaging(sekarang),
      [C.user]: 'AVICENNA',
      [C.status]: FLAG.baru,
      [C.upload]: FLAG.baru,
    };
    const kolom = Object.keys(nilai);
    const tabel = tabelAman(PRODUCTION_RESULT.tabel);
    const ref = rujukan(row.id);

    /*
     * Dicari lewat RUJUKAN KITA, bukan lewat nomor dokumen.
     *
     * Nomornya milik SQL Server; yang kita kendalikan hanya CHR_WO_NUMBER.
     * Pencarian ini yang membuat percobaan ulang menemukan dokumen yang
     * terlanjur masuk, alih-alih menulisnya untuk kedua kalinya.
     */
    const cariMilikKita = async () =>
      this.staging.query<{ nomor: number }>(
        `SELECT ${identifierAman(C.nomor)} AS nomor FROM ${tabel} ` +
          `WHERE ${identifierAman(C.woNumber)} LIKE @ref`,
        { ref: `${ref} %` },
      );

    const sudahAda = await cariMilikKita();
    if (sudahAda.length > 0) {
      await this.simpanNomorStaging(row.id, Number(sudahAda[0]!.nomor));
      return;
    }

    const req = (await this.staging.kolam()).request();
    kolom.forEach((k, i) => req.input(`v${i}`, nilai[k]));
    const hasilTulis = await req.query<{ nomor: number }>(
      `INSERT INTO ${tabel} (${kolom.map(identifierAman).join(', ')}) ` +
        `OUTPUT INSERTED.${identifierAman(C.nomor)} AS nomor ` +
        `VALUES (${kolom.map((_, i) => `@v${i}`).join(', ')})`,
    );
    const nomorBaru = Number(hasilTulis.recordset?.[0]?.nomor);
    if (!Number.isFinite(nomorBaru) || nomorBaru <= 0) {
      throw new Error('staging tidak mengembalikan INT_NUMBER untuk dokumen produksi');
    }
    await this.simpanNomorStaging(row.id, nomorBaru);
  }

  /** Mencatat nomor yang diberikan staging; dialah kunci baca balasan nanti. */
  private async simpanNomorStaging(idOutbox: number, nomor: number): Promise<void> {
    await this.db
      .update(sapOutbox)
      .set({ stagingNumber: nomor })
      .where(eq(sapOutbox.id, idOutbox));
  }

  /** Menulis kepala + seluruh barisnya, dalam satu transaksi di sisi staging. */
  private async dorongSatu(
    row: typeof sapOutbox.$inferSelect,
    kodePabrik: Map<number, string>,
  ): Promise<void> {
    const payload = row.payload as unknown as PayloadDokumen;
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];
    if (lines.length === 0) throw new Error('dokumen tidak punya baris yang bisa didorong');

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

    const ref = rujukan(row.id);
    const nilaiKepala: Record<string, unknown> = {
      plant: pabrik,
      tanggal: keTanggalStaging(terjadi),
      tanggalDokumen: keTanggalStaging(terjadi),
      movementType: potong(row.movementType, 3),
      jenisTransaksi: potong(row.docType, 4),
      // Rujukan kita DI DEPAN: dialah yang dicari saat percobaan ulang.
      keterangan: potong(`${ref} ${row.sourceTable}#${row.sourceId}`, 25),
      nomorProduksi: await this.nomorProduksiTerkait(row),
      user: potong('AVICENNA', 12),
      tanggalEntry: keTanggalStaging(sekarang),
      jamEntry: keJamStaging(sekarang),
    };

    const tKepala = tabelAman(GOODS_MOVEMENT.kepala);
    const kNomorH = identifierAman(GOODS_MOVEMENT.kolomKepala.nomor);

    /*
     * Dicari lewat rujukan kita — INT_NUMBER diberikan SQL Server, jadi belum
     * ada sebelum insert pertama berhasil.
     */
    const [sudah] = await this.staging.query<{ nomor: number }>(
      `SELECT ${kNomorH} AS nomor FROM ${tKepala} ` +
        `WHERE ${identifierAman(GOODS_MOVEMENT.kolomKepala.keterangan)} LIKE @ref`,
      { ref: `${ref} %` },
    );
    if (sudah) {
      await this.simpanNomorStaging(row.id, Number(sudah.nomor));
      return;
    }

    await this.staging.transaksi(async (tx) => {
      // ── kepala ──────────────────────────────────────────────────────────
      const kolKepala = PETA_GM_KEPALA.map((f) => f.staging);
      const reqH = tx.request();
      for (const f of PETA_GM_KEPALA) reqH.input(f.field, nilaiKepala[f.field] ?? null);
      const hasilH = await reqH.query<{ nomor: number }>(
        `INSERT INTO ${tKepala} (${kolKepala.map(identifierAman).join(', ')})\n` +
          `OUTPUT INSERTED.${kNomorH} AS nomor\n` +
          `VALUES (${PETA_GM_KEPALA.map((f) => `@${f.field}`).join(', ')})`,
      );
      const nomorDok = Number(hasilH.recordset?.[0]?.nomor);
      if (!Number.isFinite(nomorDok) || nomorDok <= 0) {
        throw new Error('staging tidak mengembalikan INT_NUMBER untuk dokumen perpindahan');
      }

      // ── baris ───────────────────────────────────────────────────────────
      // INT_NUMBER_ITEM tidak diisi: kolom IDENTITY, nomornya dari SQL Server.
      const tBaris = tabelAman(GOODS_MOVEMENT.baris);
      const kolBaris = PETA_GM_BARIS.map((f) => f.staging);

      for (const b of lines) {
        const nilai: Record<string, unknown> = {
          nomor: nomorDok,
          partNo: wajibMuat(bersih(b.partNumber), 18, 'Nomor part'),
          partName: null,
          backNo: null,
          slocFrom: wajibMuat(bersih(b.slocFrom), 4, 'SLOC asal'),
          slocTo: wajibMuat(bersih(b.slocTo), 4, 'SLOC tujuan'),
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
        await req.query(
          `INSERT INTO ${tBaris} (${kolBaris.map(identifierAman).join(', ')})\n` +
            `VALUES (${PETA_GM_BARIS.map((f) => `@${f.field}`).join(', ')})`,
        );
      }

      // Disimpan di dalam transaksi yang sama: nomor yang tercatat di outbox
      // selalu menunjuk dokumen yang benar-benar ada.
      await this.simpanNomorStaging(row.id, nomorDok);
    });
  }

  /**
   * Nomor dokumen produksi dari scan yang sama, bila sudah terdorong.
   *
   * TT_GOODS_MOVEMENT_H punya INT_NUMBER_PROD untuk menautkan perpindahan ke
   * dokumen produksinya. Transfer memang baru dilepas setelah produksinya
   * dikonfirmasi, jadi nomor itu hampir selalu sudah ada — dan dengan tautan
   * ini orang SAP bisa menelusuri keduanya tanpa menebak.
   */
  private async nomorProduksiTerkait(
    row: typeof sapOutbox.$inferSelect,
  ): Promise<number | null> {
    if (row.docType !== 'TRANSFER') return null;
    const [produksi] = await this.db
      .select({ nomor: sapOutbox.stagingNumber })
      .from(sapOutbox)
      .where(
        and(
          eq(sapOutbox.sourceTable, row.sourceTable),
          eq(sapOutbox.sourceId, row.sourceId),
          eq(sapOutbox.docType, 'PRODUCTION'),
        ),
      )
      .limit(1);
    return produksi?.nomor ?? null;
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

    /*
     * Balasan dicari lewat NOMOR YANG DIBERIKAN STAGING, bukan id outbox.
     *
     * Dokumen yang sudah SENT tetapi belum punya nomor berarti dorongannya
     * terputus sebelum nomornya sempat tercatat; dilewati di sini dan akan
     * ditemukan lagi lewat rujukan pada percobaan berikutnya.
     */
    const nomorDari = (jenis: string) =>
      menunggu
        .filter((r) => r.docType === jenis && r.stagingNumber != null)
        .map((r) => Number(r.stagingNumber));

    const balasanTransfer = await this.bacaFlag(nomorDari('TRANSFER'));
    const balasanProduksi = await this.bacaFlagProduksi(nomorDari('PRODUCTION'));

    let dikonfirmasi = 0;
    let ditolak = 0;
    let masih = 0;

    for (const row of menunggu) {
      const baris =
        row.stagingNumber == null
          ? []
          : ((row.docType === 'PRODUCTION' ? balasanProduksi : balasanTransfer).get(
              Number(row.stagingNumber),
            ) ?? []);
      if (baris.length === 0 || baris.some((b) => !b.status || b.status === FLAG.baru)) {
        masih++;
        continue;
      }

      const gagal = baris.filter((b) => b.status === FLAG.gagal);
      if (gagal.length > 0) {
        const pesan = gagal
          .map((g) => g.pesan)
          .filter(Boolean)
          .join(' | ');
        await this.db
          .update(sapOutbox)
          .set({
            status: 'REJECTED',
            confirmedAt: new Date(),
            lastError: (pesan || `SAP menolak ${gagal.length} baris tanpa keterangan`).slice(
              0,
              1000,
            ),
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

  /** Status SAP pada tabel hasil produksi; satu nomor outbox = satu baris. */
  private async bacaFlagProduksi(nomorDokumen: number[]) {
    const C = PRODUCTION_RESULT.kolom;
    const peta = new Map<
      number,
      {
        status: string | null;
        pesan: string | null;
        matdoc: string | null;
        matdocTahun: string | null;
      }[]
    >();
    const tabel = tabelAman(PRODUCTION_RESULT.tabel);
    for (let i = 0; i < nomorDokumen.length; i += CHUNK_NOMOR) {
      const bagian = nomorDokumen.slice(i, i + CHUNK_NOMOR);
      const params: Record<string, unknown> = {};
      const daftar = bagian.map((n, j) => {
        params[`n${j}`] = n;
        return `@n${j}`;
      });
      const rows = await this.staging.query<{
        nomor: number;
        status: string | null;
        pesan: string | null;
        matdoc: string | null;
      }>(
        `SELECT ${identifierAman(C.nomor)} AS nomor, ${identifierAman(C.status)} AS status, ` +
          `${identifierAman(C.pesan)} AS pesan, ${identifierAman(C.matdoc)} AS matdoc ` +
          `FROM ${tabel} WHERE ${identifierAman(C.nomor)} IN (${daftar.join(', ')})`,
        params,
      );
      for (const r of rows) {
        peta.set(Number(r.nomor), [
          {
            status: bersih(r.status),
            pesan: bersih(r.pesan),
            matdoc: bersih(r.matdoc),
            matdocTahun: null,
          },
        ]);
      }
    }
    return peta;
  }

  /** Membaca kolom flag untuk sekumpulan nomor dokumen, dikelompokkan per dokumen. */
  private async bacaFlag(
    nomorDokumen: number[],
  ): Promise<
    Map<
      number,
      {
        status: string | null;
        pesan: string | null;
        matdoc: string | null;
        matdocTahun: string | null;
      }[]
    >
  > {
    const L = GOODS_MOVEMENT.kolomBaris;
    const tabel = tabelAman(GOODS_MOVEMENT.baris);
    const peta = new Map<
      number,
      {
        status: string | null;
        pesan: string | null;
        matdoc: string | null;
        matdocTahun: string | null;
      }[]
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
    const rows = await this.db.select({ id: plants.id, sapCode: plants.sapCode }).from(plants);
    return new Map(rows.filter((r) => r.sapCode?.trim()).map((r) => [r.id, r.sapCode!.trim()]));
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
