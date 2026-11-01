import { Module } from '@nestjs/common';
import { PisController } from './pis.controller';
import { PisService } from './pis.service';
import { FotoService } from '../master/foto.service';

@Module({ controllers: [PisController], providers: [PisService, FotoService] })
export class PisModule {}
