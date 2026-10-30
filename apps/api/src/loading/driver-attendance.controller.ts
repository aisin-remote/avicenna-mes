import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { driverAttendanceStartSchema, type DriverAttendanceStart } from '@avicenna/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DriverAttendanceService } from './driver-attendance.service';

const plantQuery = z.object({ plantId: z.coerce.number().int().positive().optional() });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const parsed = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
  }, 'Tanggal tidak valid.');
const historyQuery = plantQuery.extend({
  from: date,
  to: date,
  page: z.coerce.number().int().min(1).default(1),
});
const resolveQuery = plantQuery.extend({ code: z.string().trim().min(1).max(128) });

@Controller('driver-attendance')
export class DriverAttendanceController {
  constructor(private readonly attendance: DriverAttendanceService) {}
  @Get()
  board(
    @Query(new ZodValidationPipe(plantQuery)) q: z.infer<typeof plantQuery>,
    @Req() req: Request,
  ) {
    return this.attendance.board(q.plantId, req.principal);
  }
  @Get('resolve')
  resolve(
    @Query(new ZodValidationPipe(resolveQuery)) q: z.infer<typeof resolveQuery>,
    @Req() req: Request,
  ) {
    return this.attendance.resolve(q.code, q.plantId, req.principal);
  }
  @Get('history')
  history(
    @Query(new ZodValidationPipe(historyQuery)) q: z.infer<typeof historyQuery>,
    @Req() req: Request,
  ) {
    return this.attendance.history(q, req.principal);
  }
  @Get('export')
  async export(
    @Query(new ZodValidationPipe(historyQuery)) q: z.infer<typeof historyQuery>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rows = await this.attendance.exportRows(q, req.principal);
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Absensi Driver');
    sheet.columns = [
      { header: 'NO', key: 'no', width: 7 },
      { header: 'CUSTOMER', key: 'customer', width: 32 },
      { header: 'ROUTE / DOCK', key: 'dock', width: 22 },
      { header: 'CYCLE', key: 'cycle', width: 9 },
      { header: 'LP', key: 'lp', width: 24 },
      { header: 'TRUCK', key: 'slot', width: 14 },
      { header: 'START (WIB)', key: 'start', width: 24 },
      { header: 'END (WIB)', key: 'end', width: 24 },
      { header: 'DURASI', key: 'duration', width: 14 },
      { header: 'DN / DO', key: 'dn', width: 52 },
      { header: 'HELM', key: 'helmet', width: 9 },
      { header: 'ROMPI', key: 'vest', width: 9 },
      { header: 'SEPATU', key: 'shoes', width: 9 },
    ];
    const time = (s: string | null) =>
      s ? new Date(s).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
    rows.forEach((r, i) =>
      sheet.addRow({
        no: i + 1,
        customer: r.destinationName,
        dock: r.dock,
        cycle: `C${r.cycle}`,
        lp: r.logistic,
        slot: r.slot === 1 ? '01 Depan' : '02 Belakang',
        start: time(r.startedAt),
        end: time(r.endedAt),
        duration: r.endedAt
          ? `${Math.floor((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000)} detik`
          : 'Sedang pickup',
        dn: r.orders.map((o) => o.number ?? o.pdsNumber).join(', '),
        helmet: r.helmet ? 'Ya' : 'Tidak',
        vest: r.vest ? 'Ya' : 'Tidak',
        shoes: r.shoes ? 'Ya' : 'Tidak',
      }),
    );
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = 'A1:M1';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="absensi-driver-${q.from}-${q.to}.xlsx"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(await book.xlsx.writeBuffer()));
  }
  @Post('start')
  start(
    @Body(new ZodValidationPipe(driverAttendanceStartSchema)) body: DriverAttendanceStart,
    @Req() req: Request,
  ) {
    return this.attendance.start(body, req.principal);
  }
  @Post(':id/finish')
  finish(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.attendance.finish(id, req.principal);
  }
  @Get(':id/photo')
  async photo(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response) {
    const photo = await this.attendance.photo(id, req.principal);
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.isi);
  }
}
