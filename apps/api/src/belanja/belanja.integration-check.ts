import 'reflect-metadata';
import assert from 'node:assert/strict';
import {
  and,
  partPairings,
  closeDb,
  eq,
  getDb,
  inArray,
  kanbanEvents,
  kanbanPairings,
  kanbans,
  parts,
  plants,
  partProcesses,
  type Database,
} from '@avicenna/db';
import { susunKodeKartuKanban } from '@avicenna/domain';
import { BelanjaService } from './belanja.service';
import { ProcessTypeService } from '../master/process-type.service';

/**
 * Pemeriksaan alur belanja dari ujung ke ujung, memakai service yang SAMA
 * dengan yang dipakai produksi.
 *
 * ── Semuanya dibatalkan di akhir ────────────────────────────────────────────
 *
 * Seluruh pemeriksaan berjalan di dalam satu transaksi yang selalu di-ROLLBACK,
 * termasuk saat lolos. Fixture yang tertinggal di database pengembangan akan
 * muncul di layar orang lain sebagai part dan kartu yang tidak pernah ada
 * bendanya — dan yang menemukannya tidak punya cara tahu itu bekas uji.
 *
 * Konsekuensinya: nomor urut (sequence) tetap maju meski barisnya hilang. Itu
 * memang bagaimana Postgres bekerja dan tidak merusak apa pun.
 *
 * Service dirakit DENGAN TANGAN, bukan lewat DI Nest — tsx memakai esbuild yang
 * tidak memancarkan emitDecoratorMetadata. Alasannya sama dengan
 * staging.integration-check.ts.
 */
