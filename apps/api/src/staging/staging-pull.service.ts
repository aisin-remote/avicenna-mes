import { Injectable, Logger } from '@nestjs/common';
import { eq, and, or, type Database } from '@avicenna/db';
import { parts, customers, suppliers, customerParts, plants } from '@avicenna/db';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from './staging-db.service';
import { SUMBER_MASTER, bersih, type SumberMaster } from './staging-tables';

export interface HasilTarik {
  entitas: string;
  dibaca: number;
  baru: number;
  diperbarui: number;
  dinonaktifkan: number;
  dilewati: number;
  catatan: string[];
}

/** Berapa baris master ditarik sekali jalan. */
const BATCH = 2000;

/**
 * Menarik master data dari database jembatan.
 *
 * ── Arah kepemilikan ────────────────────────────────────────────────────────
 *
 * SAP yang memiliki master; staging adalah tempat SAP menaruhnya untuk kita
 * baca. Begitu tarik dinyalakan, apa pun yang diketik orang di layar master
 * Avicenna akan tertimpa pada putaran berikutnya. Karena itu STAGING_PULL_ENABLED
 * berdiri sendiri — menyalakannya keputusan tersendiri, bukan efek samping dari
 * menyambungkan koneksi.
 *
 * ── Tiga hal yang TIDAK dilakukan ───────────────────────────────────────────
 *
 * 1. Tidak ada penghapusan. Baris yang hilang dari staging dibiarkan apa adanya;
 *    yang ditandai terhapus di sana dinonaktifkan di sini, bukan dibuang.
 *    Transaksi lama masih menunjuk master ini — menghapusnya membuat riwayat
 *    kehilangan nama part dan customer-nya.
 *
 * 2. Kolom yang tidak dipetakan tidak disentuh. Menyamakan "tidak dipetakan"
 *    dengan "kosongkan" berarti satu pemetaan yang belum lengkap menghapus data
 *    master yang benar.
 *
 * 3. Nilai `bawaan` tidak pernah menimpa baris yang sudah ada. Kalau seseorang
 *    sudah membetulkan PROCESS_TYPE sebuah part, putaran berikutnya tidak boleh
 *    mengembalikannya ke tebakan.
 */
@Injectable()
export class StagingPullService {
  private readonly logger = new Logger(StagingPullService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly staging: StagingDbService,
  ) {}

  get aktif(): boolean {
    return this.staging.tarikAktif;
  }

  /**
   * Menarik seluruh sumber master yang terdaftar, berurutan.
   *
   * `uji` menjalankan tanpa menulis apa pun — dipakai sebelum tarik dinyalakan
   * sungguhan, supaya terlihat berapa baris yang AKAN berubah.
   */
  async tarikSemua(uji = false): Promise<{ hasil: HasilTarik[]; alasan?: string }> {
    if (!this.aktif && !uji) {
      return {
        hasil: [],
        alasan: this.staging.terkonfigurasi
          ? 'STAGING_PULL_ENABLED masih false'
          : 'koneksi staging belum dikonfigurasi',
      };
    }

    const hasil: HasilTarik[] = [];
    for (const sumber of SUMBER_MASTER) {
      try {
        hasil.push(await this.tarikSatu(sumber, uji));
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        this.logger.error(`tarik master ${sumber.entitas} gagal: ${pesan}`);
        hasil.push({
          entitas: sumber.entitas, dibaca: 0, baru: 0, diperbarui: 0,
          dinonaktifkan: 0, dilewati: 0, catatan: [pesan],
        });
      }
    }
    return { hasil };
  }

