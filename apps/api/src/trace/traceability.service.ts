import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql, type Database } from '@avicenna/db';
import {
  deliveries,
  deliveryKanbans,
  genealogy,
  kanbanEvents,
  kanbanItems,
  kanbans,
  lines,
  lots,
  mutations,
  parts,
  plants,
  programNumbers,
  sapOutbox,
  scanEvents,
  users,
} from '@avicenna/db';
import { bacaKanban, kanbanAigsysRusak, uraiQrUnit } from '@avicenna/domain';
import type {
  HasilTraceKanban,
  HasilTracePart,
  TraceKanbanDetail,
  TraceKanbanRingkas,
  TraceKomponen,
  TracePartRingkas,
  TraceSap,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';

/** Batas baris per daftar: cukup untuk menelusuri, tidak menenggelamkan layar. */
const BATAS = 200;

/** Nomor part baku: tanpa garis dan spasi, huruf besar. */
const baku = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Penelusuran untuk menu Traceability — Trace Part dan Trace Kanban.
 *
 * Hanya membaca. Sumbernya buku-buku yang sudah ditulis alur lain: riwayat
 * scan (TT_HISTORY_SCAN), kartu dan isinya (TM_KANBAN, TT_KANBAN_ITEM,
 * TT_KANBAN_EVENT), mutasi backflush, silsilah, dan outbox SAP. Tidak ada
 * tabel baru — layar ini menyatukan yang sudah ada.
 */
@Injectable()
export class TraceabilityService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ── Trace Part ─────────────────────────────────────────────────────────────

  /**
   * Masukan bisa QR unit (nomor seri) atau nomor/back number part.
   *
   * Seri diperiksa lebih dulu: QR unit 15 digit tidak pernah sama dengan
   * nomor part, tetapi back number pendek bisa kebetulan sama dengan seri
   * uji — dan yang dicari orang yang menempelkan QR adalah unitnya.
   */
  async part(qMentah: string): Promise<HasilTracePart> {
    const q = qMentah.trim();
    if (!q) return { jenis: 'KOSONG' };

    const unit = await this.unit(q);
    if (unit) return unit;

    const daftar = await this.cariPart(q);
    if (daftar.length === 0) return { jenis: 'TIDAK_DITEMUKAN', q };

    const ids = daftar.map((p) => p.id);
    const rows = await this.db
      .select({
        scanId: scanEvents.id,
        partId: scanEvents.partId,
        waktu: scanEvents.scannedAt,
        kind: scanEvents.kind,
        lineCode: lines.code,
        serial: scanEvents.serialNumber,
        qty: scanEvents.qty,
        npk: users.npk,
        meta: scanEvents.meta,
      })
      .from(scanEvents)
      .leftJoin(lines, eq(scanEvents.lineId, lines.id))
      .leftJoin(users, eq(scanEvents.userId, users.id))
      .where(inArray(scanEvents.partId, ids))
      .orderBy(desc(scanEvents.scannedAt), desc(scanEvents.id))
      .limit(BATAS + 1);

    return {
      jenis: 'PART',
      q,
      part: daftar,
      terpotong: rows.length > BATAS,
      scan: rows.slice(0, BATAS).map((r) => ({
        scanId: r.scanId,
        partId: r.partId,
        waktu: r.waktu.toISOString(),
        kind: r.kind,
        lineCode: r.lineCode,
        serial: r.serial,
        qty: r.qty,
        npk: r.npk,
        kanbanSerial: kanbanSerialDari(r.meta),
      })),
    };
  }

  private async unit(serial: string): Promise<HasilTracePart | null> {
    const langkahRows = await this.db
      .select({
        scanId: scanEvents.id,
        waktu: scanEvents.scannedAt,
        kind: scanEvents.kind,
        processType: scanEvents.processType,
        lineCode: lines.code,
        lineName: lines.name,
        partId: scanEvents.partId,
        rawCode: scanEvents.rawCode,
        qty: scanEvents.qty,
        npk: users.npk,
        userName: users.name,
        meta: scanEvents.meta,
      })
      .from(scanEvents)
      .leftJoin(lines, eq(scanEvents.lineId, lines.id))
      .leftJoin(users, eq(scanEvents.userId, users.id))
      .where(or(eq(scanEvents.serialNumber, serial), eq(scanEvents.rawCode, serial)))
      .orderBy(scanEvents.scannedAt, scanEvents.id)
      .limit(BATAS);

    const [itemRows, silsilahRows] = await Promise.all([
      this.db
        .select({
          kanbanId: kanbanItems.kanbanId,
          attachedAt: kanbanItems.attachedAt,
          scanId: kanbanItems.scanEventId,
          kanbanSerial: kanbans.serialNumber,
          partId: kanbans.partId,
        })
        .from(kanbanItems)
        .innerJoin(kanbans, eq(kanbanItems.kanbanId, kanbans.id))
        .where(eq(kanbanItems.serialNumber, serial)),
      this.db
        .select({
          partId: genealogy.componentPartId,
          serialKomponen: genealogy.componentSerial,
          qty: genealogy.qty,
          lotNumber: lots.lotNumber,
          waktu: genealogy.occurredAt,
        })
        .from(genealogy)
        .leftJoin(lots, eq(genealogy.componentLotId, lots.id))
        .where(and(eq(genealogy.parentSerial, serial), sql`${genealogy.supersededAt} IS NULL`))
        .orderBy(genealogy.occurredAt),
    ]);

    if (langkahRows.length === 0 && itemRows.length === 0 && silsilahRows.length === 0) {
      return null;
    }

    const scanIds = langkahRows.map((r) => r.scanId);
    const [sapRows, backflushRows] = scanIds.length
      ? await Promise.all([
          this.db
            .select({
              sourceId: sapOutbox.sourceId,
              docType: sapOutbox.docType,
              status: sapOutbox.status,
              movementType: sapOutbox.movementType,
              sapDocNumber: sapOutbox.sapDocNumber,
              stagingNumber: sapOutbox.stagingNumber,
              lastError: sapOutbox.lastError,
              sentAt: sapOutbox.sentAt,
              confirmedAt: sapOutbox.confirmedAt,
            })
            .from(sapOutbox)
            .where(
              and(
                eq(sapOutbox.sourceTable, 'TT_HISTORY_SCAN'),
                inArray(sapOutbox.sourceId, scanIds),
              ),
            ),
          this.db
            .select({
              scanId: mutations.sourceId,
              partId: mutations.partId,
              lineCode: lines.code,
              qty: mutations.qty,
              waktu: mutations.createdAt,
            })
            .from(mutations)
            .leftJoin(lines, eq(mutations.lineId, lines.id))
            .where(
              and(
                eq(mutations.sourceTable, 'TT_HISTORY_SCAN'),
                inArray(mutations.sourceId, scanIds),
                eq(mutations.type, 'CONSUMPTION_OUT'),
              ),
            )
            .orderBy(mutations.id),
        ])
      : [[], []];

    const partIds = new Set<number>();
    for (const r of langkahRows) if (r.partId) partIds.add(r.partId);
    for (const r of itemRows) partIds.add(r.partId);
    for (const r of silsilahRows) if (r.partId) partIds.add(r.partId);
    for (const r of backflushRows) partIds.add(r.partId);

    const qr = uraiQrUnit(serial);
    const fgId = qr ? await this.fgDariProgram(qr.program, langkahRows[0]?.partId ?? null) : null;
    if (fgId) partIds.add(fgId);
    const petaPart = await this.partPerId([...partIds]);

    const sapPerScan = new Map<number, TraceSap[]>();
    for (const s of sapRows) {
      const daftar = sapPerScan.get(s.sourceId) ?? [];
      daftar.push({
        docType: s.docType,
        status: s.status,
        movementType: s.movementType,
        sapDocNumber: s.sapDocNumber,
        stagingNumber: s.stagingNumber === null ? null : Number(s.stagingNumber),
        lastError: s.lastError,
        sentAt: iso(s.sentAt),
        confirmedAt: iso(s.confirmedAt),
      });
      sapPerScan.set(s.sourceId, daftar);
    }

    const lineScan = new Map(langkahRows.map((r) => [r.scanId, r.lineCode]));

    /*
     * Kartu dari dua sumber: yang MASIH menempel (TT_KANBAN_ITEM) dan yang
     * pernah — dicatat di meta scan saat box ditutup. Yang pertama menang bila
     * keduanya menunjuk kartu yang sama.
     */
    const kanban: Extract<HasilTracePart, { jenis: 'UNIT' }>['kanban'] = itemRows.map((r) => ({
      kanbanId: r.kanbanId,
      part: petaPart.get(r.partId) ?? null,
      serial: r.kanbanSerial,
      masihTerpasang: true,
      waktu: r.attachedAt.toISOString(),
      lineCode: r.scanId ? (lineScan.get(r.scanId) ?? null) : null,
    }));
    for (const r of langkahRows) {
      const seri = kanbanSerialDari(r.meta);
      if (!seri) continue;
      if (kanban.some((k) => k.serial === seri && k.part?.id === r.partId)) continue;
      kanban.push({
        kanbanId: null,
        part: r.partId ? (petaPart.get(r.partId) ?? null) : null,
        serial: seri,
        masihTerpasang: false,
        waktu: r.waktu.toISOString(),
        lineCode: r.lineCode,
      });
    }

    return {
      jenis: 'UNIT',
      q: serial,
      serial,
      qr: qr ? { ...qr, fg: fgId ? (petaPart.get(fgId) ?? null) : null } : null,
      langkah: langkahRows.map((r) => {
        const meta = (r.meta ?? {}) as Record<string, unknown>;
        return {
          scanId: r.scanId,
          waktu: r.waktu.toISOString(),
          kind: r.kind,
          processType: r.processType,
          lineCode: r.lineCode,
          lineName: r.lineName,
          part: r.partId ? (petaPart.get(r.partId) ?? null) : null,
          rawCode: r.rawCode,
          qty: r.qty,
          npk: r.npk,
          userName: r.userName,
          scanMode: typeof meta.scanMode === 'string' ? meta.scanMode : null,
          kanbanSerial: kanbanSerialDari(r.meta),
          sap: sapPerScan.get(r.scanId) ?? [],
        };
      }),
      kanban,
      komponen: gabungKomponen(backflushRows, silsilahRows, petaPart),
    };
  }

  /** FG yang ditunjuk program number, di pabrik scan pertama unit itu. */
  private async fgDariProgram(program: string, partIdPertama: number | null) {
    let plantId: number | null = null;
    if (partIdPertama) {
      const [p] = await this.db
        .select({ plantId: parts.plantId })
        .from(parts)
        .where(eq(parts.id, partIdPertama));
      plantId = p?.plantId ?? null;
    }
    const rows = await this.db
      .select({ partId: programNumbers.partId, plantId: programNumbers.plantId })
      .from(programNumbers)
      .where(eq(programNumbers.code, program));
    const cocok = rows.find((r) => r.plantId === plantId) ?? (rows.length === 1 ? rows[0] : null);
    return cocok?.partId ?? null;
  }

  // ── Trace Kanban ───────────────────────────────────────────────────────────

  /**
   * Masukan: isi QR kartu apa adanya, "BACK SERI" (CI11 0008, CI11-0008,
   * CI11|0008), atau back/nomor part saja untuk melihat semua kartunya.
   */
  async kanban(qMentah: string): Promise<HasilTraceKanban> {
    const q = qMentah.trim();
    if (!q) return { jenis: 'KOSONG' };

    if (kanbanAigsysRusak(q)) {
      return {
        jenis: 'TIDAK_DITEMUKAN',
        q,
        alasan:
          'Isi kanban berubah saat discan (ada titik di tempat spasi ganda). Matikan koreksi ' +
          'otomatis di perangkat ini lalu scan ulang.',
      };
    }

    const kunci = bacaKunciKanban(q);
    if (kunci) {
      const kartu = await this.kartuDari(kunci.backNumber, kunci.serial, kunci.partNumber);
      if (kartu.length > 0) {
        return { jenis: 'KARTU', q, kartu: await Promise.all(kartu.map((k) => this.detail(k))) };
      }
      return {
        jenis: 'TIDAK_DITEMUKAN',
        q,
        alasan: `Kartu ${kunci.backNumber ?? kunci.partNumber ?? ''} seri ${kunci.serial} tidak terdaftar.`,
      };
    }

    const daftarPart = await this.cariPart(q);
    if (daftarPart.length === 0) {
      return {
        jenis: 'TIDAK_DITEMUKAN',
        q,
        alasan: 'Bukan kartu kanban, back number, atau nomor part yang dikenal.',
      };
    }
    const kartu = await this.ringkasKartu(
      inArray(
        kanbans.partId,
        daftarPart.map((p) => p.id),
      ),
    );
    return { jenis: 'DAFTAR', q, part: daftarPart, kartu };
  }

  private async kartuDari(backNumber: string | null, serial: string, partNumber: string | null) {
    const seri = [serial, serial.padStart(4, '0')];
    const syaratPart = partNumber
      ? sql`REPLACE(REPLACE(UPPER(${parts.partNumber}), '-', ''), ' ', '') = ${baku(partNumber)}`
      : sql`UPPER(${parts.backNumber}) = ${(backNumber ?? '').toUpperCase()}`;
    return this.ringkasKartu(and(syaratPart, inArray(kanbans.serialNumber, seri))!);
  }

  private async ringkasKartu(syarat: ReturnType<typeof and>): Promise<TraceKanbanRingkas[]> {
    const rows = await this.db
      .select({
        id: kanbans.id,
        plantCode: plants.code,
        partId: kanbans.partId,
        serial: kanbans.serialNumber,
        kanbanType: kanbans.kanbanType,
        owner: kanbans.owner,
        status: kanbans.status,
        qtyPerBox: kanbans.qtyPerBox,
        cycleCount: kanbans.cycleCount,
        producedAt: kanbans.producedAt,
        deliveredAt: kanbans.deliveredAt,
        releasedAt: kanbans.releasedAt,
        isActive: kanbans.isActive,
        isiSekarang: sql<number>`(SELECT COUNT(*) FROM ${kanbanItems} WHERE ${kanbanItems.kanbanId} = ${kanbans.id})`,
      })
      .from(kanbans)
      .innerJoin(parts, eq(kanbans.partId, parts.id))
      .leftJoin(plants, eq(kanbans.plantId, plants.id))
      .where(syarat)
      .orderBy(parts.partNumber, kanbans.serialNumber)
      .limit(BATAS * 5);
    const petaPart = await this.partPerId([...new Set(rows.map((r) => r.partId))]);
    return rows.map((r) => ({
      id: r.id,
      plantCode: r.plantCode,
      part: petaPart.get(r.partId) ?? null,
      serial: r.serial,
      kanbanType: r.kanbanType,
      owner: r.owner,
      status: r.status,
      qtyPerBox: r.qtyPerBox,
      cycleCount: r.cycleCount ?? 0,
      isiSekarang: Number(r.isiSekarang),
      producedAt: iso(r.producedAt),
      deliveredAt: iso(r.deliveredAt),
      releasedAt: iso(r.releasedAt),
      isActive: r.isActive,
    }));
  }

  private async detail(k: TraceKanbanRingkas): Promise<TraceKanbanDetail> {
    const [isi, riwayat, event, kirim] = await Promise.all([
      this.db
        .select({
          serial: kanbanItems.serialNumber,
          attachedAt: kanbanItems.attachedAt,
          scanId: kanbanItems.scanEventId,
          lineCode: lines.code,
        })
        .from(kanbanItems)
        .leftJoin(scanEvents, eq(kanbanItems.scanEventId, scanEvents.id))
        .leftJoin(lines, eq(scanEvents.lineId, lines.id))
        .where(eq(kanbanItems.kanbanId, k.id))
        .orderBy(kanbanItems.attachedAt),
      /*
       * Riwayat isi dari meta scan, bukan dari TT_KANBAN_ITEM: barisnya
       * dihapus saat box dilepas, sedangkan meta scan menyimpan seri kartu
       * yang menutup box itu selamanya.
       */
      k.part
        ? this.db
            .select({
              scanId: scanEvents.id,
              waktu: scanEvents.scannedAt,
              serial: scanEvents.serialNumber,
              lineCode: lines.code,
              qty: scanEvents.qty,
              npk: users.npk,
            })
            .from(scanEvents)
            .leftJoin(lines, eq(scanEvents.lineId, lines.id))
            .leftJoin(users, eq(scanEvents.userId, users.id))
            .where(
              and(
                eq(scanEvents.partId, k.part.id),
                sql`${scanEvents.meta}->>'kanbanSerial' = ${k.serial}`,
              ),
            )
            .orderBy(desc(scanEvents.scannedAt))
            .limit(BATAS)
        : Promise.resolve([]),
      this.db
        .select({
          type: kanbanEvents.type,
          waktu: kanbanEvents.occurredAt,
          lineCode: lines.code,
          qty: kanbanEvents.qty,
          pasanganId: kanbanEvents.pairedKanbanId,
          npk: users.npk,
        })
        .from(kanbanEvents)
        .leftJoin(lines, eq(kanbanEvents.lineId, lines.id))
        .leftJoin(users, eq(kanbanEvents.userId, users.id))
        .where(eq(kanbanEvents.kanbanId, k.id))
        .orderBy(desc(kanbanEvents.occurredAt))
        .limit(BATAS),
      this.db
        .select({
          deliveryId: deliveries.id,
          documentNumber: deliveries.documentNumber,
          qty: deliveryKanbans.qty,
          releasedAt: deliveryKanbans.releasedAt,
        })
        .from(deliveryKanbans)
        .innerJoin(deliveries, eq(deliveryKanbans.deliveryId, deliveries.id))
        .where(eq(deliveryKanbans.kanbanId, k.id))
        .orderBy(desc(deliveryKanbans.createdAt))
        .limit(BATAS),
    ]);

    const pasanganIds = [
      ...new Set(event.map((e) => e.pasanganId).filter((x): x is number => !!x)),
    ];
    const pasangan = new Map<number, string>();
    if (pasanganIds.length) {
      const rows = await this.db
        .select({
          id: kanbans.id,
          serial: kanbans.serialNumber,
          backNumber: parts.backNumber,
          partNumber: parts.partNumber,
        })
        .from(kanbans)
        .innerJoin(parts, eq(kanbans.partId, parts.id))
        .where(inArray(kanbans.id, pasanganIds));
      for (const r of rows) pasangan.set(r.id, `${r.backNumber ?? r.partNumber} ${r.serial}`);
    }

    return {
      ...k,
      isi: isi.map((r) => ({
        serial: r.serial,
        attachedAt: r.attachedAt.toISOString(),
        scanId: r.scanId,
        lineCode: r.lineCode,
      })),
      riwayatScan: riwayat.map((r) => ({
        scanId: r.scanId,
        waktu: r.waktu.toISOString(),
        serial: r.serial,
        lineCode: r.lineCode,
        qty: r.qty,
        npk: r.npk,
      })),
      event: event.map((e) => ({
        type: e.type,
        waktu: e.waktu.toISOString(),
        lineCode: e.lineCode,
        qty: e.qty,
        pasangan: e.pasanganId ? (pasangan.get(e.pasanganId) ?? null) : null,
        npk: e.npk,
      })),
      delivery: kirim.map((d) => ({
        deliveryId: d.deliveryId,
        documentNumber: d.documentNumber,
        qty: d.qty,
        releasedAt: iso(d.releasedAt),
      })),
    };
  }

  // ── Bersama ────────────────────────────────────────────────────────────────

  /** Part yang cocok dengan nomor part (bergaris atau tidak) atau back number. */
  private async cariPart(q: string): Promise<TracePartRingkas[]> {
    const rows = await this.db
      .select({ id: parts.id })
      .from(parts)
      .where(
        or(
          sql`REPLACE(REPLACE(UPPER(${parts.partNumber}), '-', ''), ' ', '') = ${baku(q)}`,
          sql`UPPER(${parts.backNumber}) = ${q.toUpperCase()}`,
        ),
      )
      .limit(20);
    const peta = await this.partPerId(rows.map((r) => r.id));
    return [...peta.values()];
  }

  private async partPerId(ids: number[]): Promise<Map<number, TracePartRingkas>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: parts.id,
        partNumber: parts.partNumber,
        backNumber: parts.backNumber,
        name: parts.name,
        plantCode: plants.code,
        partType: parts.partType,
        trackingMode: parts.trackingMode,
      })
      .from(parts)
      .leftJoin(plants, eq(parts.plantId, plants.id))
      .where(inArray(parts.id, ids));
    return new Map(rows.map((r) => [r.id, r]));
  }
}