async function main() {
  const db = getDb();

  const [pabrik] = await db.select().from(plants).where(eq(plants.code, 'BODY')).limit(1);
  assert(pabrik, 'Butuh pabrik BODY');

  let lolos = 0;
  const catat = (nama: string) => {
    lolos += 1;
    console.log(`  ✓ ${nama}`);
  };

  try {
    await db.transaction(async (tx) => {
      const sebagaiDb = tx as unknown as Database;
      const belanja = new BelanjaService(sebagaiDb, new ProcessTypeService(sebagaiDb));

      /* ── Fixture ───────────────────────────────────────────────────────── */
      const [partFg] = await tx
        .insert(parts)
        .values({
          plantId: pabrik.id,
          partNumber: 'UJI-ASSY-660A',
          backNumber: 'ZA01',
          name: 'Uji assembly 660A',
          processType: 'ASSEMBLING_BODY_FG',
          partType: 'FINISHED_GOOD',
          sourceType: 'MANUFACTURED',
          qtyPerKanban: 8,
        })
        .returning({ id: parts.id });

      const [partWip] = await tx
        .insert(parts)
        .values({
          plantId: pabrik.id,
          partNumber: 'UJI-PAINT-660A',
          backNumber: 'ZP01',
          name: 'Uji painting 660A',
          processType: 'PAINTING_FG',
          partType: 'WIP',
          sourceType: 'MANUFACTURED',
          qtyPerKanban: 16,
        })
        .returning({ id: parts.id });

      // Komponen beli: ikut di Part Pairing, TIDAK boleh ikut diperiksa saat belanja.
      const [partBeli] = await tx
        .insert(parts)
        .values({
          plantId: pabrik.id,
          partNumber: 'UJI-BAUT-660A',
          backNumber: 'ZB01',
          name: 'Uji baut 660A',
          processType: 'ASSEMBLING_BODY_FG',
          partType: 'COMPONENT',
          sourceType: 'PURCHASED',
          qtyPerKanban: 1000,
        })
        .returning({ id: parts.id });

      const kemarin = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await tx.insert(partPairings).values([
        {
          plantId: pabrik.id,
          parentPartId: partFg!.id,
          componentPartId: partWip!.id,
          qtyPer: '1',
          effectiveFrom: kemarin,
        },
        {
          plantId: pabrik.id,
          parentPartId: partFg!.id,
          componentPartId: partBeli!.id,
          qtyPer: '4',
          effectiveFrom: kemarin,
        },
      ]);

      // Enam kartu induk isi 8 (9006 cadangan untuk sesi kedua).
      await tx.insert(kanbans).values(
        ['9001', '9002', '9003', '9004', '9005', '9006'].map((seri) => ({
          plantId: pabrik.id,
          partId: partFg!.id,
          serialNumber: seri,
          qtyPerBox: 8,
          status: 'AVAILABLE' as const,
        })),
      );

      const penuhPada = new Date('2026-11-01T01:00:00.000Z');
      const kartuWip = await tx
        .insert(kanbans)
        .values(
          ['9101', '9102', '9103', '9104'].map((seri) => ({
            plantId: pabrik.id,
            partId: partWip!.id,
            serialNumber: seri,
            qtyPerBox: 16,
            status: 'PRODUCED' as const,
            producedAt: penuhPada,
            cycleCount: 7,
          })),
        )
        .returning({ id: kanbans.id, serialNumber: kanbans.serialNumber });

      await tx.insert(partProcesses).values({
        plantId: pabrik.id,
        partId: partFg!.id,
        processType: 'ASSEMBLING_BODY_FG',
        seqNo: 10,
        requirePairing: true,
      });

      /* ── 1. Membuka sesi dengan kartu induk ────────────────────────────── */
      const buka = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZA01|9001',
        indukKanbanIds: [],
        wipKanbanIds: [],
      });
      assert.equal(buka.hasil, 'DITERIMA', buka.pesan);
      assert.equal(buka.sisi, 'INDUK');
      assert.equal(buka.sesi?.unitInduk, 8);
      catat('kartu induk membuka sesi, isi box terbaca 8 unit');

      // Part beli tidak ikut: ia datang lewat kartu ARES, bukan dari rak.
      assert.equal(buka.sesi?.komponen.length, 1);
      assert.equal(buka.sesi?.komponen[0]?.partNumber, 'UJI-PAINT-660A');
      catat('hanya komponen buatan sendiri yang diminta; part beli dilewati');

      const fgId = buka.sesi!.induk[0]!.kanbanId;

      // Isi QR kartu cetakan sendiri harus membuka kartu yang sama dengan ketik manual.
      const lewatQr = await belanja.scan({
        plantCode: 'BODY',
        rawCode: susunKodeKartuKanban({
          partNumber: 'UJI-ASSY-660A',
          backNumber: 'ZA01',
          serialNumber: '9001',
          qtyPerBox: 8,
        }),
        indukKanbanIds: [],
        wipKanbanIds: [],
      });
      assert.equal(lewatQr.hasil, 'DITERIMA', lewatQr.pesan);
      assert.equal(lewatQr.sesi?.induk[0]?.kanbanId, fgId, 'QR dan ketik manual menuju kartu yang sama');
      catat('isi QR kartu cetakan sendiri terbaca di stasiun belanja');

      /* ── 2. Kartu induk tambahan: 5 × 8 = 40 unit ──────────────────────── */
      let indukIds = [fgId];
      for (const seri of ['9002', '9003', '9004', '9005']) {
        const r = await belanja.scan({
          plantCode: 'BODY',
          rawCode: `ZA01|${seri}`,
          indukKanbanIds: indukIds,
          wipKanbanIds: [],
        });
        assert.equal(r.hasil, 'DITERIMA', r.pesan);
        assert.equal(r.sisi, 'INDUK');
        indukIds = r.sesi!.induk.map((k) => k.kanbanId);
      }
      const limaInduk = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZA01|9005',
        indukKanbanIds: indukIds,
        wipKanbanIds: [],
      });
      assert.match(limaInduk.pesan, /sudah ditembak/);
      assert.equal(limaInduk.sesi?.unitInduk, 40);
      assert.equal(limaInduk.sesi?.komponen[0]?.dibutuhkan, 40);
      catat('lima kartu induk isi 8: kebutuhan 40 unit, induk kembar ditolak');

      /* ── 3. Kartu turunan isi 16: cukup 3 kartu ────────────────────────── */
      const satu = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9101',
        indukKanbanIds: indukIds,
        wipKanbanIds: [],
      });
      assert.equal(satu.hasil, 'DITERIMA', satu.pesan);
      assert.equal(satu.sisi, 'TURUNAN');
      assert.equal(satu.sesi?.komponen[0]?.kartuDibutuhkan, 3);
      assert.equal(satu.sesi?.bolehDisimpan, false);
      catat('turunan isi 16 untuk 40 unit: butuh 3 kartu, belum boleh disimpan');

      const tambahInduk = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZA01|9006',
        indukKanbanIds: indukIds,
        wipKanbanIds: [kartuWip[0]!.id],
      });
      assert.equal(tambahInduk.hasil, 'DITOLAK');
      assert.match(tambahInduk.pesan, /tidak bisa ditambah/);
      catat('induk tidak bisa ditambah setelah turunan mulai discan');

      const dua = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9102',
        indukKanbanIds: indukIds,
        wipKanbanIds: [kartuWip[0]!.id],
      });
      const tiga = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9103',
        indukKanbanIds: indukIds,
        wipKanbanIds: [kartuWip[0]!.id, kartuWip[1]!.id],
      });
      assert.equal(dua.sesi?.bolehDisimpan, false);
      assert.equal(tiga.sesi?.komponen[0]?.dibawa, 48);
      assert.equal(tiga.sesi?.bolehDisimpan, true, tiga.sesi?.galat.join(' '));
      catat('tiga kartu isi 16 = 48 untuk 40: cukup, sisa 8 tidak menghalangi');

      const empat = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9104',
        indukKanbanIds: indukIds,
        wipKanbanIds: kartuWip.slice(0, 3).map((k) => k.id),
      });
      assert.equal(empat.hasil, 'DITOLAK');
      assert.match(empat.pesan, /sudah cukup/);
      catat('kartu turunan keempat ditolak: kebutuhan sudah terpenuhi');

      const ulang = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9101',
        indukKanbanIds: indukIds,
        wipKanbanIds: [kartuWip[0]!.id],
      });
      assert.equal(ulang.hasil, 'DITOLAK');
      assert.match(ulang.pesan, /sudah ditembak/);
      catat('kartu yang sama ditembak dua kali ditolak');

      /* ── 4. Menyimpan ──────────────────────────────────────────────────── */
      const gagal = await belanja.simpan({
        plantCode: 'BODY',
        indukKanbanIds: indukIds,
        wipKanbanIds: kartuWip.map((k) => k.id),
      });
      assert.equal(gagal.hasil, 'DITOLAK', 'box yang tidak dibutuhkan tidak boleh ikut tersimpan');
      catat('simpan dengan box berlebih ditolak di server, bukan hanya di layar');

      const tigaWip = kartuWip.slice(0, 3).map((k) => k.id);
      const simpan = await belanja.simpan({
        plantCode: 'BODY',
        indukKanbanIds: indukIds,
        wipKanbanIds: tigaWip,
      });
      assert.equal(simpan.hasil, 'DITERIMA', simpan.pesan);

      const sesudah = await tx
        .select({
          id: kanbans.id,
          status: kanbans.status,
          cycleCount: kanbans.cycleCount,
          producedAt: kanbans.producedAt,
        })
        .from(kanbans)
        .where(inArray(kanbans.id, [...indukIds, ...kartuWip.map((k) => k.id)]));
      assert.ok(indukIds.every((id) => sesudah.find((k) => k.id === id)?.status === 'SHOPPED'));
      catat('kelima kartu induk menunggu produksi: SHOPPED');

      const box1 = sesudah.find((k) => k.id === kartuWip[0]!.id)!;
      assert.equal(box1.status, 'AVAILABLE', 'kartu box lepas pada saat belanja');
      assert.equal(box1.producedAt, null);
      assert.equal(box1.cycleCount, 8, 'putaran kartu box bertambah satu');
      assert.equal(sesudah.find((k) => k.id === kartuWip[3]!.id)?.status, 'PRODUCED');
      catat('kartu turunan lepas ke AVAILABLE; box yang tidak ikut tetap PRODUCED');

      const pasangan = await tx
        .select()
        .from(kanbanPairings)
        .where(inArray(kanbanPairings.fgKanbanId, indukIds));
      const susunan = indukIds.map((id) =>
        pasangan.filter((p) => p.fgKanbanId === id).map((p) => [p.wipKanbanId, p.qty]),
      );
      assert.deepEqual(susunan, [
        [[kartuWip[0]!.id, 8]],
        [[kartuWip[0]!.id, 8]],
        [[kartuWip[1]!.id, 8]],
        [[kartuWip[1]!.id, 8]],
        [[kartuWip[2]!.id, 8]],
      ]);
      assert.deepEqual(pasangan[0]?.wipProducedAt, penuhPada);
      catat('satu box isi 16 terbagi ke dua induk isi 8, dicatat per pasangan');

      const eventBox = await tx
        .select()
        .from(kanbanEvents)
        .where(eq(kanbanEvents.kanbanId, kartuWip[0]!.id));
      assert.equal(eventBox.filter((e) => e.type === 'SHOPPED').length, 2);
      assert.equal(eventBox.filter((e) => e.type === 'RELEASED').length, 1);
      catat('riwayat box: SHOPPED ke dua induk, satu RELEASED');

      /* ── 5. Interlock ke HULU ──────────────────────────────────────────── */
      const [kartuEnam] = await tx
        .select({ id: kanbans.id })
        .from(kanbans)
        .where(and(eq(kanbans.partId, partFg!.id), eq(kanbans.serialNumber, '9006')));
      const belumTerisi = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9101',
        indukKanbanIds: [kartuEnam!.id],
        wipKanbanIds: [],
      });
      assert.equal(belumTerisi.hasil, 'DITOLAK');
      assert.match(belumTerisi.pesan, /belum berisi barang/);
      catat('kartu box yang sudah lepas tidak bisa dibelanjakan lagi sebelum terisi');

      assert.equal(await belanja.menungguBelanjaHilir(pabrik.id, partWip!.id), true);
      assert.equal(await belanja.menungguBelanjaHilir(pabrik.id, partFg!.id), false);
      catat('stasiun scan bisa membedakan "box belum diambil hilir" dari "kartu sudah dipakai"');

      const sudahBelanjaLagi = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZA01|9001',
        indukKanbanIds: [],
        wipKanbanIds: [],
      });
      assert.equal(sudahBelanjaLagi.hasil, 'DITOLAK');
      assert.match(sudahBelanjaLagi.pesan, /sudah belanja/);
      catat('kartu induk yang sudah belanja tidak bisa membuka sesi kedua');

      /* ── 6. Daftar tunggu ──────────────────────────────────────────────── */
      const stasiun = await belanja.stasiun('BODY');
      assert.ok(stasiun.prosesWajib.includes('ASSEMBLING_BODY_FG'));
      const menunggu = stasiun.menunggu.find((m) => m.fgKanbanId === fgId);
      assert.ok(menunggu, 'kartu yang sudah belanja harus muncul di daftar tunggu');
      assert.equal(menunggu.unit, 8);
      catat('daftar tunggu menampilkan tiap induk dengan bagiannya: 8 unit');

      /* ── 7. Membatalkan satu induk = membatalkan seluruh belanjanya ────── */
      const batal = await belanja.batal({ plantCode: 'BODY', fgKanbanId: indukIds[2]! });
      assert.equal(batal.hasil, 'DITERIMA', batal.pesan);
      assert.deepEqual([...batal.indukDibatalkan].sort(), [...indukIds].sort());
      const setelahBatal = await tx
        .select({
          id: kanbans.id,
          status: kanbans.status,
          cycleCount: kanbans.cycleCount,
          producedAt: kanbans.producedAt,
        })
        .from(kanbans)
        .where(inArray(kanbans.id, [...indukIds, ...tigaWip]));
      assert.ok(indukIds.every((id) => setelahBatal.find((k) => k.id === id)?.status === 'AVAILABLE'));
      const dipulihkan = setelahBatal.find((k) => k.id === kartuWip[0]!.id)!;
      assert.equal(dipulihkan.status, 'PRODUCED', 'kartu dipasang kembali ke box-nya');
      assert.deepEqual(dipulihkan.producedAt, penuhPada);
      assert.equal(dipulihkan.cycleCount, 7, 'putaran dikurangi: pergi-dan-kembali tidak terjadi');
      assert.equal(
        (await tx.select().from(kanbanPairings).where(inArray(kanbanPairings.fgKanbanId, indukIds)))
          .length,
        0,
      );
      catat('batal satu induk membatalkan kelima induk dan memasang kembali tiga box');

      /* ── 8. Pembatalan DITOLAK bila kartunya sudah jalan ─────────────── */
      const simpanLagi = await belanja.simpan({
        plantCode: 'BODY',
        indukKanbanIds: indukIds,
        wipKanbanIds: tigaWip,
      });
      assert.equal(simpanLagi.hasil, 'DITERIMA', simpanLagi.pesan);

      await tx
        .update(kanbans)
        .set({ status: 'PRODUCED', producedAt: new Date() })
        .where(eq(kanbans.id, kartuWip[0]!.id));
      const batalTerlambat = await belanja.batal({ plantCode: 'BODY', fgKanbanId: fgId });
      assert.equal(batalTerlambat.hasil, 'DITOLAK');
      assert.match(batalTerlambat.pesan, /sudah dipakai lagi/);
      catat('pembatalan ditolak kalau kartu turunan sudah membawa box lain');

      // Kartu turunan dikembalikan; kini satu induk discan produksi.
      await tx
        .update(kanbans)
        .set({ status: 'AVAILABLE', producedAt: null })
        .where(eq(kanbans.id, kartuWip[0]!.id));
      assert.equal(await belanja.sudahBelanja(fgId), true);
      assert.equal(await belanja.tutupPasangan(tx, fgId), 1);
      await tx.update(kanbans).set({ status: 'PRODUCED' }).where(eq(kanbans.id, fgId));
      assert.equal(await belanja.sudahBelanja(fgId), false);

      const batalSebagian = await belanja.batal({ plantCode: 'BODY', fgKanbanId: indukIds[1]! });
      assert.equal(batalSebagian.hasil, 'DITOLAK');
      assert.match(batalSebagian.pesan, /sudah discan produksi/);
      catat('pembatalan ditolak bila induk lain dari belanja yang sama sudah diproduksi');
      assert.equal(
        (await belanja.stasiun('BODY')).menunggu.some((m) => m.fgKanbanId === fgId),
        false,
        'induk yang sudah produksi hilang dari daftar tunggu',
      );
      catat('scan produksi induk menutup pasangannya sendiri');

      /* ── 9. Berjenjang: painting juga wajib belanja ──────────────────── */
      await tx.insert(partProcesses).values({
        plantId: pabrik.id,
        partId: partWip!.id,
        processType: 'PAINTING_FG',
        seqNo: 10,
        requirePairing: true,
      });

      const [partInj] = await tx
        .insert(parts)
        .values({
          plantId: pabrik.id,
          partNumber: 'UJI-INJ-660A',
          backNumber: 'ZI01',
          name: 'Uji injection 660A',
          processType: 'INJECTION_FG',
          partType: 'WIP',
          sourceType: 'MANUFACTURED',
          qtyPerKanban: 50,
        })
        .returning({ id: parts.id });

      await tx.insert(partPairings).values({
        plantId: pabrik.id,
        parentPartId: partWip!.id,
        componentPartId: partInj!.id,
        qtyPer: '1',
        effectiveFrom: kemarin,
      });

      const kartuInj = await tx
        .insert(kanbans)
        .values({
          plantId: pabrik.id,
          partId: partInj!.id,
          serialNumber: '9201',
          qtyPerBox: 50,
          status: 'PRODUCED' as const,
          producedAt: penuhPada,
        })
        .returning({ id: kanbans.id });

      // Kartu painting 9102 sedang AVAILABLE — baru lepas dari belanja assy.
      const belanjaPainting = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9102',
        indukKanbanIds: [],
        wipKanbanIds: [],
      });
      assert.equal(belanjaPainting.hasil, 'DITERIMA', belanjaPainting.pesan);
      assert.equal(belanjaPainting.sesi?.komponen[0]?.partNumber, 'UJI-INJ-660A');
      catat('kartu painting kini jadi INDUK: meminta kartu injection sesuai BOM-nya');

      const paintingId = belanjaPainting.sesi!.induk[0]!.kanbanId;
      const simpanPainting = await belanja.simpan({
        plantCode: 'BODY',
        indukKanbanIds: [paintingId],
        wipKanbanIds: [kartuInj[0]!.id],
      });
      assert.equal(simpanPainting.hasil, 'DITERIMA', simpanPainting.pesan);
      catat('satu kartu bisa jadi induk di satu tingkat dan box di tingkat lain');

      const paintingSebagaiBox = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9102',
        indukKanbanIds: [kartuEnam!.id],
        wipKanbanIds: [],
      });
      assert.equal(paintingSebagaiBox.hasil, 'DITOLAK');
      assert.match(paintingSebagaiBox.pesan, /belum discan produksi/);
      catat('kartu SHOPPED tidak bisa dibelanjakan: box-nya belum penuh');

      /*
       * Dibatalkan, SELALU. Lihat catatan di kepala berkas: fixture yang
       * tertinggal akan terbaca orang lain sebagai data sungguhan.
       */
      throw new BatalkanSaja();
    });
  } catch (err) {
    if (!(err instanceof BatalkanSaja)) throw err;
  }

  console.log(`\n[belanja] ${lolos} pemeriksaan lolos. Seluruh fixture dibatalkan (ROLLBACK).`);
  await closeDb();
}

/** Penanda untuk membatalkan transaksi tanpa menyatakan kegagalan. */
class BatalkanSaja extends Error {
  constructor() {
    super('rollback');
    this.name = 'BatalkanSaja';
  }
}

main().catch((err) => {
  console.error('[belanja] GAGAL:', err);
  process.exit(1);
});
