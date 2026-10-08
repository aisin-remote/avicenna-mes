import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Res,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  isMasterEntity,
  ENTITY_DEFS,
  kolomImpor,
  MAKS_UKURAN_IMPOR,
  type MasterEntity,
} from '@avicenna/contracts';
import { MasterService } from './master.service';
import { MasterImportService } from './import.service';
import { FotoService } from './foto.service';

/**
 * Satu controller untuk seluruh entitas master.
 *
 * URUTAN ROUTE PENTING: `options` dan `meta` harus dideklarasikan sebelum
 * `:id`, kalau tidak Nest akan mencocokkan "options" sebagai id dan menolaknya
 * sebagai bukan angka.
 */
@Controller('master')
export class MasterController {
  constructor(
    private readonly master: MasterService,
    private readonly impor: MasterImportService,
    private readonly foto: FotoService,
  ) {}

  /**
   * Menyajikan gambar yang tersimpan di aplikasi.
   *
   * Dideklarasikan SEBELUM route ber-:entity, kalau tidak "foto" akan
   * tertangkap sebagai nama entitas dan ditolak sebagai entitas tak dikenal.
   */
  @Get('foto/:nama')
  async ambilFoto(@Param('nama') nama: string, @Res() res: Response) {
    const { isi, mimeType, etag } = await this.foto.baca(nama);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('ETag', etag);
    // Nama berkas tidak pernah dipakai ulang, jadi isinya aman disimpan lama
    // di peramban — layar stasiun memuat gambar yang sama sepanjang shift.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(isi);
  }

  /**
   * Mengunggah gambar, mengembalikan nama berkas yang tersimpan.
   *
   * Terpisah dari penyimpanan barisnya supaya satu jalur ini melayani
   * penambahan maupun penyuntingan: layar mengunggah dulu, lalu menyimpan nama
   * yang dikembalikan bersama kolom lain. Baris yang gagal disimpan hanya
   * meninggalkan satu berkas yatim, bukan baris tanpa gambar atau sebaliknya.
   */
  @Post('foto')
  async unggahFoto(@Body() body: { fileBase64?: string; mimeType?: string }) {
    if (!body?.fileBase64) throw new BadRequestException('Berkas tidak ada dalam permintaan.');
    const nama = await this.foto.simpan({
      fileBase64: body.fileBase64,
      mimeType: body.mimeType,
    });
    return { nama };
  }

  /** Definisi seluruh entitas — dipakai UI membangun tabel dan formulir. */
  @Get('meta')
  meta() {
    return ENTITY_DEFS;
  }

  /* ── Unggah Excel ───────────────────────────────────────────────────────
   *
   * Ditaruh SEBELUM ':entity/:id'. Nest mencocokkan rute berurutan; di bawah
   * baris itu, "template" akan dianggap sebagai id dan ditolak sebagai bukan
   * angka — galat yang menyesatkan karena tidak menyebut soal urutan rute.
   */

  /** Berkas .xlsx kosong berisi judul kolom dan dropdown yang benar. */
  @Get(':entity/template')
  async template(@Param('entity') entity: string, @Res() res: Response) {
    const e = this.assertEntity(entity);
    const buf = await this.impor.template(e);
    const nama = `template-${e}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${nama}"`);
    res.send(buf);
  }

  /** Kolom template — dipakai layar untuk menjelaskan formatnya sebelum unduh. */
  @Get(':entity/import-columns')
  importColumns(@Param('entity') entity: string) {
    return kolomImpor(this.assertEntity(entity));
  }

  /**
   * Mengunggah berkas Excel.
   *
   * Berkas dikirim sebagai base64 di dalam JSON, bukan multipart. Alasannya
   * praktis: seluruh jalur tulis di aplikasi ini lewat Server Action Next,
   * yang sudah memegang berkasnya sebagai Buffer — meneruskannya sebagai JSON
   * menghindari satu pustaka multipart di API yang hanya dipakai satu endpoint.
   * Batas ukurannya kecil (5 MB), jadi biaya base64 tidak jadi soal.
   */
  @Post(':entity/import')
  async import(
    @Param('entity') entity: string,
    @Body() body: { fileBase64?: string; ujiSaja?: boolean },
  ) {
    const e = this.assertEntity(entity);
    const b64 = body?.fileBase64;
    if (!b64) throw new BadRequestException('Berkas tidak ada dalam permintaan.');

    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Berkas kosong.');
    if (buf.length > MAKS_UKURAN_IMPOR) {
      throw new BadRequestException(
        `Berkas ${(buf.length / 1024 / 1024).toFixed(1)} MB melebihi batas ` +
          `${MAKS_UKURAN_IMPOR / 1024 / 1024} MB.`,
      );
    }
    return this.impor.impor(e, buf, body?.ujiSaja !== false);
  }

  @Get(':entity/options')
  options(@Param('entity') entity: string) {
    return this.master.options(this.assertEntity(entity));
  }

  @Get(':entity')
  list(
    @Param('entity') entity: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    return this.master.list(this.assertEntity(entity), {
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(200, Math.max(1, Number(perPage) || 25)),
      q: q?.trim() || undefined,
      sort: sort || undefined,
      dir: dir === 'desc' ? 'desc' : 'asc',
    });
  }

  @Get(':entity/:id')
  findOne(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number) {
    return this.master.findOne(this.assertEntity(entity), id);
  }

  @Post(':entity')
  create(@Param('entity') entity: string, @Body() body: unknown) {
    return this.master.create(this.assertEntity(entity), body);
  }

  @Patch(':entity/:id')
  update(
    @Param('entity') entity: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.master.update(this.assertEntity(entity), id, body);
  }

  @Patch(':entity/:id/active')
  setActive(
    @Param('entity') entity: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isActive?: boolean },
  ) {
    return this.master.setActive(this.assertEntity(entity), id, body?.isActive !== false);
  }

  @Delete(':entity/:id')
  remove(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number) {
    return this.master.remove(this.assertEntity(entity), id);
  }

  /** Menolak nama entitas yang tidak dikenal sebelum menyentuh database. */
  private assertEntity(entity: string): MasterEntity {
    if (!isMasterEntity(entity)) {
      throw new BadRequestException(`Entitas master "${entity}" tidak dikenal`);
    }
    return entity;
  }
}
