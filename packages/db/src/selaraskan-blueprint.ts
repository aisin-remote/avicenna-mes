import './load-env';
import { eq } from 'drizzle-orm';
import type { LocationKind } from '@avicenna/contracts';
import { bacaKatalogProses } from './katalog-proses';
import { getDb, closeDb } from './client';
import { plants, locations, lines, routeProcesses } from './schema/index';

/**
 * ─── SELARASKAN DATABASE LAMA DENGAN BLUEPRINT SAP PP AIIA ──────────────────
 *
 * Dijalankan SEKALI pada database yang sudah berisi. Seed tidak bisa memikul
 * pekerjaan ini, dan itu disengaja:
 *
 *   - seed hanya MENAMBAH baris yang belum ada. Pada database yang SLOC-nya
 *     masih WH00/WP01/PP02, ia akan menambahkan WH80/WP80/FG80 di sebelahnya,
 *     bukan menggantinya — lalu saldo stok terbelah antara dua kode yang
 *     sebenarnya satu gudang yang sama;
 *   - seed hanya membuat pabrik saat tabelnya MASIH KOSONG, supaya menjalankan
 *     seed pada database yang dipakai tidak pernah menggandakan pabrik. Pada
 *     database yang sudah berisi dua pabrik, pabrik Electric karena itu tidak
 *     pernah lahir dan kode SAP-nya tidak pernah terisi.
 *
 * ── Kenapa MENGGANTI NAMA, bukan membuat baru ───────────────────────────────
 *
 * SLOC dirujuk oleh id dari setiap baris mutasi dan saldo stok. Mengganti
 * kodenya mempertahankan id, jadi seluruh riwayat ikut pindah nama bersamanya.
 * Membuat SLOC baru lalu meninggalkan yang lama akan membelah saldo: stok
 * sungguhan tetap di PP02 sementara produksi baru masuk ke FG80, dan tidak ada
 * galat yang muncul — hanya dua angka yang sama-sama salah.
 *
 * ── Bawaannya UJI COBA ──────────────────────────────────────────────────────
 *
 *   pnpm --filter @avicenna/db db:selaraskan            # laporan saja
 *   pnpm --filter @avicenna/db db:selaraskan --tulis    # menulis sungguhan
 *
 * Seluruh penulisan berada dalam SATU transaksi: kalau satu langkah gagal,
 * tidak ada yang tersimpan separuh.
 */

/** Kode SAP tiap pabrik menurut blueprint, dikenali dari kode pabrik kita. */
const KODE_SAP: Record<string, string> = {
  UNIT: '800',
  BODY: '700',
  ELEC: '900',
};

/** Lima SLOC per pabrik. Empat pertama ada di Tabel 6 blueprint; ST milik kita. */
const SLOC_PABRIK: Array<{ kind: LocationKind; awalan: string; nama: string }> = [
  { kind: 'WAREHOUSE', awalan: 'WH', nama: 'Komponen & Raw Material' },
  { kind: 'WIP', awalan: 'WP', nama: 'Work In Process / Semi Finished' },
  { kind: 'FINISH_GOOD', awalan: 'FG', nama: 'Finish Good' },
  { kind: 'NG', awalan: 'RE', nama: 'Reject / Scrap' },
  { kind: 'STAGING', awalan: 'ST', nama: 'Staging & Shipping' },
];

/**
 * Proses pabrik Electric — Tabel 16 blueprint, dikurangi ASY yang satu lini
 * dengan Inspection, ditambah pemecahan WIP/FG pada Inspection dan Vacuum.
 */
const PROSES_ELEC = [
  'MOUNTING',
  'INSPECTION_WIP',
  'INSPECTION_FG',
  'VACUUM_WIP',
  'VACUUM_FG',
  'ANTENNA',
] as const;

type Catatan = { tindakan: string; rincian: string };

