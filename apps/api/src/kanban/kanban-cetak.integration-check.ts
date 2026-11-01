import 'reflect-metadata';
import assert from 'node:assert/strict';
import {
  and,
  closeDb,
  eq,
  getDb,
  inArray,
  kanbans,
  parts,
  plants,
  type Database,
} from '@avicenna/db';
import { KanbanCetakService } from './kanban-cetak.service';

/**
 * Pemeriksaan alur cetak kanban, memakai service yang sama dengan produksi.
 *
 * Seluruhnya di dalam satu transaksi yang selalu di-ROLLBACK — lihat catatan di
 * belanja.integration-check.ts untuk alasannya.
 */
class BatalkanSaja extends Error {
  constructor() {
    super('rollback');
    this.name = 'BatalkanSaja';
  }
}

async function main() {
  const db = getDb();
  const [pabrik] = await db.select().from(plants).where(eq(plants.code, 'UNIT')).limit(1);
  assert(pabrik, 'Butuh pabrik UNIT');

  let lolos = 0;
  const catat = (nama: string) => {
    lolos += 1;
    console.log(`  ✓ ${nama}`);
  };

  try {
    await db.transaction(async (tx) => {
      const cetak = new KanbanCetakService(tx as unknown as Database);

      const [partSiap] = await tx
        .insert(parts)
        .values({
          plantId: pabrik.id,
          partNumber: 'UJI-CETAK-001',
          backNumber: 'ZZ01',
          name: 'Uji cetak kanban',
          processType: 'CASTING_FG',
          partType: 'FINISHED_GOOD',
          sourceType: 'MANUFACTURED',
          qtyPerKanban: 60,
        })
        .returning({ id: parts.id });

      const [partTanpaBack] = await tx
        .insert(parts)
        .values({
          plantId: pabrik.id,
          partNumber: 'UJI-CETAK-002',
          name: 'Uji cetak tanpa back number',
          processType: 'CASTING_FG',
          partType: 'FINISHED_GOOD',
          sourceType: 'MANUFACTURED',
          qtyPerKanban: 60,
        })
        .returning({ id: parts.id });

      /* ── 1. Pratinjau rentang kosong ───────────────────────────────────── */
      const awal = await cetak.pratinjau({ partId: partSiap!.id, dari: 1, sampai: 10 });
      assert.equal(awal.total, 10);
      assert.equal(awal.sudahAda, 0);
      assert.equal(awal.akanDibuat, 10);
      assert.equal(awal.lembar, 3, '10 kartu = 3 lembar A4 (4 per lembar)');
      assert.equal(awal.penghalang.length, 0, awal.penghalang.join('; '));
      catat('pratinjau menghitung total, yang sudah ada, dan jumlah lembar');

      /* ── 2. Pembuatan ─────────────────────────────────────────────────── */
      const buat = await cetak.buat({ partId: partSiap!.id, dari: 1, sampai: 10 });
      assert.equal(buat.dibuat, 10);
      assert.equal(buat.sudahAda, 0);
      catat('sepuluh baris master dibuat');

      const seri = await tx
        .select({ serialNumber: kanbans.serialNumber, qtyPerBox: kanbans.qtyPerBox })
        .from(kanbans)
        .where(eq(kanbans.partId, partSiap!.id));
      assert.equal(seri.length, 10);
      assert.ok(
        seri.some((s) => s.serialNumber === '0001') && seri.some((s) => s.serialNumber === '0010'),
        'seri diberi nol di depan sampai empat digit',
      );
      assert.equal(seri[0]?.qtyPerBox, 60, 'isi per box disalin dari master part ke kartu');
      catat('seri "0001"–"0010", isi per box disalin dari part');

      /* ── 3. Mencetak ulang TIDAK menambah baris ───────────────────────── */
      const ulang = await cetak.buat({ partId: partSiap!.id, dari: 1, sampai: 10 });
      assert.equal(ulang.dibuat, 0);
      assert.equal(ulang.sudahAda, 10);
      assert.equal(
        (await tx.select().from(kanbans).where(eq(kanbans.partId, partSiap!.id))).length,
        10,
        'tidak ada baris kedua untuk seri yang sama',
      );
      catat('mencetak ulang rentang yang sama tidak menambah baris master');

      /* ── 4. Rentang yang bertumpang sebagian ──────────────────────────── */
      const tumpang = await cetak.pratinjau({ partId: partSiap!.id, dari: 5, sampai: 15 });
      assert.equal(tumpang.total, 11);
      assert.equal(tumpang.sudahAda, 6, 'seri 5-10 sudah ada');
      assert.equal(tumpang.akanDibuat, 5, 'seri 11-15 yang baru');
      catat('rentang bertumpang: hanya yang belum ada dihitung sebagai baru');

      /* ── 5. Kartu yang sudah ada TIDAK ditimpa ────────────────────────── */
      await tx
        .update(kanbans)
        .set({ status: 'PRODUCED', qtyPerBox: 99, cycleCount: 12 })
        .where(and(eq(kanbans.partId, partSiap!.id), eq(kanbans.serialNumber, '0003')));
      await cetak.buat({ partId: partSiap!.id, dari: 1, sampai: 10 });
      const [kartuLama] = await tx
        .select({
          status: kanbans.status,
          qtyPerBox: kanbans.qtyPerBox,
          cycleCount: kanbans.cycleCount,
        })
        .from(kanbans)
        .where(and(eq(kanbans.partId, partSiap!.id), eq(kanbans.serialNumber, '0003')));
      assert.equal(kartuLama?.status, 'PRODUCED', 'kartu yang sedang membawa barang tidak direset');
      assert.equal(kartuLama?.qtyPerBox, 99, 'isi per box kartu lama tidak ditimpa nilai master');
      assert.equal(kartuLama?.cycleCount, 12, 'jumlah putaran tidak hilang');
      catat('kartu yang sudah beredar tidak disentuh saat rentangnya dicetak ulang');

      /* ── 6. Daftar cetak ──────────────────────────────────────────────── */
      const daftar = await cetak.daftarCetak({ partId: partSiap!.id, dari: 1, sampai: 3 });
      assert.equal(daftar.length, 3);
      assert.deepEqual(
        daftar.map((d) => d.serialNumber),
        ['0001', '0002', '0003'],
        'diurutkan sebagai ANGKA, bukan teks',
      );
      assert.equal(
        daftar[0]?.kode,
        'AVK1|UJI-CETAK-001|ZZ01|0001|60',
        'isi QR = AVK1|PART|BACK|SERI|QTY',
      );
      assert.equal(daftar[0]?.kodeKetik, 'ZZ01|0001', 'teks di bawah QR = bentuk ketik manual');
      assert.equal(daftar[2]?.qtyPerBox, 99, 'yang tercetak adalah angka milik KARTUNYA');
      /*
       * Dan ikut masuk ke QR-nya. Kalau qty di QR diambil dari master, kartu
       * lama yang isinya 99 akan membawa 60 di barcodenya — pemeriksaan kartu
       * basi di scan.service lalu memperingatkan kartu yang justru benar.
       */
      assert.equal(daftar[2]?.kode, 'AVK1|UJI-CETAK-001|ZZ01|0003|99', 'qty di QR dari kartunya');
      assert.equal(daftar[0]?.partName, 'Uji cetak kanban');
      catat('daftar cetak membawa kode barcode, nama part, dan angka milik kartunya');

      /* ── 7. Part tanpa back number dihalangi ──────────────────────────── */
      const tanpaBack = await cetak.pratinjau({ partId: partTanpaBack!.id, dari: 1, sampai: 4 });
      assert.equal(tanpaBack.penghalang.length, 1);
      assert.match(tanpaBack.penghalang[0]!, /back number/);
      await assert.rejects(
        () => cetak.buat({ partId: partTanpaBack!.id, dari: 1, sampai: 4 }),
        /back number/,
        'pembuatan ikut ditolak, bukan hanya diperingatkan di layar',
      );
      assert.equal(
        (await tx.select().from(kanbans).where(eq(kanbans.partId, partTanpaBack!.id))).length,
        0,
      );
      catat('part tanpa back number tidak bisa dicetak — kartunya tidak akan bisa dikenali');

      /* ── 8. Production version kosong hanya MEMPERINGATKAN ───────────── */
      assert.ok(
        awal.peringatan.some((p) => /Production version/i.test(p)),
        'versi kosong disebut, tetapi tidak menghalangi',
      );
      catat('production version kosong tidak menghentikan OMD, hanya diperingatkan');

      /* ── 9. Seri bukan angka tidak mengganggu hitungan ────────────────── */
      await tx.insert(kanbans).values({
        plantId: pabrik.id,
        partId: partSiap!.id,
        serialNumber: 'QA-UJI-1',
        qtyPerBox: 60,
        status: 'AVAILABLE',
      });
      const setelahKartuCustomer = await cetak.pratinjau({
        partId: partSiap!.id,
        dari: 1,
        sampai: 10,
      });
      assert.equal(
        setelahKartuCustomer.sudahAda,
        10,
        'kartu berseri bukan angka (mis. dari label DN) tidak ikut terhitung',
      );
      const rentang = await cetak.rentangTerpakai(partSiap!.id);
      // Seri 11-15 hanya PRATINJAU di langkah 4, tidak pernah dibuat.
      assert.deepEqual({ min: rentang.min, maks: rentang.maks }, { min: 1, maks: 10 });
      catat('seri bukan angka dilewati, rentang terpakai tetap terbaca benar');

      throw new BatalkanSaja();
    });
  } catch (err) {
    if (!(err instanceof BatalkanSaja)) throw err;
  }

  console.log(
    `\n[cetak-kanban] ${lolos} pemeriksaan lolos. Seluruh fixture dibatalkan (ROLLBACK).`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error('[cetak-kanban] GAGAL:', err);
  process.exit(1);
});
