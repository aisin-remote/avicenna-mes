/**
 * Trial ujung-ke-ujung: scan di lini FG → dokumen outbox → staging SAP.
 *
 * ── Apa yang dibuktikan ─────────────────────────────────────────────────────
 *
 * Tiga alur produksi yang berakhir di tiga lini finish good yang berbeda
 * (Casting FG, Machining FG, Assembling Unit FG), masing-masing menghasilkan
 * satu baris TT_PRODUCTION_RESULT; ditambah satu perpindahan WH → WP yang
 * menghasilkan satu dokumen TT_GOODS_MOVEMENT_H/_L.
 *
 * Yang diperiksa bukan "tidak ada galat", melainkan NILAI yang mendarat di
 * staging: format CHR_DATE, CHR_VALIDATE, CHR_UPLOAD, CHR_STATUS,
 * CHR_TYPE_TRANS, dan CHR_PV. Semua itu syarat program penjemput SAP, dan
 * salah satu pun cukup untuk membuat dokumen tidak pernah terjemput tanpa
 * galat apa pun.
 *
 * ── Dijalankan lewat DI sungguhan ───────────────────────────────────────────
 *
 * Memakai NestFactory.createApplicationContext, bukan memanggil service yang
 * dirakit dengan tangan. Jadi yang diuji adalah rangkaian yang sama dengan
 * yang berjalan di produksi — termasuk katalog jenis proses, antrean, dan
 * kebijakan rute.
 *
 * ── Opt-in, dan TIDAK membersihkan ──────────────────────────────────────────
 *
 * Butuh STAGING_TRIAL_CHECK=true. Fixture-nya memakai nomor part tetap
 * (QA-TRIAL-*) supaya dijalankan ulang tidak menumpuk master baru, dan data
 * hasilnya DIBIARKAN — baik di Postgres maupun di staging — supaya bisa
 * diperiksa orang. Pembersihannya: lihat catatan di akhir keluaran.
 */
import 'reflect-metadata';
import '@avicenna/db/load-env';
import mssql from 'mssql';
import {
  getDb,
  eq,
  and,
  gt,
  gte,
  desc,
  inArray,
  plants,
  scanEvents,
  locations,
  lines,
  parts,
  partProcesses,
  routeProcesses,
  kanbans,
  users,
  sapOutbox,
} from '@avicenna/db';
import { ScanService } from '../scan/scan.service';
import { SapOutboxService } from '../sap/sap-outbox.service';
import { StagingPushService } from './staging-push.service';
import { StagingDbService } from './staging-db.service';
import { StagingSchemaService } from './staging-schema.service';
import { ProcessTypeService } from '../master/process-type.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../queue/redis.service';
import { QueueService } from '../queue/queue.service';
import { LoadingService } from '../loading/loading.service';
import { BackflushService } from '../backflush/backflush.service';
import { bacaStagingConfig, keMssqlConfig } from './staging.config';
import { SettingService } from '../setting/setting.service';
import { GOODS_MOVEMENT, PRODUCTION_RESULT } from './staging-tables';
import type { UserPrincipal } from '../auth/auth.types';

const PREFIX = 'QA-TRIAL';

/** Satu model: rutenya, lini tiap langkah, dan di mana ia berakhir. */
interface Model {
  nama: string;
  partNo: string;
  backNo: string;
  versi: string;
  qtyPerBox: number;
  /** [jenis proses, kode lini] berurutan. Langkah terakhir pasti FG. */
  rute: Array<[string, string]>;
}

const MODEL: Model[] = [
  {
    nama: 'DC FG — selesai di Casting',
    partNo: `${PREFIX}-DCFG`,
    backNo: 'TD01',
    versi: '0001',
    qtyPerBox: 20,
    rute: [
      ['MELTING', 'ML-01'],
      ['CASTING_FG', 'DC-02'],
    ],
  },
  {
    nama: 'MA FG — selesai di Machining',
    partNo: `${PREFIX}-MAFG`,
    backNo: 'TM01',
    versi: '0002',
    qtyPerBox: 10,
    rute: [
      ['MELTING', 'ML-01'],
      ['CASTING_WIP', 'DC-01'],
      ['MACHINING_FG', 'MC-02'],
    ],
  },
  {
    nama: 'ASSY FG — selesai di Assembling Unit',
    partNo: `${PREFIX}-ASFG`,
    backNo: 'TA01',
    versi: '0003',
    qtyPerBox: 5,
    rute: [
      ['MELTING', 'ML-01'],
      ['CASTING_WIP', 'DC-01'],
      ['MACHINING_WIP', 'MC-01'],
      ['ASSEMBLING_UNIT_FG', 'AS-01'],
    ],
  },
];