  private async tarikSatu(sumber: SumberMaster, uji: boolean): Promise<HasilTarik> {
    const catatan: string[] = [];

    // Ekspresi SELECT dibangun dari pemetaan, dengan alias = nama field kita.
    const pilih = Object.entries(sumber.kolom).map(([field, ekspresi]) => `${ekspresi} AS [${field}]`);
    pilih.push(`${sumber.kunci} AS [__kunci]`);
    if (sumber.flagHapus) pilih.push(`${sumber.flagHapus} AS [__hapus]`);

    const dari = sumber.dari ?? `[${sumber.tabel}]`;
    const urut = sumber.kolomPerubahan ? ` ORDER BY ${sumber.kolomPerubahan} ASC` : '';

    const rows = await this.staging.query<Record<string, unknown>>(
      `SELECT TOP (${BATCH}) ${pilih.join(', ')} FROM ${dari}${urut}`,
    );

    const hasil: HasilTarik = {
      entitas: sumber.entitas, dibaca: rows.length, baru: 0, diperbarui: 0,
      dinonaktifkan: 0, dilewati: 0, catatan,
    };

    if (rows.length === 0) {
      catatan.push(`tabel ${sumber.tabel} di staging masih kosong`);
      /*
       * Part baru memakai jenis proses SEMENTARA — staging tidak menyediakannya.
       * Disebutkan di laporan supaya tidak diam-diam dianggap benar; yang
       * menentukan proses sebenarnya adalah rute part dan lini tempat scan.
       */
      if (sumber.entitas === 'PART' && hasil.baru > 0 && sumber.bawaan?.processType) {
        catatan.push(
          `${hasil.baru} part baru diberi jenis proses sementara ` +
            `"${sumber.bawaan.processType}" — betulkan setelah work center SAP dipetakan ke lini.`,
        );
      }
      return hasil;
    }

    for (const row of rows) {
      const kunci = bersih(row.__kunci);
      if (!kunci) { hasil.dilewati++; continue; }

      /*
       * Nilai char(n) di staging dipadatkan spasi. Tanpa trim, "AV-001    "
       * tidak akan pernah sama dengan "AV-001" di sisi kita — dan baris baru
       * akan dibuat terus-menerus tiap putaran.
       */
      const nilai: Record<string, unknown> = {};
      for (const field of Object.keys(sumber.kolom)) {
        const v = row[field];
        if (v === undefined || v === null) continue;
        const bersihkan = typeof v === 'string' ? bersih(v) : v;
        if (bersihkan !== null) nilai[field] = bersihkan;
      }

      // Flag terhapus: nilai tidak kosong berarti dihapus di SAP.
      const terhapus = bersih(row.__hapus) !== null;

      const aksi = await this.simpan(sumber, kunci, nilai, terhapus, uji);
      if (aksi === 'baru') hasil.baru++;
      else if (aksi === 'ubah') hasil.diperbarui++;
      else if (aksi === 'nonaktif') hasil.dinonaktifkan++;
      else hasil.dilewati++;
    }

    this.logger.log(
      `tarik ${sumber.entitas}${uji ? ' (uji coba)' : ''}: ${hasil.dibaca} dibaca, ` +
        `${hasil.baru} baru, ${hasil.diperbarui} diperbarui, ${hasil.dinonaktifkan} dinonaktifkan`,
    );
    return hasil;
  }

  private async simpan(
    sumber: SumberMaster,
    kunci: string,
    nilai: Record<string, unknown>,
    terhapus: boolean,
    uji: boolean,
  ): Promise<'baru' | 'ubah' | 'nonaktif' | 'tetap'> {
    switch (sumber.entitas) {
      case 'CUSTOMER':
        return this.upsertKode(customers, kunci, nilai, terhapus, uji);
      case 'VENDOR':
        return this.upsertKode(suppliers, kunci, nilai, terhapus, uji);
      case 'PART':
        return this.upsertPart(kunci, nilai, terhapus, sumber.bawaan ?? {}, uji);
      case 'CUSTOMER_PART':
        return this.upsertCustomerPart(nilai, uji);
    }
  }

