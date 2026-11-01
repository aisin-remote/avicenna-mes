import 'reflect-metadata';
import assert from 'node:assert/strict';
import {
  and,
  bomLines,
  closeDb,
  eq,
  getDb,
  inArray,
  kanbanEvents,
  kanbanPairings,
  kanbans,
  parts,
  plants,
  routeProcesses,
  type Database,
} from '@avicenna/db';
import { susunKodeKartuKanban } from '@avicenna/domain';
import { BelanjaService } from './belanja.service';
import { ProcessTypeService } from '../master/process-type.service';
import { KomponenService } from '../komponen/komponen.service';

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
          qtyPerKanban: 100,
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
          qtyPerKanban: 50,
        })
        .returning({ id: parts.id });

      // Komponen beli: ikut di BOM, TIDAK boleh ikut diperiksa saat belanja.
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
      await tx.insert(bomLines).values([
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

      const [kartuFg] = await tx
        .insert(kanbans)
        .values({
          plantId: pabrik.id,
          partId: partFg!.id,
          serialNumber: '9001',
          qtyPerBox: 100,
          status: 'AVAILABLE',
        })
        .returning({ id: kanbans.id });

      const penuhPada = new Date('2026-11-01T01:00:00.000Z');
      const kartuWip = await tx
        .insert(kanbans)
        .values(
          ['9101', '9102', '9103'].map((seri) => ({
            plantId: pabrik.id,
            partId: partWip!.id,
            serialNumber: seri,
            qtyPerBox: 50,
            status: 'PRODUCED' as const,
            producedAt: penuhPada,
            cycleCount: 7,
          })),
        )
        .returning({ id: kanbans.id, serialNumber: kanbans.serialNumber });

      await tx
        .update(routeProcesses)
        .set({ requirePairing: true })
        .where(
          and(
            eq(routeProcesses.plantId, pabrik.id),
            eq(routeProcesses.processType, 'ASSEMBLING_BODY_FG'),
          ),
        );

      /* ── 1. Membuka sesi dengan kartu FG ───────────────────────────────── */
      const buka = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZA01|9001',
        wipKanbanIds: [],
      });
      assert.equal(buka.hasil, 'DITERIMA', buka.pesan);
      assert.equal(buka.sisi, 'FG');
      assert.equal(buka.sesi?.unitFg, 100);
      catat('kartu FG membuka sesi, isi box terbaca 100 unit');

      // Part beli tidak ikut: ia datang lewat kartu ARES, bukan dari rak.
      assert.equal(buka.sesi?.komponen.length, 1);
      assert.equal(buka.sesi?.komponen[0]?.partNumber, 'UJI-PAINT-660A');
      assert.equal(buka.sesi?.komponen[0]?.dibutuhkan, 100);
      catat('hanya komponen buatan sendiri yang diminta; part beli dilewati');

      const fgId = buka.sesi!.fg.kanbanId;

      /*
       * Isi QR kartu CETAKAN SENDIRI harus membuka kartu yang sama.
       *
       * Di atas kartunya dibuka dengan bentuk ketik manual (`ZA01|9001`), yang
       * memang masih sah. Tetapi yang discan sehari-hari adalah QR-nya, dan
       * isinya lima ruas lengkap — kalau stasiun ini hanya mengerti bentuk
       * pendeknya, belanja mustahil dilakukan dengan kartu sungguhan.
       */
      const lewatQr = await belanja.scan({
        plantCode: 'BODY',
        rawCode: susunKodeKartuKanban({
          partNumber: 'UJI-ASSY-660A',
          backNumber: 'ZA01',
          serialNumber: '9001',
          qtyPerBox: 100,
        }),
        wipKanbanIds: [],
      });
      assert.equal(lewatQr.hasil, 'DITERIMA', lewatQr.pesan);
      assert.equal(lewatQr.sesi?.fg.kanbanId, fgId, 'QR dan ketik manual menuju kartu yang sama');
      catat('isi QR kartu cetakan sendiri terbaca di stasiun belanja');

      /* ── 2. Menembak kartu WIP satu per satu ───────────────────────────── */
      const satu = await belanja.scan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        rawCode: 'ZP01|9101',
        wipKanbanIds: [],
      });
      assert.equal(satu.hasil, 'DITERIMA', satu.pesan);
      assert.equal(satu.sesi?.komponen[0]?.dibawa, 50);
      assert.equal(satu.sesi?.bolehDisimpan, false);
      catat('satu box: 50/100, belum boleh disimpan');

      const dua = await belanja.scan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        rawCode: 'ZP01|9102',
        wipKanbanIds: [kartuWip[0]!.id],
      });
      assert.equal(dua.sesi?.komponen[0]?.dibawa, 100);
      assert.equal(dua.sesi?.bolehDisimpan, true);
      catat('dua box: 100/100, boleh disimpan');

      const tiga = await belanja.scan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        rawCode: 'ZP01|9103',
        wipKanbanIds: [kartuWip[0]!.id, kartuWip[1]!.id],
      });
      assert.equal(tiga.sesi?.bolehDisimpan, false, 'kelebihan harus menghalangi');
      assert.match(tiga.sesi!.galat.join(' '), /lebih 50/);
      catat('tiga box: 150/100 ditolak, bukan dibiarkan lolos');

      const ulang = await belanja.scan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        rawCode: 'ZP01|9101',
        wipKanbanIds: [kartuWip[0]!.id],
      });
      assert.equal(ulang.hasil, 'DITOLAK');
      assert.match(ulang.pesan, /sudah ditembak/);
      catat('kartu yang sama ditembak dua kali ditolak');

      /* ── 3. Menyimpan ──────────────────────────────────────────────────── */
      const gagal = await belanja.simpan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        wipKanbanIds: kartuWip.map((k) => k.id),
      });
      assert.equal(gagal.hasil, 'DITOLAK', 'tiga box tidak boleh tersimpan');
      catat('simpan dengan jumlah tidak pas ditolak di server, bukan hanya di layar');

      const simpan = await belanja.simpan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        wipKanbanIds: [kartuWip[0]!.id, kartuWip[1]!.id],
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
        .where(inArray(kanbans.id, [fgId, ...kartuWip.map((k) => k.id)]));

      assert.equal(sesudah.find((k) => k.id === fgId)?.status, 'SHOPPED');
      catat('kartu induk menunggu produksi: SHOPPED');

      /*
       * Inilah perubahan pentingnya: kartu box LEPAS di belanja, bukan nanti
       * saat induknya discan produksi. Di situlah kartunya benar-benar dicopot
       * dan dibawa pulang ke pos.
       */
      const box1 = sesudah.find((k) => k.id === kartuWip[0]!.id)!;
      assert.equal(box1.status, 'AVAILABLE', 'kartu box lepas pada saat belanja');
      assert.equal(box1.producedAt, null);
      assert.equal(box1.cycleCount, 8, 'putaran kartu box bertambah satu');
      catat('kartu box lepas ke AVAILABLE saat belanja, putaran bertambah');

      assert.equal(
        sesudah.find((k) => k.id === kartuWip[2]!.id)?.status,
        'PRODUCED',
        'box yang tidak ikut belanja tidak boleh berubah',
      );
      catat('box yang tidak ikut belanja tetap PRODUCED di rak');

      const pasangan = await tx
        .select()
        .from(kanbanPairings)
        .where(eq(kanbanPairings.fgKanbanId, fgId));
      assert.equal(pasangan.length, 2);
      assert.equal(pasangan[0]?.qty, 50, 'jumlah per box ikut disalin ke pasangannya');
      assert.deepEqual(
        pasangan[0]?.wipProducedAt,
        penuhPada,
        'waktu box dinyatakan penuh ikut disalin, supaya pembatalan bisa memulihkannya',
      );
      catat('pasangan menyimpan jumlah dan waktu produksi box');

      const eventInduk = await tx
        .select()
        .from(kanbanEvents)
        .where(and(eq(kanbanEvents.kanbanId, fgId), eq(kanbanEvents.type, 'SHOPPED')));
      assert.equal(eventInduk.length, 2, 'satu event per pasangan di kartu induk');
      assert.ok(eventInduk.every((e) => e.pairedKanbanId !== null));

      const eventBox = await tx
        .select()
        .from(kanbanEvents)
        .where(eq(kanbanEvents.kanbanId, kartuWip[0]!.id));
      assert.ok(
        eventBox.some((e) => e.type === 'SHOPPED') && eventBox.some((e) => e.type === 'RELEASED'),
        'kartu box dapat SHOPPED (masuk ke mana) dan RELEASED (putarannya tutup)',
      );
      catat('riwayat tercatat di kedua kartu: SHOPPED di induk, SHOPPED+RELEASED di box');

      /* ── 4. Interlock ke HULU ──────────────────────────────────────────── */
      const belumTerisi = await belanja.scan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        rawCode: 'ZP01|9101',
        wipKanbanIds: [],
      });
      assert.equal(belumTerisi.hasil, 'DITOLAK');
      assert.match(belumTerisi.pesan, /belum berisi barang/);
      catat('kartu box yang sudah lepas tidak bisa dibelanjakan lagi sebelum terisi');

      assert.equal(
        await belanja.menungguBelanjaHilir(pabrik.id, partWip!.id),
        true,
        'part painting punya induk yang mewajibkan belanja',
      );
      assert.equal(
        await belanja.menungguBelanjaHilir(pabrik.id, partFg!.id),
        false,
        'part assembling tidak punya induk berbelanja',
      );
      catat('stasiun scan bisa membedakan "box belum diambil hilir" dari "kartu sudah dipakai"');

      const sudahBelanjaLagi = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZA01|9001',
        wipKanbanIds: [],
      });
      assert.equal(sudahBelanjaLagi.hasil, 'DITOLAK');
      assert.match(sudahBelanjaLagi.pesan, /sudah belanja/);
      catat('kartu induk yang sudah belanja tidak bisa membuka sesi kedua');

      /* ── 5. Daftar tunggu ──────────────────────────────────────────────── */
      const stasiun = await belanja.stasiun('BODY');
      assert.ok(stasiun.prosesWajib.includes('ASSEMBLING_BODY_FG'));
      const menunggu = stasiun.menunggu.find((m) => m.fgKanbanId === fgId);
      assert.ok(menunggu, 'kartu yang sudah belanja harus muncul di daftar tunggu');
      assert.equal(menunggu.jumlahKartu, 2);
      assert.equal(menunggu.unit, 100);
      catat('daftar tunggu menampilkan 2 box / 100 unit');

      /* ── 6. Membatalkan ───────────────────────────────────────────────── */
      const batal = await belanja.batal({ plantCode: 'BODY', fgKanbanId: fgId });
      assert.equal(batal.hasil, 'DITERIMA', batal.pesan);
      const setelahBatal = await tx
        .select({
          id: kanbans.id,
          status: kanbans.status,
          cycleCount: kanbans.cycleCount,
          producedAt: kanbans.producedAt,
        })
        .from(kanbans)
        .where(inArray(kanbans.id, [fgId, kartuWip[0]!.id]));
      assert.equal(setelahBatal.find((k) => k.id === fgId)?.status, 'AVAILABLE');
      const dipulihkan = setelahBatal.find((k) => k.id === kartuWip[0]!.id)!;
      assert.equal(dipulihkan.status, 'PRODUCED', 'kartu dipasang kembali ke box-nya');
      assert.deepEqual(
        dipulihkan.producedAt,
        penuhPada,
        'waktu produksi box dipulihkan apa adanya',
      );
      assert.equal(dipulihkan.cycleCount, 7, 'putaran dikurangi: pergi-dan-kembali tidak terjadi');
      assert.equal(
        (await tx.select().from(kanbanPairings).where(eq(kanbanPairings.fgKanbanId, fgId))).length,
        0,
      );
      catat('pembatalan memasang kartu kembali dengan waktu dan putaran yang benar');

      /* ── 7. Pembatalan DITOLAK bila kartunya sudah jalan ─────────────── */
      const simpanLagi = await belanja.simpan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        wipKanbanIds: [kartuWip[0]!.id, kartuWip[1]!.id],
      });
      assert.equal(simpanLagi.hasil, 'DITERIMA', simpanLagi.pesan);

      // Lini painting memakai kartu yang baru kembali itu untuk box baru.
      await tx
        .update(kanbans)
        .set({ status: 'PRODUCED', producedAt: new Date() })
        .where(eq(kanbans.id, kartuWip[0]!.id));

      const batalTerlambat = await belanja.batal({ plantCode: 'BODY', fgKanbanId: fgId });
      assert.equal(batalTerlambat.hasil, 'DITOLAK');
      assert.match(batalTerlambat.pesan, /sudah dipakai lagi/);
      catat('pembatalan ditolak kalau kartunya sudah membawa box lain — bukan ditarik diam-diam');

      /* ── 8. Scan produksi induk menutup pasangannya ──────────────────── */
      assert.equal(await belanja.sudahBelanja(fgId), true);
      const ditutup = await belanja.tutupPasangan(tx, fgId);
      assert.equal(ditutup, 2);
      assert.equal(await belanja.sudahBelanja(fgId), false);
      assert.equal(
        (await belanja.stasiun('BODY')).menunggu.some((m) => m.fgKanbanId === fgId),
        false,
        'kartu yang sudah produksi hilang dari daftar tunggu',
      );
      catat('scan produksi induk menutup pasangan dan mengosongkan daftar tunggu');

      /* ── 9. Berjenjang: painting juga wajib belanja ──────────────────── */
      await tx
        .update(routeProcesses)
        .set({ requirePairing: true })
        .where(
          and(eq(routeProcesses.plantId, pabrik.id), eq(routeProcesses.processType, 'PAINTING_FG')),
        );

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

      await tx.insert(bomLines).values({
        plantId: pabrik.id,
        parentPartId: partWip!.id,
        componentPartId: partInj!.id,
        qtyPer: '1',
        effectiveFrom: kemarin,
      });

      const kartuInj = await tx
        .insert(kanbans)
        .values(
          ['9201'].map((seri) => ({
            plantId: pabrik.id,
            partId: partInj!.id,
            serialNumber: seri,
            qtyPerBox: 50,
            status: 'PRODUCED' as const,
            producedAt: penuhPada,
          })),
        )
        .returning({ id: kanbans.id });

      // Kartu painting 9102 sedang AVAILABLE — baru lepas dari belanja assy.
      const belanjaPainting = await belanja.scan({
        plantCode: 'BODY',
        rawCode: 'ZP01|9102',
        wipKanbanIds: [],
      });
      assert.equal(belanjaPainting.hasil, 'DITERIMA', belanjaPainting.pesan);
      assert.equal(belanjaPainting.sesi?.komponen[0]?.partNumber, 'UJI-INJ-660A');
      assert.equal(belanjaPainting.sesi?.komponen[0]?.dibutuhkan, 50);
      catat('kartu painting kini jadi INDUK: meminta kartu injection sesuai BOM-nya');

      const paintingId = belanjaPainting.sesi!.fg.kanbanId;
      const simpanPainting = await belanja.simpan({
        plantCode: 'BODY',
        fgKanbanId: paintingId,
        wipKanbanIds: [kartuInj[0]!.id],
      });
      assert.equal(simpanPainting.hasil, 'DITERIMA', simpanPainting.pesan);

      const berjenjang = await tx
        .select({ id: kanbans.id, status: kanbans.status })
        .from(kanbans)
        .where(inArray(kanbans.id, [paintingId, kartuInj[0]!.id]));
      assert.equal(berjenjang.find((k) => k.id === paintingId)?.status, 'SHOPPED');
      assert.equal(berjenjang.find((k) => k.id === kartuInj[0]!.id)?.status, 'AVAILABLE');
      catat('satu kartu bisa jadi induk di satu tingkat dan box di tingkat lain');

      const paintingSebagaiBox = await belanja.scan({
        plantCode: 'BODY',
        fgKanbanId: fgId,
        rawCode: 'ZP01|9102',
        wipKanbanIds: [],
      });
      assert.equal(paintingSebagaiBox.hasil, 'DITOLAK');
      assert.match(paintingSebagaiBox.pesan, /belum discan produksi/);
      catat('kartu SHOPPED tidak bisa dibelanjakan: box-nya belum penuh');

      /* ── 10. Stasiun kanban tidak melayani kartu internal ───────────── */
      const komponen = new KomponenService(sebagaiDb);

      /*
       * Kartu 9103 masih PRODUCED dan kartunya milik kita sendiri. Stasiun
       * Scan Komponen hanya untuk kartu ARES — menerimanya di sana akan
       * melepaskan kartu tanpa box-nya pernah dicocokkan, dan interlock
       * belanja hilang tanpa jejak.
       */
      const lewatStasiun = await komponen.scan({ plantCode: 'BODY', rawCode: 'ZP01|9103' });
      assert.equal(lewatStasiun.hasil, 'DITOLAK');
      assert.match(lewatStasiun.pesan, /kartu kanban internal/);
      assert.equal(lewatStasiun.jenisKartu, null, 'bukan kartu ARES, jadi jenisnya tidak diakui');
      catat('stasiun Scan Komponen menolak kartu kanban internal');

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
