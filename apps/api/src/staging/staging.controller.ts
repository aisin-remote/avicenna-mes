import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { StagingDbService } from './staging-db.service';
import { StagingSchemaService } from './staging-schema.service';
import { StagingPushService } from './staging-push.service';
import { StagingPullService } from './staging-pull.service';
import { GOODS_MOVEMENT, FLAG } from './staging-tables';

/**
 * Endpoint diagnostik untuk database jembatan.
 *
 * Semuanya dipicu orang, bukan dijadwalkan — jadwalnya ada di StagingWorker.
 * Yang ada di sini untuk menjawab satu pertanyaan saat penyambungan pertama:
 * "sebenarnya sekarang nyambung atau tidak, dan apa yang menghalangi."
 */
@Controller('staging')
export class StagingController {
  constructor(
    private readonly db: StagingDbService,
    private readonly skema: StagingSchemaService,
    private readonly push: StagingPushService,
    private readonly pull: StagingPullService,
  ) {}

  /**
   * Keadaan sambungan.
   *
   * Bawaannya MELAPORKAN keadaan terakhir tanpa menyentuh jaringan, supaya
   * layar pemantauan tidak ikut menggantung saat SQL Server pabrik mati.
   * `?uji=true` benar-benar menyambung — itu yang dipakai tombol "uji sambungan".
   */
  @Get('status')
  async status(@Query('uji') uji?: string) {
    if (uji !== 'true') {
      return {
        sambungan: this.db.keadaan(),
        preflight: null,
        target: `${GOODS_MOVEMENT.kepala} + ${GOODS_MOVEMENT.baris}`,
        flag: FLAG,
      };
    }
    const sambungan = await this.db.cek();
    if (!sambungan.tersambung) {
      return {
        sambungan,
        preflight: null,
        target: `${GOODS_MOVEMENT.kepala} + ${GOODS_MOVEMENT.baris}`,
        flag: FLAG,
      };
    }
    const preflight = await this.skema.preflight(true).catch((err: Error) => ({
      lulus: false,
      tabelDitemukan: false,
      kolomHilang: [],
      indeksUnikIdempotency: false,
      catatan: [err.message],
    }));
    return {
      sambungan,
      preflight,
      target: `${GOODS_MOVEMENT.kepala} + ${GOODS_MOVEMENT.baris}`,
      flag: FLAG,
    };
  }

  /**
   * Struktur database staging apa adanya.
   *
   * Inilah yang dipakai mengisi staging-tables.ts tanpa menunggu dokumen dari
   * tim SAP: nama tabel dan kolomnya dibaca langsung dari sumbernya.
   */
  @Get('schema')
  async schema(@Query('tabel') tabel?: string) {
    if (tabel) {
      return {
        tabel,
        kolom: await this.skema.kolomDari(tabel),
        indeks: await this.skema.indeksDari(tabel),
      };
    }
    return this.skema.potret();
  }

  /** Mendorong sekarang juga, tanpa menunggu putaran berikutnya. */
  @Post('push')
  dorong() {
    return this.push.dorong();
  }

  /** Membaca flag balasan SAP sekarang juga. */
  @Post('ack')
  balasan() {
    return this.push.ambilBalasan();
  }

  /**
   * Menarik master dari staging.
   *
   * Bawaannya UJI COBA — tidak menulis apa pun, hanya melaporkan berapa baris
   * yang akan berubah. Menulis sungguhan harus diminta dengan ?uji=false,
   * karena tarik master menimpa apa yang ada di layar master kita.
   */
  @Post('pull')
  tarik(@Query('uji') uji?: string) {
    return this.pull.tarikSemua(uji !== 'false');
  }

  /** Menarik delivery untuk hari operasional terpilih. Bawaannya uji coba. */
  @Post('pull-delivery')
  tarikPengiriman(@Query('date') date?: string, @Query('uji') uji?: string) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date harus berformat YYYY-MM-DD');
    }
    return this.pull.tarikPengiriman(
      date ? new Date(`${date}T12:00:00`) : new Date(),
      uji !== 'false',
    );
  }
}