/**
 * Backflush dan silsilah digabung jadi satu daftar.
 *
 * Backflush ikut menulis silsilah untuk komponen yang sama, jadi menampilkan
 * keduanya membuat setiap komponen muncul dua kali. Baris silsilah yang cocok
 * dengan baris backflush (part sama) hanya menyumbang seri/lot komponennya;
 * yang tidak punya pasangan — mis. dari scan komponen — tampil sendiri.
 */
function gabungKomponen(
  backflush: {
    scanId: number | null;
    partId: number;
    lineCode: string | null;
    qty: string;
    waktu: Date;
  }[],
  silsilah: {
    partId: number | null;
    serialKomponen: string | null;
    qty: string | null;
    lotNumber: string | null;
    waktu: Date;
  }[],
  petaPart: Map<number, TracePartRingkas>,
): TraceKomponen[] {
  const hasil: TraceKomponen[] = backflush.map((r) => ({
    sumber: 'BACKFLUSH',
    scanId: r.scanId,
    lineCode: r.lineCode,
    part: petaPart.get(r.partId) ?? null,
    qty: Math.abs(Number(r.qty)),
    serialKomponen: null,
    lotNumber: null,
    waktu: r.waktu.toISOString(),
  }));
  const terpakai = new Set<number>();
  for (const r of silsilah) {
    const i = hasil.findIndex(
      (h, idx) => h.sumber === 'BACKFLUSH' && !terpakai.has(idx) && h.part?.id === r.partId,
    );
    if (i >= 0) {
      terpakai.add(i);
      hasil[i] = { ...hasil[i]!, serialKomponen: r.serialKomponen, lotNumber: r.lotNumber };
      continue;
    }
    hasil.push({
      sumber: 'SILSILAH',
      scanId: null,
      lineCode: null,
      part: r.partId ? (petaPart.get(r.partId) ?? null) : null,
      qty: Number(r.qty ?? 1),
      serialKomponen: r.serialKomponen,
      lotNumber: r.lotNumber,
      waktu: r.waktu.toISOString(),
    });
  }
  return hasil;
}