async function main() {
  const tulis = process.argv.includes('--tulis');
  const db = getDb();
  const katalog = await bacaKatalogProses(db);

  console.log(
    `\n[selaraskan] ${tulis ? 'MENULIS SUNGGUHAN' : 'uji coba — tidak ada yang ditulis'}\n`,
  );

  const dilakukan: Catatan[] = [];
  const dilewati: Catatan[] = [];
  /*
   * Kode yang AKAN dipunyai tiap SLOC setelah langkah 3.
   *
   * Dipakai hanya untuk laporan. Tanpa ini, uji coba menyebut tujuan lini
   * dengan kode LAMA — "keluar PP02 → WP01" padahal setelah ditulis ia WP80 —
   * dan orang yang membaca laporan untuk memutuskan justru disesatkan olehnya.
   */
  const kodeNanti = new Map<number, string>();

  await db.transaction(async (tx) => {
    /* ── 1. Kode SAP pabrik ──────────────────────────────────────────────── */
    const barisPabrik = await tx.select().from(plants);
    for (const p of barisPabrik) {
      const target = KODE_SAP[p.code.trim().toUpperCase()];
      if (!target) {
        dilewati.push({
          tindakan: `pabrik ${p.code}`,
          rincian: 'kode pabrik tidak dikenal (bukan UNIT/BODY/ELEC) — kode SAP tidak ditebak',
        });
        continue;
      }
      if (p.sapCode?.trim() === target) continue;
      if (p.sapCode?.trim()) {
        dilewati.push({
          tindakan: `pabrik ${p.code}`,
          rincian: `kode SAP sudah terisi "${p.sapCode}" — tidak ditimpa`,
        });
        continue;
      }
      dilakukan.push({ tindakan: `pabrik ${p.code}`, rincian: `kode SAP diisi ${target}` });
      if (tulis) await tx.update(plants).set({ sapCode: target }).where(eq(plants.id, p.id));
    }

    /* ── 2. Pabrik Electric ──────────────────────────────────────────────── */
    const adaElec = barisPabrik.some(
      (p) => p.code.trim().toUpperCase() === 'ELEC' || p.sapCode?.trim() === '900',
    );
    if (!adaElec) {
      dilakukan.push({ tindakan: 'pabrik ELEC', rincian: 'dibuat, kode SAP 900' });
      if (tulis) {
        await tx.insert(plants).values({
          code: 'ELEC',
          name: 'Plant Electric - Mounting, Inspection, Vacuum, Antena',
          sapCode: '900',
        });
      }
    }

    /*
     * Dibaca ULANG supaya pabrik yang baru dibuat ikut diproses. Saat uji coba
     * ia memang belum ada, dan laporannya jujur menyebut itu di bagian bawah.
     */
    const pabrikKini = tulis ? await tx.select().from(plants) : barisPabrik;
    const barisSloc = await tx.select().from(locations);

    /* ── 3. SLOC per pabrik: ganti nama, atau tambahkan ──────────────────── */
    for (const p of pabrikKini) {
      const sap = (p.sapCode ?? KODE_SAP[p.code.trim().toUpperCase()] ?? '').trim();
      if (!sap) {
        dilewati.push({ tindakan: `SLOC ${p.code}`, rincian: 'kode SAP pabrik kosong' });
        continue;
      }
      const akhiran = sap.slice(0, 2);
      const milikPabrik = barisSloc.filter((l) => l.plantId === p.id);

      for (const { kind, awalan, nama } of SLOC_PABRIK) {
        const target = `${awalan}${akhiran}`;
        const sejenis = milikPabrik.filter((l) => l.kind === kind);

        if (sejenis.length > 1) {
          dilewati.push({
            tindakan: `SLOC ${p.code} ${kind}`,
            rincian: `ada ${sejenis.length} SLOC berjenis sama (${sejenis
              .map((l) => l.code)
              .join(', ')}) — mana yang jadi ${target} harus diputuskan orang`,
          });
          continue;
        }

        const lama = sejenis[0];
        if (lama?.code === target) continue;

        const bentrok = milikPabrik.find((l) => l.code === target && l.id !== lama?.id);
        if (bentrok) {
          dilewati.push({
            tindakan: `SLOC ${p.code} ${kind}`,
            rincian: `kode ${target} sudah dipakai SLOC lain (jenis ${bentrok.kind})`,
          });
          continue;
        }

        if (lama) {
          dilakukan.push({
            tindakan: `SLOC ${p.code} ${kind}`,
            rincian: `${lama.code} → ${target} (id ${lama.id} dipertahankan, riwayat ikut)`,
          });
          kodeNanti.set(lama.id, target);
          if (tulis)
            await tx.update(locations).set({ code: target }).where(eq(locations.id, lama.id));
        } else {
          dilakukan.push({ tindakan: `SLOC ${p.code} ${kind}`, rincian: `${target} ditambahkan` });
          if (tulis) {
            await tx.insert(locations).values({ plantId: p.id, code: target, name: nama, kind });
          }
        }
      }
    }

    /* ── 4. SLOC keluaran lini mengikuti jenis prosesnya ─────────────────── */
    const slocKini = tulis ? await tx.select().from(locations) : barisSloc;
    const cariSloc = (plantId: number, kind: LocationKind) =>
      slocKini.find((l) => l.plantId === plantId && l.kind === kind);

    for (const l of await tx.select().from(lines)) {
      const jenisKeluar: LocationKind = katalog.menghasilkanFinishGood(l.processType)
        ? 'FINISH_GOOD'
        : 'WIP';
      const masuk = cariSloc(l.plantId, 'WIP');
      const keluar = cariSloc(l.plantId, jenisKeluar);
      if (!masuk || !keluar) {
        dilewati.push({ tindakan: `lini ${l.code}`, rincian: 'SLOC pabriknya belum lengkap' });
        continue;
      }
      const perlu = l.inputLocationId !== masuk.id || l.outputLocationId !== keluar.id;
      if (!perlu) continue;

      const nanti = (id: number, bawaan: string) => kodeNanti.get(id) ?? bawaan;
      const sebelum = slocKini.find((s) => s.id === l.outputLocationId)?.code ?? '(kosong)';
      dilakukan.push({
        tindakan: `lini ${l.code} (${l.processType})`,
        rincian:
          `keluar ${sebelum} → ${nanti(keluar.id, keluar.code)}, ` +
          `masuk ${nanti(masuk.id, masuk.code)}`,
      });
      if (tulis) {
        await tx
          .update(lines)
          .set({ inputLocationId: masuk.id, outputLocationId: keluar.id })
          .where(eq(lines.id, l.id));
      }
    }

    /*
     * ── 5. Rute proses pabrik Electric ───────────────────────────────────────
     *
     * Tanpa baris ini, keempat proses Electric muncul sebagai kolom di matriks
     * rute tetapi setiap klik ditolak "tidak terdaftar untuk pabrik ini" —
     * terlihat seperti kerusakan, padahal masternya yang belum ada.
     *
     * Izin push SAP sengaja dibiarkan MATI: rute Electric belum dipastikan,
     * dan menyalakannya berarti mengirim dokumen atas dugaan.
     */
    const elec = pabrikKini.find(
      (p) => p.code.trim().toUpperCase() === 'ELEC' || p.sapCode?.trim() === '900',
    );
    if (elec) {
      const sudahAda = new Set(
        (await tx.select().from(routeProcesses).where(eq(routeProcesses.plantId, elec.id))).map(
          (r) => r.processType,
        ),
      );
      const wip = cariSloc(elec.id, 'WIP');
      const fg = cariSloc(elec.id, 'FINISH_GOOD');
      for (const proses of PROSES_ELEC) {
        if (sudahAda.has(proses)) continue;
        /*
         * Lini FG mengeluarkan hasilnya ke SLOC barang jadi, lini WIP tetap di
         * SLOC WIP — aturan yang sama dengan lini mana pun, lihat
         * periksaHasilProduksi(). Metode scan-nya pun berbeda: di lini FG
         * kanban ditempel, jadi PART_KANBAN.
         */
        const fgLini = katalog.menghasilkanFinishGood(proses);
        const keluar = fgLini ? fg : wip;
        dilakukan.push({
          tindakan: `rute proses ${elec.code}`,
          rincian:
            `${proses} didaftarkan` + (wip && keluar ? `, SLOC ${wip.code} → ${keluar.code}` : ''),
        });
        if (tulis) {
          await tx.insert(routeProcesses).values({
            plantId: elec.id,
            processType: proses,
            scanMode: fgLini ? 'PART_KANBAN' : 'PART_SAJA',
            inputLocationId: wip?.id ?? null,
            outputLocationId: keluar?.id ?? null,
          });
        }
      }
    } else if (!tulis) {
      dilewati.push({
        tindakan: 'rute proses ELEC',
        rincian: 'pabriknya baru dibuat saat --tulis, jadi belum bisa didaftarkan di uji coba',
      });
    }

    /*
     * ── Pasangan _FG untuk setiap _WIP yang terdaftar ────────────────────────
     *
     * Akhiran _WIP dan _FG menandai DUA LINI yang berbeda secara fisik pada
     * proses yang sama. Kalau sebuah pabrik mengerjakan Injection, ia punya
     * keduanya — dan selama pasangan FG-nya belum terdaftar, kolomnya tidak
     * pernah muncul di matriks rute, sehingga rute yang berhenti di situ tidak
     * bisa disusun sama sekali.
     *
     * Hanya arah WIP → FG yang dilengkapi. Sebaliknya tidak: proses yang
     * memang hanya punya lini FG (mis. Casting FG pada pabrik yang tidak punya
     * Casting WIP) tidak boleh dipaksa memiliki lini WIP yang tidak ada.
     */
    const semuaRute = await tx.select().from(routeProcesses);
    for (const p of pabrikKini) {
      const diPabrik = semuaRute.filter((r) => r.plantId === p.id);
      const sudah = new Set(diPabrik.map((r) => r.processType));
      const fgSloc = cariSloc(p.id, 'FINISH_GOOD');
      for (const r of diPabrik) {
        if (!r.processType.endsWith('_WIP')) continue;
        const pasangan = `${r.processType.slice(0, -4)}_FG`;
        if (!katalog.cari(pasangan)) continue;
        if (sudah.has(pasangan as (typeof routeProcesses.$inferInsert)['processType'])) continue;
        sudah.add(pasangan as (typeof routeProcesses.$inferInsert)['processType']);
        dilakukan.push({
          tindakan: `rute proses ${p.code}`,
          rincian: `${pasangan} didaftarkan sebagai pasangan ${r.processType}`,
        });
        if (tulis) {
          await tx.insert(routeProcesses).values({
            plantId: p.id,
            processType: pasangan as (typeof routeProcesses.$inferInsert)['processType'],
            // Lini FG menempel kanban — lihat modeScanBawaan().
            scanMode: r.scanMode === 'KANBAN_BOX' ? 'KANBAN_BOX' : 'PART_KANBAN',
            inputLocationId: r.inputLocationId,
            outputLocationId: fgSloc?.id ?? r.outputLocationId,
          });
        }
      }
    }
  });

  const cetak = (judul: string, daftar: Catatan[]) => {
    if (daftar.length === 0) return;
    console.log(`${judul} (${daftar.length}):`);
    const lebar = Math.max(...daftar.map((d) => d.tindakan.length));
    for (const d of daftar) console.log(`  ${d.tindakan.padEnd(lebar)}  ${d.rincian}`);
    console.log('');
  };

  cetak(tulis ? 'Dilakukan' : 'Akan dilakukan', dilakukan);
  cetak('Dilewati — perlu diputuskan orang', dilewati);

  if (dilakukan.length === 0) {
    console.log('[selaraskan] tidak ada yang perlu diubah.\n');
  } else if (!tulis) {
    console.log('[selaraskan] jalankan ulang dengan --tulis untuk menyimpannya.\n');
  } else {
    console.log('[selaraskan] tersimpan dalam satu transaksi.\n');
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error('\n[selaraskan] GAGAL — tidak ada yang tersimpan.\n');
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
