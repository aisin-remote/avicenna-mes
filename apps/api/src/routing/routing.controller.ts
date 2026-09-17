import { Body, Controller, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { processTypeSchema } from '@avicenna/contracts';
import { RoutingService } from './routing.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const ruteSchema = z.object({
  /** Terurut sesuai jalannya barang. Kosong berarti rutenya dihapus. */
  proses: z.array(processTypeSchema).max(20),
});
type RuteInput = z.infer<typeof ruteSchema>;

@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  /** Matriks part × proses — bentuk yang sama dengan tabel rute di lapangan. */
  @Get('matrix')
  matriks(@Query('plantId') plantId?: string) {
    const id = Number(plantId);
    return this.routing.matriks(Number.isFinite(id) && id > 0 ? id : undefined);
  }

  @Get('lines')
  lines() {
    return this.routing.liniPerProses();
  }

  /** Mengganti seluruh rute satu part sekaligus. */
  @Put('part/:partId')
  simpan(
    @Param('partId', ParseIntPipe) partId: number,
    @Body(new ZodValidationPipe(ruteSchema)) body: RuteInput,
  ) {
    return this.routing.simpanRute(partId, body.proses);
  }
}
