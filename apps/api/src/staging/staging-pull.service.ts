import { Injectable, Logger } from '@nestjs/common';
import { eq, and, inArray, type Database } from '@avicenna/db';
import {
  parts,
  customers,
  suppliers,
  customerParts,
  plants,
  locations,
  deliveries,
  deliveryLines,
} from '@avicenna/db';
import { DELIVERY_DAY_START_HOUR, productionDayWindow } from '@avicenna/domain';
import { InjectDb } from '../db/db.module';
import { StagingDbService } from './staging-db.service';
import { DELIVERY, SUMBER_MASTER, bersih, type SumberMaster } from './staging-tables';

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

type BarisPengirimanStaging = {
  delNo: unknown;
  customerCode: unknown;
  destination: unknown;
  manifestNumber: unknown;
  pdsNumber: unknown;
  cycle: unknown;
  deliveryDate: unknown;
  headerDeleted: unknown;
  partNumber: unknown;
  customerPartNumber: unknown;
  plannedQty: unknown;
  deliveryQty: unknown;
  qtyPerBox: unknown;
  lineDeleted: unknown;
};

const angkaBulat = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};

const ditandaiHapus = (value: unknown): boolean =>
  ['1', 'Y', 'YES', 'X', 'D', 'DELETE', 'DELETED'].includes(
    (bersih(value) ?? '').toUpperCase(),
  );

