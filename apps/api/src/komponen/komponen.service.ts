import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, type Database } from '@avicenna/db';
import { locations, mutations, parts, plants, scanEvents } from '@avicenna/db';
import {
  kenaliKartu,
  PESAN_TOLAK,
  productionDayWindow,
  type KartuKomponen,
  type TolakKartu,
} from '@avicenna/domain';
import type {
  RiwayatKomponen,
  ScanKomponenInput,
  ScanKomponenResult,
  StasiunKomponen,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import type { Principal } from '../auth/auth.types';

const RIWAYAT_MAKS = 15;

/**
 * Stasiun kanban — memindahkan barang dengan kartu, bukan dengan angka.
 *
 * ── Hanya kartu komponen ARES ───────────────────────────────────────────────
 *
 * Kartu terbitan ARES memindahkan barang dari gudang ke WIP dan menghasilkan
 * dokumen SAP. Kartu kanban kita sendiri TIDAK discan di sini: di UNIT ia
 * dihitung di pos kanban, di BODY ia dilepas oleh belanja. Lihat catatan di
 * `kenaliKartu` (@avicenna/domain) untuk alasannya.
 *
 * ── Satu area per pabrik, bukan per lini ───────────────────────────────────
 *
 * Yang dicatat di sini adalah perpindahan SLOC, dan SLOC milik pabrik: WH70 ke
 * WP70 di Body, WH80 ke WP80 di Unit, WH90 ke WP90 di Electric. Lini tidak ikut
 * menentukan apa pun di dokumennya, jadi lini tidak ikut ditanyakan — dan
 * karenanya `INT_LINE_ID` memang dibiarkan kosong, bukan diisi tebakan.
 *
 * ── Tidak ada angka yang diketik ────────────────────────────────────────────
 *
 * Satu kartu ARES = satu box, dan isi box itu sudah tercatat saat penerimaan.
 * Jadi jumlah yang dipindah diambil dari scan penerimaannya, bukan diketik
 * ulang di lantai. Angka yang diketik di stasiun yang dipakai ratusan kali per
 * shift adalah sumber selisih stok yang paling pasti.
 */
@Injectable()
export class KomponenService {
  private readonly logger = new Logger(KomponenService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  private tolak(sebab: TolakKartu, raw: string, jenis: 'ARES' | null): ScanKomponenResult {
    return {
      hasil: 'DITOLAK',
      jenisKartu: jenis,
      pesan: PESAN_TOLAK[sebab],
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
   * Pabrik tempat stasiun ini berdiri — penentu tunggal SLOC asal dan tujuan.
   *
   * Pabrik yang sudah dimatikan TIDAK dilayani: alamat stasiun lama yang masih
   * tersimpan di browser scanner akan tetap bisa dibuka berbulan-bulan setelah
   * pabriknya ditutup, dan scan yang masuk dari situ mendarat sebagai dokumen
   * ke SLOC yang tidak lagi dipakai siapa pun.
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

  /**
   * SLOC gudang dan WIP milik sebuah pabrik.
   *
   * Dicari lewat JENIS lokasi, bukan kode: kode SLOC berbeda per pabrik
   * (`WH70`, `WH80`, `WH90`), dan menuliskannya satu per satu berarti pabrik
   * keempat nanti diam-diam tidak berfungsi.
   */
  private async slocPabrik(plantId: number) {
    const rows = await this.db
      .select({ id: locations.id, code: locations.code, kind: locations.kind })
      .from(locations)
      .where(eq(locations.plantId, plantId));
    const gudang = rows.find((r) => r.kind === 'WAREHOUSE') ?? null;
    const wip = rows.find((r) => r.kind === 'WIP') ?? null;
    return { gudang, wip };
  }

  async stasiun(plantCode: string): Promise<StasiunKomponen> {
    const pabrik = await this.pabrikDari(plantCode);
    const { gudang, wip } = await this.slocPabrik(pabrik.id);
    /*
     * Batasnya hari produksi, bukan tengah malam: shift 3 menyeberang tanggal,
     * dan angka yang ikut nol pukul 00:00 di tengah shift membuat operator
     * mengira scannya hilang.
     */
    const { start } = productionDayWindow(new Date());

    const [hitung] = await this.db
      .select({ n: count() })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.kind, 'COMPONENT'),
          eq(scanEvents.plantId, pabrik.id),
          gte(scanEvents.scannedAt, start),
        ),
      );

    return {
      pabrik: { code: pabrik.code, name: pabrik.name, sapCode: pabrik.sapCode ?? null },
      gudang: gudang?.code ?? null,
      wip: wip?.code ?? null,
      kartuHariIni: Number(hitung?.n ?? 0),
      terakhir: await this.riwayat(pabrik.id),
    };
  }

  private async riwayat(plantId: number): Promise<RiwayatKomponen[]> {
    const rows = await this.db
      .select({
        id: scanEvents.id,
        rawCode: scanEvents.rawCode,
        qty: scanEvents.qty,
        scannedAt: scanEvents.scannedAt,
        meta: scanEvents.meta,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
      })
      .from(scanEvents)
      .leftJoin(parts, eq(parts.id, scanEvents.partId))
      .where(and(eq(scanEvents.kind, 'COMPONENT'), eq(scanEvents.plantId, plantId)))
      .orderBy(desc(scanEvents.scannedAt))
      .limit(RIWAYAT_MAKS);

    return rows.map((r) => ({
      id: r.id,
      rawCode: r.rawCode ?? '',
      /*
       * Dibaca dari meta scan, bukan diasumsikan 'ARES'.
       *
       * Baris lama dari masa stasiun ini masih melayani kartu internal tetap
       * ada di TT_HISTORY_SCAN, dan menampilkannya sebagai kartu ARES berarti
       * riwayat berubah isi secara surut.
       */
      jenisKartu:
        (r.meta as { jenisKartu?: string } | null)?.jenisKartu === 'ARES'
          ? ('ARES' as const)
          : null,
      partNumber: r.partNumber ?? null,
      backNumber: r.backNumber ?? null,
      qty: r.qty ?? null,
      scannedAt: r.scannedAt.toISOString(),
    }));
  }

  async scan(input: ScanKomponenInput, principal?: Principal): Promise<ScanKomponenResult> {
    const kartu: KartuKomponen | null = kenaliKartu(input.rawCode);
    if (!kartu) return this.tolak('TIDAK_DIKENALI', input.rawCode, null);

    /*
     * Kartu internal ditolak di sini, dengan menyebut apa yang ditembak.
     *
     * Tempat melepasnya berbeda per pabrik — dihitung di pos kanban di UNIT,
     * dilepas oleh belanja di BODY — dan menerimanya di sini membatalkan
     * keduanya. Lihat catatan di `kenaliKartu`.
     */
    if (kartu.jenis !== 'ARES') return this.tolak('BUKAN_KARTU_ARES', input.rawCode, null);

    const pabrik = await this.pabrikDari(input.plantCode);
    return this.scanAres(kartu.id, input, pabrik, principal);
  }

  /* ── Kartu komponen ARES: WH -> WP, dengan dokumen SAP ──────────────────── */

  private async scanAres(
    idKartu: string,
    input: ScanKomponenInput,
    pabrik: Awaited<ReturnType<KomponenService['pabrikDari']>>,
    principal?: Principal,
  ): Promise<ScanKomponenResult> {
    /*
     * Identitas barangnya diambil dari SCAN PENERIMAANNYA, bukan dari master
     * part. Kartu ARES diterbitkan sistem lain dan tidak harus ada di master
     * kita — justru itu yang membuat stasiun ini bisa jalan sebelum part beli
     * selesai diimpor.
     */
    const [terima] = await this.db
      .select({
        id: scanEvents.id,
        plantId: scanEvents.plantId,
        partId: scanEvents.partId,
        qty: scanEvents.qty,
        partNumber: parts.partNumber,
        partName: parts.name,
        backNumber: parts.backNumber,
      })
      .from(scanEvents)
      .leftJoin(parts, eq(parts.id, scanEvents.partId))
      .where(and(eq(scanEvents.kind, 'RECEIVING'), eq(scanEvents.rawCode, input.rawCode)))
      .orderBy(asc(scanEvents.scannedAt))
      .limit(1);

    if (!terima) return this.tolak('ARES_BELUM_DITERIMA', input.rawCode, 'ARES');
    if (terima.plantId !== pabrik.id) return this.tolak('BEDA_PABRIK', input.rawCode, 'ARES');

    /*
     * Kartu one-way: dipakai dua kali lalu habis. Pemeriksaan ini yang
     * mencegah pemakaian ketiga — dan pesannya menyebut KAPAN dipakai, sebab
     * "sudah dipakai" tanpa waktu tidak menolong siapa pun di lantai.
     */
    const [sudah] = await this.db
      .select({ scannedAt: scanEvents.scannedAt })
      .from(scanEvents)
      .where(and(eq(scanEvents.kind, 'COMPONENT'), eq(scanEvents.rawCode, input.rawCode)))
      .limit(1);
    if (sudah) {
      const hasil = this.tolak('ARES_SUDAH_DIPINDAH', input.rawCode, 'ARES');
      const jam = sudah.scannedAt.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return { ...hasil, pesan: `${hasil.pesan} Dipindah pukul ${jam}.` };
    }

    const { gudang, wip } = await this.slocPabrik(pabrik.id);
    if (!gudang || !wip) {
      throw new BadRequestException(
        `Pabrik ${pabrik.code} belum punya SLOC gudang atau WIP. Isi dulu di Master Data › Lokasi.`,
      );
    }

    const qty = terima.qty ?? 0;
    if (qty <= 0) {
      throw new BadRequestException(
        'Scan penerimaan kartu ini tidak mencatat jumlah. Perbaiki penerimaannya lebih dulu.',
      );
    }

    const sekarang = new Date();
    const npk = principal?.kind === 'user' ? principal.npk : null;
    const userId = principal?.kind === 'user' ? principal.sub : null;

    const scanId = await this.db.transaction(async (tx) => {
      const [ev] = await tx
        .insert(scanEvents)
        .values({
          plantId: pabrik.id,
          kind: 'COMPONENT',
          /*
           * Tanpa lini, dan itu disengaja. Perpindahan WH ke WP milik pabrik;
           * mengisi lini di sini berarti laporan per lini nanti menghitung box
           * yang sebetulnya tidak pernah dipakai lini itu.
           */
          lineId: null,
          partId: terima.partId ?? null,
          rawCode: input.rawCode,
          qty,
          userId,
          scannedAt: sekarang,
          /*
           * Kunci dedupe memakai kode kartunya sendiri, bukan waktu: kiriman
           * ulang akibat jaringan putus menghasilkan kunci yang sama dan
           * ditolak database, bukan box kedua yang pindah tanpa barangnya.
           */
          dedupeKey: `komponen:${input.rawCode}`,
          meta: { module: 'KANBAN_STATION', jenisKartu: 'ARES', aresId: idKartu },
        })
        .returning({ id: scanEvents.id });

      const dasar = {
        plantId: pabrik.id,
        /* Ikut kosong, dengan alasan yang sama seperti di scan event di atas. */
        lineId: null,
        partId: terima.partId!,
        sourceTable: 'TT_HISTORY_SCAN' as const,
        sourceId: ev!.id,
        npk,
        userId,
        occurredAt: sekarang,
      };

      /*
       * Sepasang mutasi, bukan satu. Pemungut outbox memasangkan TRANSFER_OUT
       * dengan TRANSFER_IN untuk menurunkan SLOC asal dan tujuan dokumennya;
       * satu baris saja menghasilkan dokumen ber-SLOC separuh yang ditahan.
       */
      await tx.insert(mutations).values({
        ...dasar,
        locationId: gudang.id,
        type: 'TRANSFER_OUT',
        qty: String(-qty),
        note: `Kartu komponen ke ${wip.code}`,
      });
      await tx.insert(mutations).values({
        ...dasar,
        locationId: wip.id,
        type: 'TRANSFER_IN',
        qty: String(qty),
        note: `Kartu komponen dari ${gudang.code}`,
      });

      return ev!.id;
    });

    this.logger.log(
      `kartu ARES ${idKartu} di ${pabrik.code}: ${qty} pcs ${gudang.code} ke ${wip.code} (scan ${scanId})`,
    );

    return {
      hasil: 'DITERIMA',
      jenisKartu: 'ARES',
      pesan: `${qty} pcs dipindah ke ${wip.code}`,
      rawCode: input.rawCode,
      partNumber: terima.partNumber ?? null,
      partName: terima.partName ?? null,
      backNumber: terima.backNumber ?? null,
      qty,
      dariSloc: gudang.code,
      keSloc: wip.code,
      keSap: true,
      scannedAt: sekarang.toISOString(),
    };
  }
}
