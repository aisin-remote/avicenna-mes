import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { isMasterEntity, ENTITY_DEFS, type MasterEntity } from '@avicenna/contracts';
import { MasterService } from './master.service';

/**
 * Satu controller untuk seluruh entitas master.
 *
 * URUTAN ROUTE PENTING: `options` dan `meta` harus dideklarasikan sebelum
 * `:id`, kalau tidak Nest akan mencocokkan "options" sebagai id dan menolaknya
 * sebagai bukan angka.
 */
@Controller('master')
export class MasterController {
  constructor(private readonly master: MasterService) {}

  /** Definisi seluruh entitas — dipakai UI membangun tabel dan formulir. */
  @Get('meta')
  meta() {
    return ENTITY_DEFS;
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