const tanggalIso = (value: unknown, fallback: string): string => {
  const compact = (bersih(value) ?? '').replaceAll('-', '');
  return /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    : fallback;
};

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

  /**
   * Menyalin loading list hari pengiriman aktif dari staging.
   *
   * Kepala dan rencana item dimiliki SAP. Hitungan pulling/loading serta status
   * operasional tetap milik MES dan tidak ditimpa saat sinkronisasi berikutnya.
   */
  async tarikPengiriman(at = new Date(), uji = false): Promise<HasilTarik> {
    const hasil: HasilTarik = {
      entitas: 'DELIVERY',
      dibaca: 0,
      baru: 0,
      diperbarui: 0,
      dinonaktifkan: 0,
      dilewati: 0,
      catatan: [],
    };
    if (!this.aktif && !uji) {
      hasil.catatan.push(
        this.staging.terkonfigurasi
          ? 'STAGING_PULL_ENABLED masih false'
          : 'koneksi staging belum dikonfigurasi',
      );
      return hasil;
    }

    const operationalDate = productionDayWindow(at, DELIVERY_DAY_START_HOUR).key;
    const stagingDate = operationalDate.replaceAll('-', '');
    const H = DELIVERY.kolomKepala;
    const L = DELIVERY.kolomBaris;
    const rows = await this.staging.query<BarisPengirimanStaging>(
      `SELECT
        h.[${H.delNo}] AS [delNo],
        h.[${H.custNo}] AS [customerCode],
        h.[${H.custDest}] AS [destination],
        h.[${H.dokNo}] AS [manifestNumber],
        h.[${H.pdsNo}] AS [pdsNumber],
        h.[${H.cycle}] AS [cycle],
        h.[${H.tanggalKirim}] AS [deliveryDate],
        h.[${H.hapus}] AS [headerDeleted],
        l.[${L.partNo}] AS [partNumber],
        l.[${L.custPartNo}] AS [customerPartNumber],
        l.[${L.qtyRencana}] AS [plannedQty],
        l.[${L.qtyKirim}] AS [deliveryQty],
        l.[${L.qtyPerBox}] AS [qtyPerBox],
        l.[${L.hapus}] AS [lineDeleted]
      FROM [${DELIVERY.kepala}] h
      LEFT JOIN [${DELIVERY.baris}] l ON l.[${L.delNo}] = h.[${H.delNo}]
      WHERE h.[${H.tanggalKirim}] = @tanggal
      ORDER BY h.[${H.delNo}], l.[${L.delItem}]`,
      { tanggal: stagingDate },
    );

    const perDokumen = new Map<string, BarisPengirimanStaging[]>();
    for (const row of rows) {
      const nomor = bersih(row.delNo);
      if (!nomor) continue;
      const daftar = perDokumen.get(nomor) ?? [];
      daftar.push(row);
      perDokumen.set(nomor, daftar);
    }
    hasil.dibaca = perDokumen.size;

    const catat = (message: string) => {
      if (hasil.catatan.length < 20) hasil.catatan.push(message);
    };

    for (const [documentNumber, documentRows] of perDokumen) {
      const header = documentRows[0];
      if (!header) continue;
      if (ditandaiHapus(header.headerDeleted)) {
        const existing = await this.db
          .select({ id: deliveries.id, status: deliveries.status })
          .from(deliveries)
          .where(eq(deliveries.documentNumber, documentNumber));
        const cancellable = existing.filter(
          (row) =>
            row.status !== 'SHIPPED' &&
            row.status !== 'RECEIVED' &&
            row.status !== 'CANCELLED',
        );
        if (!uji) {
          for (const row of cancellable) {
            await this.db
              .update(deliveries)
              .set({ status: 'CANCELLED' })
              .where(eq(deliveries.id, row.id));
          }
        }
        hasil.dinonaktifkan += cancellable.length;
        continue;
      }

      const customerCode = bersih(header.customerCode);
      const sourceLines = documentRows.filter(
        (row) => bersih(row.partNumber) && !ditandaiHapus(row.lineDeleted),
      );
      if (!customerCode || sourceLines.length === 0) {
        hasil.dilewati++;
        catat(`${documentNumber}: customer atau item kosong`);
        continue;
      }

      const [customer] = await this.db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.code, customerCode))
        .limit(1);
      if (!customer) {
        hasil.dilewati++;
        catat(`${documentNumber}: customer ${customerCode} belum ada di master`);
        continue;
      }

      const partNumbers = [
        ...new Set(sourceLines.map((row) => bersih(row.partNumber)).filter(Boolean)),
      ] as string[];
      const firstPartNumber = partNumbers[0];
      if (!firstPartNumber) {
        hasil.dilewati++;
        continue;
      }
      const partRows = await this.db
        .select()
        .from(parts)
        .where(inArray(parts.partNumber, partNumbers));
      const perPart = new Map<string, typeof partRows>();
      for (const part of partRows) {
        const daftar = perPart.get(part.partNumber) ?? [];
        daftar.push(part);
        perPart.set(part.partNumber, daftar);
      }
      if (partNumbers.some((partNumber) => !perPart.has(partNumber))) {
        hasil.dilewati++;
        catat(`${documentNumber}: ada part staging yang belum masuk master`);
        continue;
      }

      let candidatePlants = new Set(perPart.get(firstPartNumber)!.map((part) => part.plantId));
      for (const partNumber of partNumbers.slice(1)) {
        const plantsForPart = new Set(perPart.get(partNumber)!.map((part) => part.plantId));
        candidatePlants = new Set([...candidatePlants].filter((id) => plantsForPart.has(id)));
      }
      const existingHeaders = await this.db
        .select({ id: deliveries.id, plantId: deliveries.plantId, status: deliveries.status })
        .from(deliveries)
        .where(eq(deliveries.documentNumber, documentNumber));
      const knownPlant = existingHeaders.find((doc) => candidatePlants.has(doc.plantId))?.plantId;
      const plantId = knownPlant ?? (candidatePlants.size === 1 ? [...candidatePlants][0] : null);
      if (!plantId) {
        hasil.dilewati++;
        catat(`${documentNumber}: pabrik tidak bisa ditentukan dari item`);
        continue;
      }

      const selectedParts = partNumbers.map(
        (partNumber) => perPart.get(partNumber)!.find((part) => part.plantId === plantId)!,
      );
      const partIds = selectedParts.map((part) => part.id);
      const mappings = await this.db
        .select()
        .from(customerParts)
        .where(
          and(
            eq(customerParts.customerId, customer.id),
            inArray(customerParts.partId, partIds),
          ),
        );
      const siteLocations = await this.db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.plantId, plantId),
            inArray(locations.kind, ['FINISH_GOOD', 'STAGING']),
          ),
        );
      const sourceLocationId =
        siteLocations.find((location) => location.code === 'PP02')?.id ??
        siteLocations.find((location) => location.kind === 'FINISH_GOOD')?.id;
      const stagingLocationId =
        siteLocations.find((location) => location.code === 'PP04')?.id ??
        siteLocations.find((location) => location.kind === 'STAGING')?.id;
      const existing = existingHeaders.find((doc) => doc.plantId === plantId);

      if (uji) {
        if (existing) hasil.diperbarui++;
        else hasil.baru++;
        continue;
      }

      await this.db.transaction(async (tx) => {
        const headerValues = {
          customerId: customer.id,
          manifestNumber: bersih(header.manifestNumber),
          pdsNumber: bersih(header.pdsNumber),
          deliveryDate: tanggalIso(header.deliveryDate, operationalDate),
          cycle: Math.max(1, angkaBulat(header.cycle)),
          dock: bersih(header.destination),
          ...(sourceLocationId ? { locationId: sourceLocationId } : {}),
          ...(stagingLocationId ? { stagingLocationId } : {}),
          ...(existing?.status === 'CANCELLED' ? { status: 'DRAFT' as const } : {}),
        };
        let deliveryId = existing?.id;
        if (deliveryId) {
          await tx.update(deliveries).set(headerValues).where(eq(deliveries.id, deliveryId));
          hasil.diperbarui++;
        } else {
          const inserted = await tx.insert(deliveries).values({
            plantId,
            documentNumber,
            ...headerValues,
          });
          deliveryId = Number(
            (inserted as unknown as Array<{ insertId: number }>)[0]?.insertId,
          );
          hasil.baru++;
        }

        const existingLines = await tx
          .select()
          .from(deliveryLines)
          .where(eq(deliveryLines.deliveryId, deliveryId));
        const sourcePartIds = new Set<number>();
        for (const part of selectedParts) {
          const matchingRows = sourceLines.filter(
            (row) => bersih(row.partNumber) === part.partNumber,
          );
          const plannedQty = matchingRows.reduce(
            (total, row) => {
              const planned = angkaBulat(row.plannedQty);
              return total + (planned > 0 ? planned : angkaBulat(row.deliveryQty));
            },
            0,
          );
          const qtyPerKanban =
            matchingRows.map((row) => angkaBulat(row.qtyPerBox)).find((qty) => qty > 0) ??
            part.qtyPerKanban ??
            0;
          const customerPartNumber = matchingRows
            .map((row) => bersih(row.customerPartNumber))
            .find(Boolean);
          const mapping =
            mappings.find(
              (item) =>
                item.partId === part.id &&
                customerPartNumber &&
                item.customerPartNumber === customerPartNumber,
            ) ?? mappings.find((item) => item.partId === part.id);
          const values = {
            customerPartId: mapping?.id ?? null,
            plannedQty,
            qtyPerKanban,
            plannedKanban: qtyPerKanban > 0 ? Math.ceil(plannedQty / qtyPerKanban) : 0,
          };
          const current = existingLines.find((line) => line.partId === part.id);
          if (current) {
            await tx.update(deliveryLines).set(values).where(eq(deliveryLines.id, current.id));
          } else {
            await tx.insert(deliveryLines).values({ deliveryId, partId: part.id, ...values });
          }
          sourcePartIds.add(part.id);
        }

        for (const oldLine of existingLines) {
          if (sourcePartIds.has(oldLine.partId)) continue;
          if (oldLine.pickedKanban === 0 && oldLine.actualKanban === 0) {
            await tx.delete(deliveryLines).where(eq(deliveryLines.id, oldLine.id));
          } else {
            catat(`${documentNumber}: item yang sudah discan tidak dihapus saat sumber berubah`);
          }
        }
      });
    }

    this.logger.log(
      `tarik pengiriman ${operationalDate}${uji ? ' (uji coba)' : ''}: ` +
        `${hasil.dibaca} dokumen, ${hasil.baru} baru, ${hasil.diperbarui} diperbarui`,
    );
    return hasil;
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

    const [pabrik] = await this.db
      .select({ id: plants.id }).from(plants).where(eq(plants.code, kodePabrik)).limit(1);
    // Pabrik yang belum dikenal dilewati. Membuatnya otomatis berarti satu salah
    // ketik di staging melahirkan pabrik baru yang tidak ada di dunia nyata.
    if (!pabrik) return 'tetap';

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