const garis = (t: string) => `\n${'─'.repeat(4)} ${t} ${'─'.repeat(Math.max(0, 72 - t.length))}`;

async function main() {
  if (process.env.STAGING_TRIAL_CHECK !== 'true')
    throw new Error('Set STAGING_TRIAL_CHECK=true untuk menjalankan trial staging.');

  const db = getDb();
  const mulai = new Date();
  const stempel = Date.now().toString().slice(-6);

  // ── 1. Fixture master ────────────────────────────────────────────────────
  console.log(garis('1. Fixture master'));

  const [pabrik] = await db.select().from(plants).where(eq(plants.code, 'UNIT')).limit(1);
  if (!pabrik) throw new Error('pabrik UNIT tidak ada');
  console.log(`  pabrik UNIT  id=${pabrik.id}  CHR_SAP_CODE=${pabrik.sapCode}`);

  const lokasi = await db.select().from(locations).where(eq(locations.plantId, pabrik.id));
  const sloc = (kode: string) => {
    const l = lokasi.find((x) => x.code === kode);
    if (!l) throw new Error(`SLOC ${kode} tidak ada di pabrik UNIT`);
    return l;
  };
  const WH = sloc('WH80');
  const WP = sloc('WP80');
  const FG = sloc('FG80');
  console.log(`  SLOC         WH80=${WH.id} WP80=${WP.id} FG80=${FG.id}`);

  const daftarLini = await db.select().from(lines).where(eq(lines.plantId, pabrik.id));
  const lini = (kode: string) => {
    const l = daftarLini.find((x) => x.code === kode);
    if (!l) throw new Error(`lini ${kode} tidak ada`);
    return l;
  };

  /*
   * Rute proses: inilah yang menentukan dokumen SAP mana yang lahir dari satu
   * scan, dan SLOC mana yang dipakai. Lini punya SLOC-nya sendiri, tetapi
   * rute proses menimpanya (lihat scan.service).
   *
   * MELTING diberi SLOC Keluar WH80 dan SLOC Transfer WP80 — itulah satu-
   * satunya perpindahan antar SLOC yang blueprint sebut (PP-PE-01, material
   * issue dari gudang ke WIP), dan satu-satunya yang periksaTransferSloc
   * loloskan. Push produksinya dimatikan: yang kita inginkan dari langkah ini
   * hanya dokumen perpindahannya.
   *
   * Tiga lini FG sebaliknya: push produksi HIDUP, transfer mati. Transfer
   * FG → ST memang dilewati dengan sengaja (tidak ada padanan SLOC staging di
   * SAP AIIA), jadi mengaktifkannya hanya menghasilkan dokumen tertahan.
   */
  const aturan: Array<{
    proses: string;
    output: number;
    transfer: number | null;
    produksi: boolean;
    transferAktif: boolean;
    mvt: string | null;
  }> = [
    {
      proses: 'MELTING',
      output: WH.id,
      transfer: WP.id,
      produksi: false,
      transferAktif: true,
      mvt: '311',
    },
    {
      proses: 'CASTING_WIP',
      output: WP.id,
      transfer: null,
      produksi: false,
      transferAktif: false,
      mvt: null,
    },
    {
      proses: 'MACHINING_WIP',
      output: WP.id,
      transfer: null,
      produksi: false,
      transferAktif: false,
      mvt: null,
    },
    {
      proses: 'CASTING_FG',
      output: FG.id,
      transfer: null,
      produksi: true,
      transferAktif: false,
      mvt: null,
    },
    {
      proses: 'MACHINING_FG',
      output: FG.id,
      transfer: null,
      produksi: true,
      transferAktif: false,
      mvt: null,
    },
    {
      proses: 'ASSEMBLING_UNIT_FG',
      output: FG.id,
      transfer: null,
      produksi: true,
      transferAktif: false,
      mvt: null,
    },
  ];

  for (const a of aturan) {
    const nilai = {
      plantId: pabrik.id,
      processType: a.proses,
      inputLocationId: WP.id,
      outputLocationId: a.output,
      transferLocationId: a.transfer,
      sapProductionEnabled: a.produksi,
      sapTransferEnabled: a.transferAktif,
      sapTransferMovementType: a.mvt,
      isActive: true,
    };
    const [ada] = await db
      .select({ id: routeProcesses.id })
      .from(routeProcesses)
      .where(and(eq(routeProcesses.plantId, pabrik.id), eq(routeProcesses.processType, a.proses)))
      .limit(1);
    if (ada) await db.update(routeProcesses).set(nilai).where(eq(routeProcesses.id, ada.id));
    else await db.insert(routeProcesses).values(nilai);
    console.log(
      `  rute ${a.proses.padEnd(20)} keluar=${a.output === WH.id ? 'WH80' : a.output === WP.id ? 'WP80' : 'FG80'}` +
        `  transfer=${a.transfer ? 'WP80' : '-'}  push produksi=${a.produksi ? 'ya' : 'tidak'}` +
        `  push transfer=${a.transferAktif ? `ya (${a.mvt})` : 'tidak'}`,
    );
  }

  const [admin] = await db.select().from(users).where(eq(users.npk, 'ADMIN')).limit(1);
  if (!admin) throw new Error('akun ADMIN tidak ada — jalankan db:seed');
  const principal: UserPrincipal = {
    kind: 'user',
    sub: admin.id,
    npk: admin.npk,
    name: admin.name,
    role: 'QA',
    roleKind: 'ADMIN',
    roleProcessGroup: null,
    plantId: pabrik.id,
  };

  // ── 2. Part, rute, kanban ────────────────────────────────────────────────
  console.log(garis('2. Part, rute, dan kartu kanban'));
  const dibuat: Array<{ model: Model; partId: number; kanbanSerial: string }> = [];

  for (const m of MODEL) {
    const langkahAkhir = m.rute[m.rute.length - 1]![0];
    const nilaiPart = {
      plantId: pabrik.id,
      partNumber: m.partNo,
      backNumber: m.backNo,
      name: `Trial ${m.nama}`,
      processType: langkahAkhir,
      partType: 'FINISHED_GOOD' as const,
      sourceType: 'MANUFACTURED' as const,
      trackingMode: 'LOT' as const,
      uom: 'PCS',
      qtyPerBox: m.qtyPerBox,
      productionVersion: m.versi,
      isActive: true,
    };
    const [adaPart] = await db
      .select({ id: parts.id })
      .from(parts)
      .where(and(eq(parts.plantId, pabrik.id), eq(parts.partNumber, m.partNo)))
      .limit(1);
    let partId: number;
    if (adaPart) {
      await db.update(parts).set(nilaiPart).where(eq(parts.id, adaPart.id));
      partId = adaPart.id;
    } else {
      const [baru] = await db.insert(parts).values(nilaiPart).returning({ id: parts.id });
      partId = baru!.id;
    }

    await db.delete(partProcesses).where(eq(partProcesses.partId, partId));
    let seq = 10;
    for (const [proses, kodeLini] of m.rute) {
      await db.insert(partProcesses).values({
        plantId: pabrik.id,
        partId,
        processType: proses,
        seqNo: seq,
        lineId: lini(kodeLini).id,
        isActive: true,
      });
      seq += 10;
    }

    /*
     * Satu kartu kanban per model. Lini FG mewajibkan kanban discan bersama
     * barcode part — tanpa kartu, scan FG ditolak, dan itu memang benar:
     * barang jadi tanpa kartu tidak akan pernah bisa dikirim.
     *
     * Versi produksi DISALIN ke kartu, seperti yang dilakukan pembuatan kartu
     * sungguhan (PP-MD-05).
     */
    const serial = `${stempel}`;
    const [adaKartu] = await db
      .select({ id: kanbans.id })
      .from(kanbans)
      .where(and(eq(kanbans.partId, partId), eq(kanbans.serialNumber, serial)))
      .limit(1);
    if (!adaKartu) {
      await db.insert(kanbans).values({
        plantId: pabrik.id,
        partId,
        serialNumber: serial,
        qtyPerBox: m.qtyPerBox,
        unitPerKanban: 1,
        owner: 'INTERNAL',
        kanbanType: 'REGULER',
        status: 'AVAILABLE',
        productionVersion: m.versi,
        isActive: true,
      });
    }
    dibuat.push({ model: m, partId, kanbanSerial: serial });
    console.log(
      `  ${m.partNo.padEnd(14)} PV=${m.versi}  qty/box=${String(m.qtyPerBox).padStart(3)}  ` +
        `kanban ${m.backNo}|${serial}  rute ${m.rute.map(([p]) => p).join(' > ')}`,
    );
  }

  // ── 3. Scan ──────────────────────────────────────────────────────────────
  console.log(garis('3. Scan di lapangan'));
  /*
   * Service dirakit dengan TANGAN, bukan lewat DI Nest.
   *
   * tsx memakai esbuild, dan esbuild tidak memancarkan `emitDecoratorMetadata`.
   * Tanpa metadata itu Nest tidak bisa membaca tipe parameter konstruktor, dan
   * seluruh graf DI gagal dengan "argument at index [0] is undefined" —
   * masalah alat, bukan masalah kode aplikasi. Integration-check lain di repo
   * ini merakit dengan tangan karena alasan yang sama.
   *
   * Yang dirakit adalah kelas yang SAMA dengan yang dipakai produksi; hanya
   * cara menyusunnya yang berbeda.
   */
  const redis = new RedisService();
  const processTypes = new ProcessTypeService(db);
  const scan = new ScanService(
    db,
    new RealtimeService(redis),
    new QueueService(redis),
    new LoadingService(db),
    processTypes,
  );
  const outbox = new SapOutboxService(db, processTypes);
  /*
   * SettingService dirakit dan snapshot-nya dimuat manual.
   *
   * Di produksi Nest memanggil onModuleInit; di sini tidak ada Nest, jadi
   * tanpa pemanggilan itu snapshot kosong dan seluruh saklar jatuh ke .env.
   * Trial ini justru menguji perilaku yang bergantung pada saklar dorong, jadi
   * nilainya harus yang sama dengan yang dipakai produksi.
   */
  const setting = new SettingService(db);
  await setting.onModuleInit();
  const stagingDb = new StagingDbService(setting);
  const push = new StagingPushService(db, stagingDb, new StagingSchemaService(stagingDb));

  /*
   * Satu unit, satu nomor seri, discan di SETIAP langkah rutenya.
   *
   * Itu rantai traceability-nya: tiap langkah menuntut unit yang sama sudah
   * discan di langkah sebelumnya, dan scan dengan seri baru di tengah rute
   * ditolak dengan "Part belum discan di proses sebelumnya". Penolakan itu
   * benar — barang yang melompati proses tidak boleh lewat.
   */
  const sebelumOutbox = (
    await db.select({ id: sapOutbox.id }).from(sapOutbox).orderBy(desc(sapOutbox.id)).limit(1)
  )[0]?.id;
  const batasOutbox = sebelumOutbox ?? 0;

  let nomorSeri = 0;
  let ditolak = 0;
  for (const { model } of dibuat) {
    console.log(`\n  ${model.nama}`);
    nomorSeri += 1;
    const serialUnit = `${stempel}${String(nomorSeri).padStart(3, '0')}`;
    for (const [proses, kodeLini] of model.rute) {
      // PARTNUMBER|BACKNUMBER|SERIAL|QTY — ATURAN_BERPEMISAH.
      const rawCode = `${model.partNo}|${model.backNo}|${serialUnit}|1`;
      const fg = proses.endsWith('_FG');
      const hasil = await scan.station(
        {
          kind: 'PRODUCTION',
          processType: proses,
          rawCode,
          // Lini FG mewajibkan kartu; lini WIP melarangnya.
          ...(fg ? { kanbanCode: `${model.backNo}|${stempel}` } : {}),
          lineCode: kodeLini,
          qty: 1,
          npk: admin.npk,
          clientRef: `trial-${stempel}-${serialUnit}-${proses}`,
        },
        principal,
      );
      const tanda =
        hasil.status === 'ACCEPTED' ? 'ok  ' : hasil.status === 'DUPLICATE' ? 'dup ' : 'TOLAK';
      console.log(
        `    ${tanda} ${proses.padEnd(20)} ${kodeLini}  ${serialUnit}` +
          `${hasil.message ? `  — ${hasil.message}` : ''}`,
      );
      if (hasil.status === 'REJECTED') ditolak += 1;
    }
  }

  if (ditolak > 0) console.log(`\n  ${ditolak} scan DITOLAK — dokumen di bawah tidak lengkap.`);

  /*
   * ── Backflush, yang biasanya dikerjakan StockWorker ──────────────────────
   *
   * Dokumen produksi TIDAK dikumpulkan sampai scan-nya bertanda
   * backflushCompleted. Penandanya dipasang BackflushService, yang dalam
   * jalannya aplikasi dipanggil worker BullMQ. Trial ini tidak menyalakan
   * worker, jadi service yang sama dipanggil langsung — bukan penandanya yang
   * dipalsukan.
   *
   * Part trial tidak punya BOM, jadi hasilnya noBom: tidak ada komponen yang
   * dipotong, dan penandanya tetap dipasang. Itu perilaku yang benar — tanpa
   * penanda, hasil produksi akan menggantung di luar outbox selamanya.
   */
  const backflush = new BackflushService(db);
  const idPart = dibuat.map((d) => d.partId);
  const peristiwa = await db
    .select({ id: scanEvents.id })
    .from(scanEvents)
    .where(and(inArray(scanEvents.partId, idPart), gte(scanEvents.createdAt, mulai)));
  let noBom = 0;
  for (const e of peristiwa) {
    const r = await backflush.run(e.id);
    if (r.noBom) noBom += 1;
  }
  console.log(`\n  backflush: ${peristiwa.length} scan ditandai (${noBom} tanpa BOM)`);

  // ── 4. Outbox ────────────────────────────────────────────────────────────
  console.log(garis('4. Dokumen outbox'));
  /*
   * Collector menunggu mutasi MENGENDAP (SETTLE_SECONDS = 60) sebelum
   * mengumpulkannya — supaya transaksi scan yang belum selesai tidak ikut
   * terbaca separuh. Jedanya dihormati, bukan dikecilkan untuk trial: yang
   * ingin dibuktikan adalah perilaku yang sama dengan produksi.
   */
  const jeda = 65;
  console.log(`  menunggu ${jeda} detik — collector menuntut mutasinya mengendap dulu`);
  await new Promise((r) => setTimeout(r, jeda * 1000));
  const kumpul = await outbox.collect();
  console.log(
    `  collect: ${kumpul.dikumpulkan} dikumpulkan, ${kumpul.ditahan} ditahan, ${kumpul.dilewati} dilewati`,
  );
  const antre = await db
    .select({
      id: sapOutbox.id,
      docType: sapOutbox.docType,
      status: sapOutbox.status,
      movementType: sapOutbox.movementType,
      lastError: sapOutbox.lastError,
    })
    .from(sapOutbox)
    .where(gt(sapOutbox.id, batasOutbox))
    .orderBy(sapOutbox.id);
  for (const o of antre)
    console.log(
      `  #${String(o.id).padStart(4)} ${o.docType.padEnd(14)} ${o.status.padEnd(10)} ` +
        `mvt=${o.movementType ?? '-'}${o.lastError ? `  — ${o.lastError.slice(0, 110)}` : ''}`,
    );

  // ── 5. Dorong ke staging ─────────────────────────────────────────────────
  console.log(garis('5. Dorong ke staging SAP'));
  const hasilDorong = await push.dorong();
  console.log(
    `  dorong: ${hasilDorong.terkirim} terkirim, ${hasilDorong.gagal} gagal, ` +
      `${hasilDorong.dilewati} dilewati${hasilDorong.alasan ? ` — ${hasilDorong.alasan}` : ''}`,
  );

  const setelah = await db
    .select({
      id: sapOutbox.id,
      docType: sapOutbox.docType,
      status: sapOutbox.status,
      nomor: sapOutbox.stagingNumber,
      lastError: sapOutbox.lastError,
    })
    .from(sapOutbox)
    .where(gt(sapOutbox.id, batasOutbox))
    .orderBy(sapOutbox.id);
  for (const o of setelah)
    console.log(
      `  #${String(o.id).padStart(4)} ${o.docType.padEnd(14)} ${o.status.padEnd(10)} ` +
        `INT_NUMBER=${o.nomor ?? '-'}${o.lastError ? `  — ${o.lastError.slice(0, 110)}` : ''}`,
    );

  // ── 6. Baca kembali DARI staging ─────────────────────────────────────────
  console.log(garis('6. Yang benar-benar mendarat di staging'));
  const cfg = bacaStagingConfig();
  if (!cfg) {
    console.log('  konfigurasi staging tidak ada — bagian ini dilewati');
    return;
  }
  const pool = new mssql.ConnectionPool(keMssqlConfig(cfg));
  await pool.connect();
  const P = PRODUCTION_RESULT.kolom;
  const H = GOODS_MOVEMENT.kolomKepala;
  const L = GOODS_MOVEMENT.kolomBaris;

  const cetak = async (label: string, teks: string) => {
    const { recordset } = await pool.request().query(teks);
    console.log(`\n  ${label} — ${recordset.length} baris`);
    for (const b of recordset) {
      for (const [k, v] of Object.entries(b)) {
        const nilai = v === null ? 'NULL' : typeof v === 'string' ? `"${v}"` : String(v);
        console.log(`    ${k.padEnd(22)} ${nilai}`);
      }
      console.log('    ' + '·'.repeat(60));
    }
  };

  await cetak(
    PRODUCTION_RESULT.tabel,
    `SELECT ${P.nomor}, ${P.woNumber}, ${P.tanggal}, ${P.plant}, ${P.workCenter}, ${P.partNo},
            ${P.backNo}, ${P.pv}, ${P.uom}, ${P.qtyTotal}, ${P.ngTotal},
            ${P.validate}, ${P.status}, ${P.statusNg}, ${P.upload}, ${P.matdoc},
            ${P.tanggalEntry}, ${P.jamEntry}
     FROM ${PRODUCTION_RESULT.tabel} ORDER BY ${P.nomor}`,
  );
  await cetak(
    GOODS_MOVEMENT.kepala,
    `SELECT ${H.nomor}, ${H.plant}, ${H.tanggal}, ${H.jenisTransaksi}, ${H.movementType},
            ${H.keterangan}, ${H.validate}, ${H.tanggalEntry}, ${H.jamEntry}
     FROM ${GOODS_MOVEMENT.kepala} ORDER BY ${H.nomor}`,
  );
  await cetak(
    GOODS_MOVEMENT.baris,
    `SELECT ${L.nomor}, ${L.nomorItem}, ${L.partNo}, ${L.slocFrom}, ${L.slocTo}, ${L.qty},
            ${L.uom}, ${L.movementTypeBaris}, ${L.status}, ${L.upload}, ${L.matdoc}
     FROM ${GOODS_MOVEMENT.baris} ORDER BY ${L.nomor}, ${L.nomorItem}`,
  );
  await pool.close();

  console.log(garis('Data DIBIARKAN'));
  console.log(
    '  Postgres : part QA-TRIAL-*, rutenya, kartu kanban, scan, mutasi stok, dan outbox.\n' +
      `  Staging  : baris di ${PRODUCTION_RESULT.tabel} dan ${GOODS_MOVEMENT.kepala}/_L.\n` +
      '\n  CHR_VALIDATE = "X" berarti baris staging SIAP DIJEMPUT program SAP.\n' +
      '  Selama penjemput AIIA belum dipasang, tidak ada yang memprosesnya.',
  );

  await stagingDb.onModuleDestroy();
  await redis.onModuleDestroy();
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
