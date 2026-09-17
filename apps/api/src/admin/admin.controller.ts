import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';
import { MenuService } from './menu.service';
import { AdminOnly } from '../auth/admin.guard';

/**
 * Pengaturan pengguna, role, dan hak menu.
 *
 * @AdminOnly dipasang di TINGKAT CONTROLLER, bukan per method. Endpoint baru
 * yang ditambahkan nanti otomatis ikut terlindungi — kebalikannya, penandaan
 * per method berarti satu kali lupa membuka seluruh pengaturan sistem kepada
 * siapa pun yang punya token.
 */
@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly roles: RolesService,
    private readonly menu: MenuService,
  ) {}

  /* ── Pengguna ───────────────────────────────────────────────────────────── */

  @Get('users')
  listUsers(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('roleId') roleId?: string,
    @Query('plantId') plantId?: string,
    @Query('aktif') aktif?: string,
  ) {
    return this.users.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(200, Math.max(1, Number(perPage) || 25)),
      q: q?.trim() || undefined,
      roleId: Number(roleId) || undefined,
      plantId: Number(plantId) || undefined,
      aktif: aktif === undefined || aktif === '' ? undefined : aktif === 'true',
    });
  }

  @Get('users/:id')
  findUser(@Param('id', ParseIntPipe) id: number) {
    return this.users.findOne(id);
  }

  @Post('users')
  createUser(@Body() body: unknown) {
    return this.users.create(body);
  }

  @Patch('users/:id')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @Req() req: Request) {
    return this.users.update(id, body, req.principal);
  }

  @Patch('users/:id/active')
  setUserActive(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isActive?: boolean },
    @Req() req: Request,
  ) {
    return this.users.setActive(id, body?.isActive !== false, req.principal);
  }

  @Post('users/:id/password')
  resetPassword(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.users.resetPassword(id, body);
  }

  /* ── Role ───────────────────────────────────────────────────────────────── */

  @Get('roles')
  listRoles() {
    return this.roles.list();
  }

  @Get('roles/:id')
  findRole(@Param('id', ParseIntPipe) id: number) {
    return this.roles.findOne(id);
  }

  @Post('roles')
  createRole(@Body() body: unknown) {
    return this.roles.create(body);
  }

  @Patch('roles/:id')
  updateRole(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.roles.update(id, body);
  }

  /** Mengganti SELURUH daftar menu sebuah role — PUT, bukan PATCH. */
  @Put('roles/:id/menus')
  setRoleMenus(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.roles.setMenus(id, body);
  }

  @Delete('roles/:id')
  removeRole(@Param('id', ParseIntPipe) id: number) {
    return this.roles.remove(id);
  }

  /* ── Menu ───────────────────────────────────────────────────────────────── */

  /** Katalog menu — isi daftar centang di layar role. */
  @Get('menus')
  listMenus() {
    return this.menu.katalog();
  }

  /** Menyalin ulang katalog dari kode, tanpa menyalakan ulang API. */
  @Post('menus/sinkron')
  sinkronMenus() {
    return this.menu.sinkron();
  }
}
