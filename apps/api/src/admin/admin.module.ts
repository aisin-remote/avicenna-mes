import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';
import { MenuService } from './menu.service';
import { AdminController } from './admin.controller';
import { MeController } from './me.controller';

@Module({
  controllers: [AdminController, MeController],
  providers: [UsersService, RolesService, MenuService],
  exports: [MenuService],
})
export class AdminModule {}