function kanbanSerialDari(meta: unknown): string | null {
  const m = (meta ?? {}) as Record<string, unknown>;
  return typeof m.kanbanSerial === 'string' && m.kanbanSerial ? m.kanbanSerial : null;
}

/**
 * Back number + seri dari masukan Trace Kanban.
 *
 * Isi QR kartu dibaca dengan pembaca kanban yang sama dengan stasiun scan,
 * dicoba dengan beberapa metode scan karena tiap metode mengaktifkan aturan
 * yang berbeda. Bila bukan isi QR, bentuk ketik "BACK SERI" dicoba.
 */
function bacaKunciKanban(
  q: string,
): { backNumber: string | null; partNumber: string | null; serial: string } | null {
  const ketik = /^([A-Za-z0-9]{2,8})\s*[\s\-|/]\s*(\d{1,6})$/.exec(q);
  if (ketik) return { backNumber: ketik[1]!.toUpperCase(), partNumber: null, serial: ketik[2]! };

  for (const scanMode of [undefined, 'PART_KANBAN', 'KANBAN_BOX', 'PER_KANBAN'] as const) {
    try {
      const k = bacaKanban(q, scanMode ? { scanMode } : {});
      if (k.serialNumber && (k.backNumber || k.partNumber)) {
        return {
          backNumber: k.backNumber ?? null,
          partNumber: k.backNumber ? null : (k.partNumber ?? null),
          serial: k.serialNumber,
        };
      }
    } catch {
      // aturan berikutnya
    }
  }
  return null;
}