  /**
   * Customer dan vendor: kunci tunggal `code`, bentuknya identik.
   *
   * Keduanya punya kolom CHR_CODE/CHR_NAME/FLG_IS_ACTIVE yang sama persis,
   * tetapi tipe kolom Drizzle membawa nama tabelnya sehingga TS menolak
   * menyatukannya. Satu cast di sini lebih baik daripada menggandakan seluruh
   * fungsinya — dan bila salah satu tabel berubah bentuk, `bedanya()` yang
   * membandingkan per-field akan tetap benar.
   */
  private async upsertKode(
    tabel: typeof customers | typeof suppliers,
    kunci: string,
    nilai: Record<string, unknown>,
    terhapus: boolean,
    uji: boolean,
  ): Promise<'baru' | 'ubah' | 'nonaktif' | 'tetap'> {
    const kolomKunci = (tabel as typeof customers).code;
    const [ada] = await this.db.select().from(tabel).where(eq(kolomKunci, kunci)).limit(1);

    if (!ada) {
      // Baris yang sudah terhapus di SAP dan belum pernah ada di sini tidak
      // perlu dibuat hanya untuk langsung dinonaktifkan.
      if (terhapus) return 'tetap';
      if (uji) return 'baru';
      await this.db.insert(tabel).values({ code: kunci, name: kunci, ...nilai } as never);
      return 'baru';
    }

    if (terhapus) {
      if (!ada.isActive) return 'tetap';
      if (uji) return 'nonaktif';
      await this.db.update(tabel).set({ isActive: false } as never).where(eq(kolomKunci, kunci));
      return 'nonaktif';
    }

    const berubah = this.bedanya(ada as Record<string, unknown>, nilai);
    if (!ada.isActive) berubah.isActive = true;
    if (Object.keys(berubah).length === 0) return 'tetap';
    if (uji) return 'ubah';
    await this.db.update(tabel).set(berubah as never).where(eq(kolomKunci, kunci));
    return 'ubah';
  }

  /**
   * Part berkunci majemuk (pabrik + nomor part).
   *
   * Kode pabrik datang dari TM_PROCESS_PARTS, bukan TM_PARTS — lihat catatan di
   * SUMBER_MASTER. Baris tanpa kode pabrik DILEWATI, bukan dimasukkan ke pabrik
   * pertama yang ditemukan: part yang mendarat di pabrik keliru akan muncul di
   * layar scan lini yang salah, dan penyebabnya sangat sulit dilacak balik.
   */
  private async upsertPart(
    kunci: string,
    nilai: Record<string, unknown>,
    terhapus: boolean,
    bawaan: Record<string, unknown>,
    uji: boolean,
  ): Promise<'baru' | 'ubah' | 'nonaktif' | 'tetap'> {
    const kodePabrik = bersih(nilai.plantCode);
    delete nilai.plantCode;
    if (!kodePabrik) return 'tetap';

    /*
     * Dicocokkan ke KODE SAP pabrik, bukan ke kode kita.
     *
     * CHR_PLANT di staging berisi kode SAP — "600" pada data nyata — sedangkan
     * kode kita "UNIT"/"BODY". Mencocokkannya ke `code` membuat SETIAP part
     * dilewati dengan diam: tarik master melaporkan "berhasil, 0 baris", dan
     * tidak ada yang tahu sebabnya. Kode kita tetap diterima sebagai cadangan
     * supaya data contoh yang memakai "UNIT" tidak ikut patah.
     */
    const [pabrik] = await this.db
      .select({ id: plants.id })
      .from(plants)
      .where(or(eq(plants.sapCode, kodePabrik), eq(plants.code, kodePabrik)))
      .limit(1);
    // Pabrik yang belum dikenal dilewati. Membuatnya otomatis berarti satu salah
    // ketik di staging melahirkan pabrik baru yang tidak ada di dunia nyata.
    if (!pabrik) {
      this.logger.warn(
        `part ${kunci} dilewati: pabrik "${kodePabrik}" dari staging belum cocok dengan ` +
          'Kode SAP mana pun di master Pabrik. Isi CHR_SAP_CODE di master Pabrik.',
      );
      return 'tetap';
    }

    const [ada] = await this.db
      .select().from(parts)
      .where(and(eq(parts.plantId, pabrik.id), eq(parts.partNumber, kunci))).limit(1);

    if (!ada) {
      if (terhapus) return 'tetap';
      if (uji) return 'baru';
      await this.db.insert(parts).values({
        plantId: pabrik.id,
        partNumber: kunci,
        name: String(nilai.name ?? kunci),
        // `bawaan` hanya di sini — baris yang sudah ada tidak pernah ditimpa.
        ...bawaan,
        ...nilai,
      } as never);
      return 'baru';
    }

    if (terhapus) {
      if (!ada.isActive) return 'tetap';
      if (uji) return 'nonaktif';
      await this.db.update(parts).set({ isActive: false }).where(eq(parts.id, ada.id));
      return 'nonaktif';
    }

    const berubah = this.bedanya(ada as Record<string, unknown>, nilai);
    if (!ada.isActive) berubah.isActive = true;
    if (Object.keys(berubah).length === 0) return 'tetap';
    if (uji) return 'ubah';
    await this.db.update(parts).set(berubah as never).where(eq(parts.id, ada.id));
    return 'ubah';
  }

