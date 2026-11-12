import { BadRequestException, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type Database,
} from '@avicenna/db';
import {
  lineStops,
  lines,
  ngRecords,
  partProcesses,
  parts,
  plants,
  scanEvents,
  workBreaks,
  workTimes,
} from '@avicenna/db';
import {
  istirahatNyata,
  jamShift,
  jendelaShift,
  menitBersih,
  persenEfisiensi,
  persenNg,
  shiftPada,
  tanggalMulaiShift,
  uraiQrUnit,
  type Jendela,
  type JamShift,
} from '@avicenna/domain';
import type {
  BarisLaporanProduksi,
  DashboardEfisiensi,
  EfisiensiJam,
  EfisiensiLini,
  LaporanProduksi,
  RingkasLaporanProduksi,
  ShiftPilihan,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';
import { ProcessTypeService } from '../master/process-type.service';

/** Laporan terpanjang sekali minta. Tiap hari = tiga hitungan shift. */
const HARI_MAKS = 31;

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

interface Shift extends ShiftPilihan {
  startTime: string;
  endTime: string;
  startsProductionDay: boolean;
  istirahat: { startTime: string; endTime: string }[];
}

/** Hasil hitung satu line pada satu shift, sebelum dibentuk untuk layar. */
interface HitungLini {
  lineId: number;
  lineCode: string;
  lineName: string;
  processType: string | null;
  punyaCt: boolean;
  model: string | null;
  menitBersih: number;
  menitBerhenti: number;
  ril: number;
  rol: number;
  /** per ember jam: ok, detik dihasilkan, ok tanpa CT */
  jam: { ok: number; detik: number; tanpaCt: number; menit: number }[];
  /** per part */
  part: Map<number, { ok: number; ril: number; rol: number; ct: number | null }>;
}

const bulat = (n: number | null, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * Dashboard efisiensi dan laporan produksi.
 *
 * Satu hitungan inti per (pabrik, tanggal, shift) dipakai keduanya, supaya
 * angka di dashboard dan di laporan tidak pernah berbeda. Hanya membaca.
 */
@Injectable()
export class LaporanService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly processTypes: ProcessTypeService,
  ) {}

  // ── Dashboard ──────────────────────────────────────────────────────────────

  async dashboard(q: {
    plant?: string;
    tanggal?: string;
    shift?: string;
    proses?: string;
  }): Promise<DashboardEfisiensi> {
    const { plant, daftarPlant } = await this.pabrik(q.plant);
    const kosong = (
      pesan: string,
      tanggal = '',
      shifts: ShiftPilihan[] = [],
    ): DashboardEfisiensi => ({
      plant,
      plants: daftarPlant,
      tanggal,
      shift: null,
      shifts,
      jamSekarang: null,
      jam: [],
      lini: [],
      total: { efisiensi: null, ok: 0, ril: 0, rol: 0, rilPct: null, rolPct: null, perJam: [] },
      pesan,
    });
    if (!plant) return kosong('Belum ada pabrik.');

    const shifts = await this.shiftPabrik(plant.id);
    const pilihan = shifts.map(({ code, name, mulai, selesai }) => ({
      code,
      name,
      mulai,
      selesai,
    }));
    if (shifts.length === 0) {
      return kosong(`Jam kerja ${plant.code} belum diisi di Master Data › Jam Kerja.`);
    }

    const sekarang = new Date();
    const berjalan = shiftPada(sekarang, shifts);
    const shift =
      shifts.find((s) => s.code === q.shift) ??
      (q.tanggal ? shifts[0]! : (shifts.find((s) => s.code === berjalan?.code) ?? shifts[0]!));
    const tanggal =
      q.tanggal && TANGGAL.test(q.tanggal) ? q.tanggal : tanggalMulaiShift(sekarang, shift);

    const jendela = jendelaShift(tanggal, shift);
    const jam = jamShift(jendela);
    const hasil = await this.hitung(plant.id, tanggal, shift, jendela, jam, sekarang);
    const lini = q.proses ? hasil.filter((h) => h.processType === q.proses) : hasil;

    const idxSekarang = jam.findIndex((j) => sekarang >= j.dari && sekarang < j.sampai);
    const perJam = (h: HitungLini): EfisiensiJam[] =>
      jam.map((j, i) => ({
        ke: j.ke,
        label: j.label,
        ok: h.jam[i]!.ok,
        menitBersih: Math.round(h.jam[i]!.menit),
        efisiensi: h.punyaCt ? bulat(persenEfisiensi(h.jam[i]!.detik, h.jam[i]!.menit)) : null,
      }));

    const baris: EfisiensiLini[] = lini.map((h) => {
      const pj = perJam(h);
      const ok = h.jam.reduce((n, x) => n + x.ok, 0);
      const ngTotal = h.ril + h.rol;
      const idx = idxSekarang >= 0 ? idxSekarang : lastIndex(pj, (x) => x.ok > 0);
      const detik = h.jam.reduce((n, x) => n + x.detik, 0);
      return {
        lineId: h.lineId,
        lineCode: h.lineCode,
        lineName: h.lineName,
        processType: h.processType,
        model: h.model,
        efisiensiJam: idx >= 0 ? pj[idx]!.efisiensi : null,
        labelJam: idx >= 0 ? pj[idx]!.label : null,
        efisiensiShift: h.punyaCt ? bulat(persenEfisiensi(detik, h.menitBersih)) : null,
        ok,
        ril: h.ril,
        rol: h.rol,
        rilPct: bulat(persenNg(h.ril, ok, ngTotal), 2),
        rolPct: bulat(persenNg(h.rol, ok, ngTotal), 2),
        menitBersih: Math.round(h.menitBersih),
        menitBerhenti: Math.round(h.menitBerhenti),
        okTanpaCt: h.jam.reduce((n, x) => n + x.tanpaCt, 0),
        perJam: pj,
      };
    });

    // Gabungan: hanya line yang punya cycle time ikut efisiensi gabungan.
    const berCt = lini.filter((h) => h.punyaCt);
    const totalPerJam: EfisiensiJam[] = jam.map((j, i) => {
      const detik = berCt.reduce((n, h) => n + h.jam[i]!.detik, 0);
      const menit = berCt.reduce((n, h) => n + h.jam[i]!.menit, 0);
      return {
        ke: j.ke,
        label: j.label,
        ok: lini.reduce((n, h) => n + h.jam[i]!.ok, 0),
        menitBersih: Math.round(menit),
        efisiensi: berCt.length ? bulat(persenEfisiensi(detik, menit)) : null,
      };
    });
    const ok = baris.reduce((n, b) => n + b.ok, 0);
    const ril = baris.reduce((n, b) => n + b.ril, 0);
    const rol = baris.reduce((n, b) => n + b.rol, 0);
    const detikTotal = berCt.reduce((n, h) => n + h.jam.reduce((m, x) => m + x.detik, 0), 0);
    const menitTotal = berCt.reduce((n, h) => n + h.menitBersih, 0);

    return {
      plant,
      plants: daftarPlant,
      tanggal,
      shift: { code: shift.code, name: shift.name, mulai: shift.mulai, selesai: shift.selesai },
      shifts: pilihan,
      jamSekarang: idxSekarang >= 0 ? jam[idxSekarang]!.ke : null,
      jam: jam.map((j) => ({ ke: j.ke, label: j.label })),
      lini: baris,
      total: {
        efisiensi: berCt.length ? bulat(persenEfisiensi(detikTotal, menitTotal)) : null,
        ok,
        ril,
        rol,
        rilPct: bulat(persenNg(ril, ok, ril + rol), 2),
        rolPct: bulat(persenNg(rol, ok, ril + rol), 2),
        perJam: totalPerJam,
      },
      pesan: null,
    };
  }

  // ── Laporan ────────────────────────────────────────────────────────────────

  async laporan(q: { plant?: string; dari?: string; sampai?: string }): Promise<LaporanProduksi> {
    const { plant, daftarPlant } = await this.pabrik(q.plant);
    const sekarang = new Date();
    const hariIni = tanggalMulaiShift(sekarang, { startTime: '00:00', endTime: '23:59' });
    const dari = q.dari && TANGGAL.test(q.dari) ? q.dari : hariIni;
    const sampai = q.sampai && TANGGAL.test(q.sampai) ? q.sampai : dari;
    if (sampai < dari) throw new BadRequestException('Tanggal akhir sebelum tanggal awal');
    const tanggal = rentangTanggal(dari, sampai);
    if (tanggal.length > HARI_MAKS) {
      throw new BadRequestException(`Laporan paling panjang ${HARI_MAKS} hari sekali tampil`);
    }

    const dasar = { plant, plants: daftarPlant, dari, sampai, ringkas: [] };
    if (!plant) return { ...dasar, pesan: 'Belum ada pabrik.' };
    const shifts = await this.shiftPabrik(plant.id);
    if (shifts.length === 0) {
      return { ...dasar, pesan: `Jam kerja ${plant.code} belum diisi di Master Data › Jam Kerja.` };
    }

    const ringkas: RingkasLaporanProduksi[] = [];
    const namaPart = new Map<
      number,
      { partNumber: string; backNumber: string | null; name: string | null }
    >();

    for (const t of tanggal) {
      for (const s of shifts) {
        const jendela = jendelaShift(t, s);
        if (jendela.dari > sekarang) continue;
        const jam = jamShift(jendela);
        const hasil = await this.hitung(plant.id, t, s, jendela, jam, sekarang);
        const perluNama = hasil
          .flatMap((h) => [...h.part.keys()])
          .filter((id) => !namaPart.has(id));
        if (perluNama.length) {
          const rows = await this.db
            .select({
              id: parts.id,
              partNumber: parts.partNumber,
              backNumber: parts.backNumber,
              name: parts.name,
            })
            .from(parts)
            .where(inArray(parts.id, [...new Set(perluNama)]));
          for (const r of rows) namaPart.set(r.id, r);
        }

        for (const h of hasil) {
          const ok = h.jam.reduce((n, x) => n + x.ok, 0);
          const detik = h.jam.reduce((n, x) => n + x.detik, 0);
          const baris: BarisLaporanProduksi[] = [...h.part.entries()].map(([partId, p]) => {
            const n = namaPart.get(partId);
            return {
              tanggal: t,
              shift: s.code,
              lineCode: h.lineCode,
              partNumber: n?.partNumber ?? String(partId),
              backNumber: n?.backNumber ?? null,
              partName: n?.name ?? null,
              ok: p.ok,
              ril: p.ril,
              rol: p.rol,
              cycleTime: p.ct,
              menitDihasilkan: p.ct === null ? null : bulat((p.ok * p.ct) / 60),
            };
          });
          ringkas.push({
            tanggal: t,
            shift: s.code,
            lineCode: h.lineCode,
            lineName: h.lineName,
            ok,
            ril: h.ril,
            rol: h.rol,
            rilPct: bulat(persenNg(h.ril, ok, h.ril + h.rol), 2),
            rolPct: bulat(persenNg(h.rol, ok, h.ril + h.rol), 2),
            menitBersih: Math.round(h.menitBersih),
            menitDihasilkan: h.punyaCt ? bulat(detik / 60) : null,
            efisiensi: h.punyaCt ? bulat(persenEfisiensi(detik, h.menitBersih)) : null,
            menitBerhenti: Math.round(h.menitBerhenti),
            baris: baris.sort((a, b) => a.partNumber.localeCompare(b.partNumber)),
          });
        }
      }
    }
    return { ...dasar, ringkas, pesan: null };
  }

  // ── Inti ───────────────────────────────────────────────────────────────────

  /**
   * Hitungan satu shift: OK, NG, cycle time, menit bersih, dan berhenti, per
   * line dan per ember jam. Line yang tampil = yang punya scan produksi atau
   * NG pada shift itu.
   */
  private async hitung(
    plantId: number,
    tanggal: string,
    shift: Shift,
    jendela: Jendela,
    jam: JamShift[],
    sekarang: Date,
  ): Promise<HitungLini[]> {
    const ist = istirahatNyata(tanggal, shift, shift.istirahat);
    const batas = sekarang < jendela.sampai ? sekarang : undefined;

    const scans = await this.db
      .select({
        id: scanEvents.id,
        lineId: scanEvents.lineId,
        partId: scanEvents.partId,
        qty: scanEvents.qty,
        waktu: scanEvents.scannedAt,
        serial: scanEvents.serialNumber,
        model: sql<string | null>`${scanEvents.meta}->>'model'`,
      })
      .from(scanEvents)
      .innerJoin(lines, eq(scanEvents.lineId, lines.id))
      .where(
        and(
          eq(lines.plantId, plantId),
          eq(scanEvents.kind, 'PRODUCTION'),
          gte(scanEvents.scannedAt, jendela.dari),
          lt(scanEvents.scannedAt, jendela.sampai),
        ),
      )
      .orderBy(asc(scanEvents.scannedAt));

    const scanIds = scans.map((s) => s.id);
    const [ngShift, ngDariScan] = await Promise.all([
      this.db
        .select({
          lineId: ngRecords.lineId,
          partId: ngRecords.partId,
          origin: ngRecords.origin,
          qty: ngRecords.qty,
        })
        .from(ngRecords)
        .innerJoin(lines, eq(ngRecords.lineId, lines.id))
        .where(
          and(
            eq(lines.plantId, plantId),
            isNull(ngRecords.cancelledAt),
            gte(ngRecords.occurredAt, jendela.dari),
            lt(ngRecords.occurredAt, jendela.sampai),
          ),
        ),
      /*
       * NG yang menunjuk scan produksi shift ini — kapan pun dicatatnya. Unit
       * itu sudah dibalik stoknya oleh NG, jadi tidak boleh dihitung OK.
       */
      scanIds.length
        ? this.db
            .select({ scanId: ngRecords.scanEventId, qty: ngRecords.qty })
            .from(ngRecords)
            .where(and(isNull(ngRecords.cancelledAt), inArray(ngRecords.scanEventId, scanIds)))
        : Promise.resolve([] as { scanId: number | null; qty: number }[]),
    ]);

    const katalog = await this.processTypes.katalog();
    const lineIds = [
      ...new Set([...scans.map((s) => s.lineId!), ...ngShift.map((n) => n.lineId!)]),
    ];
    if (lineIds.length === 0) return [];

    const [infoLine, rute, berhenti] = await Promise.all([
      this.db
        .select({
          id: lines.id,
          code: lines.code,
          name: lines.name,
          processType: lines.processType,
        })
        .from(lines)
        .where(inArray(lines.id, lineIds)),
      this.db
        .select({
          lineId: partProcesses.lineId,
          partId: partProcesses.partId,
          ct: partProcesses.cycleTime,
        })
        .from(partProcesses)
        .where(
          and(
            inArray(partProcesses.lineId, lineIds),
            eq(partProcesses.isActive, true),
            isNotNull(partProcesses.cycleTime),
          ),
        ),
      this.db
        .select({ lineId: lineStops.lineId, dari: lineStops.startedAt, sampai: lineStops.endedAt })
        .from(lineStops)
        .where(
          and(
            inArray(lineStops.lineId, lineIds),
            lt(lineStops.startedAt, jendela.sampai),
            or(isNull(lineStops.endedAt), sql`${lineStops.endedAt} > ${jendela.dari}`),
          ),
        ),
    ]);

    const ct = new Map(rute.map((r) => [`${r.lineId}|${r.partId}`, Number(r.ct)]));
    const lineBerCt = new Set(rute.map((r) => r.lineId));
    const potongOk = new Map<number, number>();
    for (const n of ngDariScan)
      if (n.scanId) potongOk.set(n.scanId, (potongOk.get(n.scanId) ?? 0) + n.qty);

    const menitJam = jam.map((j) => menitBersih(j, ist, batas));
    const menitShift = menitBersih(jendela, ist, batas);

    const hasil = new Map<number, HitungLini>();
    for (const l of infoLine) {
      if (katalog.grup(l.processType) === 'RECEIVING') continue;
      hasil.set(l.id, {
        lineId: l.id,
        lineCode: l.code,
        lineName: l.name,
        processType: l.processType,
        punyaCt: lineBerCt.has(l.id),
        model: null,
        menitBersih: menitShift,
        menitBerhenti: 0,
        ril: 0,
        rol: 0,
        jam: menitJam.map((menit) => ({ ok: 0, detik: 0, tanpaCt: 0, menit })),
        part: new Map(),
      });
    }

    const bagianPart = (h: HitungLini, partId: number) => {
      let p = h.part.get(partId);
      if (!p) {
        p = { ok: 0, ril: 0, rol: 0, ct: ct.get(`${h.lineId}|${partId}`) ?? null };
        h.part.set(partId, p);
      }
      return p;
    };

    for (const s of scans) {
      const h = hasil.get(s.lineId!);
      if (!h || !s.partId) continue;
      const ok = Math.max(0, s.qty - (potongOk.get(s.id) ?? 0));
      const i = jam.findIndex((j) => s.waktu >= j.dari && s.waktu < j.sampai);
      if (i < 0) continue;
      const p = bagianPart(h, s.partId);
      p.ok += ok;
      h.jam[i]!.ok += ok;
      if (p.ct !== null) h.jam[i]!.detik += ok * p.ct;
      else h.jam[i]!.tanpaCt += ok;
      h.model = modelDari(s.model, s.serial) ?? h.model;
    }

    for (const n of ngShift) {
      const h = hasil.get(n.lineId!);
      if (!h) continue;
      const p = bagianPart(h, n.partId);
      if (n.origin === 'INLINE') {
        h.ril += n.qty;
        p.ril += n.qty;
      } else {
        h.rol += n.qty;
        p.rol += n.qty;
      }
    }

    const ujung = batas ?? jendela.sampai;
    for (const b of berhenti) {
      const h = hasil.get(b.lineId);
      if (!h) continue;
      const dari = Math.max(b.dari.getTime(), jendela.dari.getTime());
      const sampai = Math.min((b.sampai ?? ujung).getTime(), ujung.getTime());
      if (sampai > dari) h.menitBerhenti += (sampai - dari) / 60_000;
    }

    // Line tanpa model dari QR: back number part terakhir yang discan.
    const tanpaModel = [...hasil.values()].filter((h) => !h.model && h.part.size > 0);
    if (tanpaModel.length) {
      const terakhir = new Map<number, number>();
      for (const s of scans) if (s.lineId && s.partId) terakhir.set(s.lineId, s.partId);
      const ids = [
        ...new Set(tanpaModel.map((h) => terakhir.get(h.lineId)).filter((x): x is number => !!x)),
      ];
      if (ids.length) {
        const rows = await this.db
          .select({ id: parts.id, backNumber: parts.backNumber, partNumber: parts.partNumber })
          .from(parts)
          .where(inArray(parts.id, ids));
        const peta = new Map(rows.map((r) => [r.id, r.backNumber ?? r.partNumber]));
        for (const h of tanpaModel) h.model = peta.get(terakhir.get(h.lineId) ?? -1) ?? null;
      }
    }

    return [...hasil.values()].sort((a, b) => a.lineCode.localeCompare(b.lineCode));
  }

  private async shiftPabrik(plantId: number): Promise<Shift[]> {
    const rows = await this.db
      .select({
        id: workTimes.id,
        code: workTimes.code,
        name: workTimes.name,
        startTime: workTimes.startTime,
        endTime: workTimes.endTime,
        startsProductionDay: workTimes.startsProductionDay,
      })
      .from(workTimes)
      .where(and(eq(workTimes.plantId, plantId), eq(workTimes.isActive, true)))
      .orderBy(asc(workTimes.code));
    if (rows.length === 0) return [];
    const ist = await this.db
      .select({
        workTimeId: workBreaks.workTimeId,
        startTime: workBreaks.startTime,
        endTime: workBreaks.endTime,
      })
      .from(workBreaks)
      .where(
        and(
          inArray(
            workBreaks.workTimeId,
            rows.map((r) => r.id),
          ),
          eq(workBreaks.isActive, true),
        ),
      );
    const lima = (t: string) => t.slice(0, 5);
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      mulai: lima(r.startTime),
      selesai: lima(r.endTime),
      startTime: r.startTime,
      endTime: r.endTime,
      startsProductionDay: r.startsProductionDay,
      istirahat: ist
        .filter((i) => i.workTimeId === r.id)
        .map((i) => ({ startTime: i.startTime, endTime: i.endTime })),
    }));
  }

  private async pabrik(kode?: string) {
    const daftarPlant = await this.db
      .select({ id: plants.id, code: plants.code })
      .from(plants)
      .orderBy(asc(plants.id));
    const plant =
      daftarPlant.find((p) => p.code.toUpperCase() === kode?.toUpperCase()) ??
      daftarPlant[0] ??
      null;
    return { plant, daftarPlant };
  }
}

/** "TCC D98E #12" dari meta model + nomor die di QR 15 digit. */
function modelDari(model: string | null, serial: string | null): string | null {
  if (!model) return null;
  const qr = serial ? uraiQrUnit(serial) : null;
  const die = qr ? Number.parseInt(qr.die, 10) : Number.NaN;
  return Number.isFinite(die) ? `${model} #${die}` : model;
}

function lastIndex<T>(xs: T[], f: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (f(xs[i]!)) return i;
  return -1;
}

function rentangTanggal(dari: string, sampai: string): string[] {
  const hasil: string[] = [];
  const [y, m, d] = dari.split('-').map(Number) as [number, number, number];
  const dua = (n: number) => String(n).padStart(2, '0');
  for (let i = 0; i <= HARI_MAKS + 1; i++) {
    const t = new Date(y, m - 1, d + i);
    const s = `${t.getFullYear()}-${dua(t.getMonth() + 1)}-${dua(t.getDate())}`;
    if (s > sampai) break;
    hasil.push(s);
  }
  return hasil;
}
