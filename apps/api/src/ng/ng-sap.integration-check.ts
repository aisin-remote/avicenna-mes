/**
 * Uji integrasi NG → SLOC reject dan outbox SAP (Handika, 19 Nov 2026).
 *
 * Berjalan di database sungguhan DI DALAM satu transaksi yang selalu
 * di-ROLLBACK: baris outbox yang terbentuk tidak pernah terlihat oleh API yang
 * sedang jalan, jadi tidak ada yang terdorong ke staging SAP.
 *
 *   pnpm --filter @avicenna/api test:ng
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {
  and,
  closeDb,
  eq,
  getDb,
  lines,
  locations,
  mutations,
  ngMasters,
  ngRecords,
  ngRevisions,
  parts,
  plants,
  sapOutbox,
  scanEvents,
  type Database,
} from '@avicenna/db';
import { NgService } from './ng.service';
import { ProcessTypeService } from '../master/process-type.service';

class Rollback extends Error {}

async function inventoryLocationsOf(tx: unknown, plantId: number, kind: 'NG'): Promise<number | null> {
  const [row] = await (tx as Database)
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.plantId, plantId), eq(locations.kind, kind)))
    .orderBy(locations.code)
    .limit(1);
  return row ? Number(row.id) : null;
}

async function main() {
  const db = getDb();
  const [unit] = await db.select().from(plants).where(eq(plants.code, 'UNIT')).limit(1);
  assert(unit, 'Butuh pabrik UNIT');

  let lolos = 0;
  const catat = (nama: string) => {
    lolos += 1;
    console.log(`  ✓ ${nama}`);
  };

  try {
    await db.transaction(async (tx) => {
      const sebagaiDb = tx as unknown as Database;
      const ng = new NgService(sebagaiDb, undefined as never, new ProcessTypeService(sebagaiDb));
      const catatNg = (ng as unknown as { catat: (k: unknown) => Promise<{ status: string }> }).catat.bind(ng);
      const batal = ng.batal.bind(ng);

      const re = await inventoryLocationsOf(tx, unit.id, 'NG');
      assert(re, 'Butuh SLOC reject UNIT (RE80)');
      const [as3] = await tx.select().from(lines).where(eq(lines.code, 'AS0003')).limit(1);
      assert(as3?.sapWorkCenter, 'Butuh line AS0003 dengan work center SAP');
      const [ci12] = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.plantId, unit.id), eq(parts.backNumber, 'CI12')))
        .limit(1);
      assert(ci12, 'Butuh part CI12');
      const [jenis] = await tx.select().from(ngMasters).where(eq(ngMasters.plantId, unit.id)).limit(1);
      assert(jenis, 'Butuh satu jenis NG UNIT');
      const jenisNg = { id: jenis.id, code: jenis.code, name: jenis.name };

      const mutasiNg = (id: number) =>
        tx
          .select({ loc: mutations.locationId, qty: mutations.qty })
          .from(mutations)
          .where(and(eq(mutations.sourceTable, 'TT_NG'), eq(mutations.sourceId, id)));
      const ngTerakhir = async () =>
        (await tx.select().from(ngRecords).orderBy(ngRecords.id)).at(-1)!;

      /* ── Kasus A: NG tanpa scan produksi ─────────────────────────────────── */
      const seriA = `UJI-NG-A-${Date.now()}`;
      const dasar = {
        plantId: unit.id,
        part: ci12,
        lineId: as3.id,
        processType: as3.processType,
        jenisNg,
        origin: 'INLINE',
        source: 'PART_CODE',
        qtyPerUnit: 1,
        waktu: new Date(),
        rawCode: seriA,
      };
      await catatNg({
        ...dasar,
        sasaran: [{ rawCode: seriA, serialNumber: seriA, scanEventId: null, scanLineId: null, processType: as3.processType }],
      });
      const a = await ngTerakhir();
      const [obA] = await tx
        .select()
        .from(sapOutbox)
        .where(and(eq(sapOutbox.sourceTable, 'TT_NG'), eq(sapOutbox.sourceId, a.id)));
      assert(obA, 'kasus A membuat dokumen outbox');
      assert.equal(obA.docType, 'PRODUCTION');
      assert.equal(obA.status, 'PENDING');
      const pa = obA.payload as { ngQty: number; lineCode: string; productionVersion: string | null };
      assert.equal(pa.ngQty, 1);
      assert.equal(pa.lineCode, as3.sapWorkCenter);
      assert.ok(pa.productionVersion, 'PV dari rute CI12 di AS0003');
      catat('kasus A: dokumen PRODUCTION bersumber TT_NG, OK 0 / NG 1, WC + PV dari rute');

      const mA = await mutasiNg(a.id);
      assert.deepEqual(
        mA.map((m) => [Number(m.loc), Number(m.qty)]),
        [[re, 1]],
      );
      catat('kasus A: barang hanya MASUK RE80 (+1), tidak ada yang dikurangi');

      // Jenis NG kedua pada barang yang sama: tidak dikirim/dicatat ulang.
      const [jenis2] = await tx
        .select()
        .from(ngMasters)
        .where(and(eq(ngMasters.plantId, unit.id)))
        .offset(1)
        .limit(1);
      if (jenis2) {
        await catatNg({
          ...dasar,
          jenisNg: { id: jenis2.id, code: jenis2.code, name: jenis2.name },
          sasaran: [{ rawCode: seriA, serialNumber: seriA, scanEventId: null, scanLineId: null, processType: as3.processType }],
        });
        const a2 = await ngTerakhir();
        const ob2 = await tx
          .select()
          .from(sapOutbox)
          .where(and(eq(sapOutbox.sourceTable, 'TT_NG'), eq(sapOutbox.sourceId, a2.id)));
        assert.equal(ob2.length, 0);
        assert.equal((await mutasiNg(a2.id)).length, 0);
        catat('jenis NG kedua pada barang yang sama: tidak ke SAP, tidak masuk RE lagi');
      }

      /* ── Kasus B/C: NG yang membalik scan produksi ───────────────────────── */
      const [scan] = await tx
        .select()
        .from(scanEvents)
        .where(and(eq(scanEvents.kind, 'PRODUCTION'), eq(scanEvents.partId, ci12.id)))
        .limit(1);
      const [scanLain] = scan
        ? [scan]
        : await tx.select().from(scanEvents).where(eq(scanEvents.kind, 'PRODUCTION')).limit(1);
      assert(scanLain, 'Butuh satu scan produksi');
      const [partScan] = await tx.select().from(parts).where(eq(parts.id, scanLain.partId!)).limit(1);
      const seriB = scanLain.serialNumber ?? `UJI-NG-B-${Date.now()}`;
      await catatNg({
        ...dasar,
        plantId: partScan!.plantId,
        part: partScan,
        lineId: scanLain.lineId,
        rawCode: seriB,
        sasaran: [
          {
            rawCode: seriB,
            serialNumber: seriB,
            scanEventId: scanLain.id,
            scanLineId: scanLain.lineId,
            processType: scanLain.processType,
          },
        ],
      });
      const b = await ngTerakhir();
      assert.equal(Number(b.scanEventId), Number(scanLain.id));
      const mB = await mutasiNg(b.id);
      const reB = await inventoryLocationsOf(tx, partScan!.plantId, 'NG');
      assert.equal(mB.length, 2);
      assert.equal(mB.reduce((t, m) => t + Number(m.qty), 0), 0, 'keluar dan masuk sama besar');
      assert.ok(mB.some((m) => Number(m.loc) === reB && Number(m.qty) === 1), 'masuk SLOC reject');
      assert.ok(mB.some((m) => Number(m.qty) === -1 && Number(m.loc) !== reB), 'keluar dari SLOC hasil');
      const obB = await tx
        .select()
        .from(sapOutbox)
        .where(and(eq(sapOutbox.sourceTable, 'TT_NG'), eq(sapOutbox.sourceId, b.id)));
      assert.equal(obB.length, 0, 'NG yang membalik scan ikut baris produksinya, bukan dokumen sendiri');
      catat('kasus B/C: pindah dari SLOC hasil ke RE (−1/+1), tanpa dokumen outbox sendiri');

      /* ── Koreksi qty: stok diskalakan, jejak tercatat ────────────────────── */
      const terapkan = (ng as unknown as {
        terapkanKoreksi: (row: unknown, input: unknown, p?: unknown) => Promise<void>;
      }).terapkanKoreksi.bind(ng);
      const saldoNg = async (id: number) => {
        const peta = new Map<number, number>();
        for (const m of await mutasiNg(id)) peta.set(Number(m.loc), (peta.get(Number(m.loc)) ?? 0) + Number(m.qty));
        return peta;
      };
      const [barisB] = await tx.select().from(ngRecords).where(eq(ngRecords.id, b.id));
      await terapkan(barisB, { qty: 3, alasan: 'uji salah hitung' });
      const sB = await saldoNg(b.id);
      assert.equal(sB.get(reB!), 3, 'RE ikut jadi 3');
      assert.ok([...sB.entries()].some(([loc, q]) => loc !== reB && q === -3), 'SLOC hasil ikut −3');
      const [revB] = await tx.select().from(ngRevisions).where(eq(ngRevisions.ngId, b.id));
      assert.equal(revB?.qtyLama, 1);
      assert.equal(revB?.qtyBaru, 3);
      assert.equal(revB?.sapStatus, 'TIDAK_PERLU', 'NG ini belum dibawa dokumen mana pun ke SAP');
      catat('koreksi qty 1 → 3: SLOC hasil −3 / RE +3, revisi tercatat');

      /* ── Koreksi NG yang sudah diterima SAP → MENUNGGU revisi ───────────── */
      await tx.update(sapOutbox).set({ status: 'CONFIRMED', stagingNumber: 999999 }).where(eq(sapOutbox.id, obA.id));
      const [barisA] = await tx.select().from(ngRecords).where(eq(ngRecords.id, a.id));
      await terapkan(barisA, { qty: 2, alasan: 'uji qty NG kurang' });
      const [revA] = await tx.select().from(ngRevisions).where(eq(ngRevisions.ngId, a.id));
      assert.equal(revA?.sapStatus, 'MENUNGGU');
      assert.equal(Number(revA?.outboxId), Number(obA.id));
      catat('koreksi NG yang sudah diterima SAP: revisi MENUNGGU dikirim sebagai status R');

      /* ── Pembatalan (= koreksi ke 0) ─────────────────────────────────────── */
      await batal({ id: b.id, reason: 'uji' } as never);
      const sBatal = await saldoNg(b.id);
      assert.ok([...sBatal.values()].every((v) => v === 0), 'setiap SLOC kembali ke saldo semula');
      const jenisMutasi = await tx
        .selectDistinct({ type: mutations.type })
        .from(mutations)
        .where(and(eq(mutations.sourceTable, 'TT_NG'), eq(mutations.sourceId, b.id)));
      assert.deepEqual(jenisMutasi.map((j) => j.type), ['NG_OUT'], 'tidak memakai ADJUSTMENT (309 ke SAP)');
      const [batalB] = await tx.select().from(ngRecords).where(eq(ngRecords.id, b.id));
      assert.ok(batalB?.cancelledAt, 'catatan NG bertanda batal');
      assert.equal((await tx.select().from(ngRevisions).where(eq(ngRevisions.ngId, b.id))).length, 2);
      catat('pembatalan membalik keluar & masuk RE, NG_OUT saja, tercatat sebagai revisi');

      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  } finally {
    await closeDb();
  }
  console.log(`ng-sap.integration-check: ${lolos} pemeriksaan lolos (ROLLBACK)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