  /**
   * Pemetaan nomor part customer.
   *
   * Butuh part DAN customer sudah ada — karena itu CUSTOMER_PART berada paling
   * akhir di SUMBER_MASTER. Baris yang salah satunya belum ada dilewati, dan
   * akan tertangani sendiri pada putaran berikutnya setelah keduanya masuk.
   */
  private async upsertCustomerPart(
    nilai: Record<string, unknown>,
    uji: boolean,
  ): Promise<'baru' | 'ubah' | 'tetap'> {
    const partNumber = bersih(nilai.partNumber);
    const customerCode = bersih(nilai.customerCode);
    const customerPartNumber = bersih(nilai.customerPartNumber);
    if (!partNumber || !customerCode || !customerPartNumber) return 'tetap';

    const [cust] = await this.db
      .select({ id: customers.id }).from(customers).where(eq(customers.code, customerCode)).limit(1);
    if (!cust) return 'tetap';

    // Satu nomor part bisa ada di beberapa pabrik; pemetaan customer berlaku
    // untuk semuanya, jadi setiap baris part yang cocok ikut dipetakan.
    const daftarPart = await this.db
      .select({ id: parts.id }).from(parts).where(eq(parts.partNumber, partNumber));
    if (daftarPart.length === 0) return 'tetap';

    let berubah = false;
    for (const p of daftarPart) {
      const [ada] = await this.db
        .select().from(customerParts)
        .where(and(eq(customerParts.partId, p.id), eq(customerParts.customerId, cust.id)))
        .limit(1);

      if (!ada) {
        if (!uji) {
          await this.db.insert(customerParts).values({
            partId: p.id, customerId: cust.id, customerPartNumber,
          } as never);
        }
        berubah = true;
      } else if (ada.customerPartNumber !== customerPartNumber) {
        if (!uji) {
          await this.db.update(customerParts)
            .set({ customerPartNumber }).where(eq(customerParts.id, ada.id));
        }
        berubah = true;
      }
    }
    return berubah ? 'baru' : 'tetap';
  }

  /** Hanya field yang benar-benar berbeda. Update tanpa perubahan hanya menaikkan UPDATED_AT. */
  private bedanya(
    lama: Record<string, unknown>,
    baru: Record<string, unknown>,
  ): Record<string, unknown> {
    const hasil: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(baru)) {
      if (!(k in lama)) continue;
      const sebelum = lama[k];
      const sama =
        sebelum instanceof Date && v instanceof Date
          ? sebelum.getTime() === v.getTime()
          : String(sebelum ?? '') === String(v ?? '');
      if (!sama) hasil[k] = v;
    }
    return hasil;
  }
}
