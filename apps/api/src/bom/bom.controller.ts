import { Controller, Get, Param, Post } from '@nestjs/common';
import { BomService } from './bom.service';

@Controller('bom')
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Get('fg')
  daftarFg() {
    return this.bom.daftarFg();
  }

  @Get('fg/:partNumber')
  pohon(@Param('partNumber') partNumber: string) {
    return this.bom.pohon(partNumber);
  }

  @Post('salin-pairing')
  salinKePairing() {
    return this.bom.salinKePairing();
  }
}
