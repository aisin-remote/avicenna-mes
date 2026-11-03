import './load-env';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { lines, parts, partProcesses, routeProcesses } from './schema/master';
import { plants } from './schema/org';
import { partPairings } from './schema/supply';
import { kanbans, kanbanPairings, KANBAN_STATUSES } from './schema/kanban';

/**
 * Rantai part BODY lengkap supaya stasiun Belanja bisa dicoba.
 *
 * Pabrik BODY di database pengembangan hanya punya satu part dan Part Pairing-nya
 * kosong, jadi belanja tidak punya apa pun untuk dicocokkan: layar akan
 * menolak setiap kartu dengan "part ini tidak punya komponen berkartu".
 *
 * ── Kenapa skrip terpisah, bukan bagian db:seed ─────────────────────────────
 *
 * Master part BODY yang sungguhan datang dari Gentani, dan belum diimpor.
 * Menaruh rantai karangan ini di seed utama berarti setiap lingkungan baru
 * mendapat part yang kelihatan sah, lalu bercampur dengan part Gentani tanpa
 * bisa dibedakan lagi.
 *
 * Nomornya karena itu memakai BENTUK Gentani tetapi angka yang tidak mungkin
 * dipakai AISIN (`219999…`), dan semuanya ditandai project 'TRIAL-BELANJA'.
 * Satu kueri sudah cukup untuk menemukan dan membuangnya kembali.
 *
 *   pnpm --filter @avicenna/db db:seed-belanja-trial
 *   pnpm --filter @avicenna/db db:seed-belanja-trial --hapus
 *
 * ── Rantainya ───────────────────────────────────────────────────────────────
 *
 * Mengikuti konvensi Gentani: SUFIKS nomor part adalah tahap prosesnya, dan
 * tiap tahap berdiri sebagai part sendiri dengan satu proses.
 *
 *   21999934300           assy FG (tanpa sufiks)        20/box
 *     ├─ 21999934300BLK   painting WIP (sufiks warna)   20/box   ×1
 *     ├─ 21999934305BLK   painting WIP, bracket         40/box   ×2
 *     └─ W0999-00001        baut, DIBELI                           ×4
 *   21999934300BLK      ← 2199993430011  injection WIP 20/box  ×1
 *   21999934305BLK      ← 2199993430511  injection WIP 40/box  ×1
 *
 * Angkanya disusun supaya belanja PAS tanpa sisa — belanja menuntut jumlah
 * yang tepat, bukan "cukup". Satu box assy (20) butuh 20 cover (1 kartu 20/box)
 * dan 40 bracket (1 kartu 40/box).
 *
 * Baut ikut masuk pasangan dengan sengaja: ia DIBELI, jadi belanja harus
 * melewatinya. Part beli datang lewat kartu ARES di Scan Komponen, tidak punya
 * kartu WIP untuk ditembak, dan tanpa penyaring itu belanja mustahil
 * diselesaikan.
 */

/** Semua part trial memakai ini — satu penanda untuk mencari dan membuang. */
const PROJECT = 'TRIAL-BELANJA';

interface PolaPart {
  partNumber: string;
  name: string;
  backNumber: string | null;
  processType: string;
  /** Kode lini tempat part ini dikerjakan; null untuk part beli. */
  lineCode: string | null;
  partType: 'COMPONENT' | 'WIP' | 'FINISHED_GOOD';
  sourceType: 'PURCHASED' | 'MANUFACTURED';
  qtyPerBox: number | null;
}

const POLA_PART: PolaPart[] = [
  {
    partNumber: '21999934300',
    name: 'TRIAL COVER ASSY BODY LH',
    backNumber: 'TB10',
    processType: 'ASSEMBLING_BODY_FG',
    lineCode: 'AS-02',
    partType: 'FINISHED_GOOD',
    sourceType: 'MANUFACTURED',
    qtyPerBox: 20,
  },
  {
    partNumber: '21999934300BLK',
    name: 'TRIAL COVER BODY LH - PAINTED BLACK',
    backNumber: 'TB11',
    processType: 'PAINTING_WIP',
    lineCode: 'PT-01',
    partType: 'WIP',
    sourceType: 'MANUFACTURED',
    qtyPerBox: 20,
  },
  {
    partNumber: '2199993430011',
    name: 'TRIAL COVER BODY LH - INJECTION',
    backNumber: 'TB12',
    processType: 'INJECTION_WIP',
    lineCode: 'INJ-01',
    partType: 'WIP',
    sourceType: 'MANUFACTURED',
    qtyPerBox: 20,
  },
  {
    partNumber: '21999934305BLK',
    name: 'TRIAL BRACKET CLIP - PAINTED BLACK',
    backNumber: 'TB13',
    processType: 'PAINTING_WIP',
    lineCode: 'PT-01',
    partType: 'WIP',
    sourceType: 'MANUFACTURED',
    qtyPerBox: 40,
  },
  {
    partNumber: '2199993430511',
    name: 'TRIAL BRACKET CLIP - INJECTION',
    backNumber: 'TB14',
    processType: 'INJECTION_WIP',
    lineCode: 'INJ-01',
    partType: 'WIP',
    sourceType: 'MANUFACTURED',
    qtyPerBox: 40,
  },
  {
    /*
     * Part beli: tanpa lini, tanpa isi box, dan prosesnya adalah proses yang
     * MEMAKAINYA — sama seperti part beli yang sudah ada di UNIT.
     */
    partNumber: 'W0999-00001',
    name: 'TRIAL SCREW TAPPING M5',
    backNumber: null,
    processType: 'ASSEMBLING_BODY_FG',
    lineCode: null,
    partType: 'COMPONENT',
    sourceType: 'PURCHASED',
    qtyPerBox: null,
  },
];

const POLA_PASANGAN: Array<{ induk: string; komponen: string; qtyPer: string }> = [
  { induk: '21999934300', komponen: '21999934300BLK', qtyPer: '1' },
  { induk: '21999934300', komponen: '21999934305BLK', qtyPer: '2' },
  { induk: '21999934300', komponen: 'W0999-00001', qtyPer: '4' },
  { induk: '21999934300BLK', komponen: '2199993430011', qtyPer: '1' },
  { induk: '21999934305BLK', komponen: '2199993430511', qtyPer: '1' },
];

/**
 * Kartu beserta status AWALNYA.
 *
 * Statusnya bukan hiasan — belanja hanya menerima kartu induk AVAILABLE dan
 * kartu box PRODUCED, jadi inilah yang menentukan dari tingkat mana trial bisa
 * dimulai. Kartu painting disiapkan di KEDUA status karena satu kartu tidak
 * bisa sekaligus jadi induk di painting dan box di assy — itu justru inti
 * interlocknya.
 */
const POLA_KARTU: Array<{
  partNumber: string;
  seri: string[];
  status: (typeof KANBAN_STATUSES)[number];
}> = [
  { partNumber: '21999934300', seri: ['0001', '0002', '0003', '0004'], status: 'AVAILABLE' },
  { partNumber: '21999934300BLK', seri: ['0001', '0002'], status: 'PRODUCED' },
  { partNumber: '21999934300BLK', seri: ['0003', '0004'], status: 'AVAILABLE' },
  { partNumber: '21999934305BLK', seri: ['0001', '0002'], status: 'PRODUCED' },
  { partNumber: '21999934305BLK', seri: ['0003', '0004'], status: 'AVAILABLE' },
  { partNumber: '2199993430011', seri: ['0001', '0002', '0003', '0004'], status: 'PRODUCED' },
  { partNumber: '2199993430511', seri: ['0001', '0002', '0003', '0004'], status: 'PRODUCED' },
];

/**
 * Proses BODY yang dinyalakan Wajib Belanja-nya.
 *
 * Tanpa ini stasiun Belanja tidak menampilkan area BODY sama sekali — daftar
 * areanya memang disusun dari proses yang berbendera ini — dan scan produksi
 * tidak akan menolak kartu yang belum belanja, jadi interlocknya tidak terasa.
 *
 * Hanya BODY. UNIT dan ELEC tidak disentuh.
 */
const PROSES_WAJIB_BELANJA = ['ASSEMBLING_BODY_FG', 'PAINTING_WIP'];

function hariIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Data trial hanya untuk database lokal.');
  }
  const hapus = process.argv.includes('--hapus');

  const db = getDb();
  const [pabrik] = await db
    .select({ id: plants.id, code: plants.code })
    .from(plants)
    .where(eq(plants.code, 'BODY'))
    .limit(1);
  if (!pabrik) throw new Error('Pabrik BODY tidak ada di master.');

  if (hapus) {
    await bersihkan(db, pabrik.id);
    await closeDb();
    return;
  }

  /* ── Lini ───────────────────────────────────────────────────────────────── */
  const kodeLini = [...new Set(POLA_PART.map((p) => p.lineCode).filter((v): v is string => !!v))];
  const liniAda = await db
    .select({ id: lines.id, code: lines.code })
    .from(lines)
    .where(and(eq(lines.plantId, pabrik.id), inArray(lines.code, kodeLini)));
  const petaLini = new Map(liniAda.map((l) => [l.code, l.id]));
  const liniHilang = kodeLini.filter((k) => !petaLini.has(k));
  if (liniHilang.length) {
    throw new Error(`Lini BODY belum ada: ${liniHilang.join(', ')}. Jalankan db:seed dulu.`);
  }

  /* ── Part ───────────────────────────────────────────────────────────────── */
  for (const p of POLA_PART) {
    const nilai = {
      plantId: pabrik.id,
      lineId: p.lineCode ? (petaLini.get(p.lineCode) ?? null) : null,
      partNumber: p.partNumber,
      backNumber: p.backNumber,
      project: PROJECT,
      name: p.name,
      processType: p.processType,
      partType: p.partType,
      sourceType: p.sourceType,
      /*
       * QUANTITY, bukan SERIAL: barang di BODY tidak berseri satuan — yang
       * dihitung adalah isi box, dan kartunya yang membawa jumlahnya.
       */
      trackingMode: 'QUANTITY' as const,
      qtyPerKanban: p.qtyPerBox,
      isActive: true,
    };
    await db
      .insert(parts)
      .values(nilai)
      .onConflictDoUpdate({ target: [parts.plantId, parts.partNumber], set: nilai });
  }

  const partTrial = await db
    .select({ id: parts.id, partNumber: parts.partNumber, processType: parts.processType })
    .from(parts)
    .where(and(eq(parts.plantId, pabrik.id), eq(parts.project, PROJECT)));
  const petaPart = new Map(partTrial.map((p) => [p.partNumber, p.id]));

  /* ── Rute per part: satu part, satu proses ──────────────────────────────── */
  for (const p of POLA_PART) {
    if (!p.lineCode) continue; // part beli tidak diproduksi di sini
    const partId = petaPart.get(p.partNumber)!;
    await db
      .insert(partProcesses)
      .values({
        plantId: pabrik.id,
        partId,
        processType: p.processType,
        seqNo: 10,
        lineId: petaLini.get(p.lineCode)!,
        isActive: true,
      })
      .onConflictDoNothing({ target: [partProcesses.partId, partProcesses.processType] });
  }

  /* ── Part Pairing ────────────────────────────────────────────────────────────────── */
  /*
   * TM_PART_PAIRING tidak punya unique index, jadi barisnya dicari dulu. Menyisipkan
   * buta akan menggandakan kebutuhan setiap kali skrip dijalankan ulang — dan
   * belanja lalu menuntut dua kali lipat tanpa sebab yang kelihatan.
   */
  const pasanganAda = await db
    .select({ induk: partPairings.parentPartId, komponen: partPairings.componentPartId })
    .from(partPairings)
    .where(eq(partPairings.plantId, pabrik.id));
  const kunciPasangan = new Set(pasanganAda.map((b) => `${b.induk}:${b.komponen}`));

  let pasanganBaru = 0;
  for (const [i, b] of POLA_PASANGAN.entries()) {
    const induk = petaPart.get(b.induk)!;
    const komponen = petaPart.get(b.komponen)!;
    if (kunciPasangan.has(`${induk}:${komponen}`)) continue;
    await db.insert(partPairings).values({
      plantId: pabrik.id,
      parentPartId: induk,
      componentPartId: komponen,
      qtyPer: b.qtyPer,
      uom: 'pcs',
      sequence: (i + 1) * 10,
      effectiveFrom: '2026-01-01',
      note: PROJECT,
    });
    pasanganBaru += 1;
  }

  /* ── Kartu kanban ───────────────────────────────────────────────────────── */
  const sekarang = new Date();
  let kartuBaru = 0;
  for (const pola of POLA_KARTU) {
    const partId = petaPart.get(pola.partNumber)!;
    const isiBox = POLA_PART.find((p) => p.partNumber === pola.partNumber)!.qtyPerBox!;
    for (const seri of pola.seri) {
      const nilai = {
        plantId: pabrik.id,
        partId,
        serialNumber: seri,
        qtyPerBox: isiBox,
        /*
         * unitPerKanban disamakan dengan isi box: di mode per-kanban angka ini
         * tidak dipakai, tetapi kartu yang menyebut dua jumlah berbeda akan
         * menyesatkan siapa pun yang membacanya nanti.
         */
        unitPerKanban: isiBox,
        owner: 'INTERNAL' as const,
        status: pola.status,
        /* PRODUCED berarti box-nya sudah diisi di lini: waktunya harus ada. */
        producedAt: pola.status === 'PRODUCED' ? sekarang : null,
        releasedAt: pola.status === 'AVAILABLE' ? sekarang : null,
        cycleCount: 0,
        isActive: true,
      };
      const hasil = await db
        .insert(kanbans)
        .values(nilai)
        .onConflictDoUpdate({ target: [kanbans.partId, kanbans.serialNumber], set: nilai })
        .returning({ id: kanbans.id });
      if (hasil.length) kartuBaru += 1;
    }
  }

  /*
   * Pasangan belanja dari percobaan sebelumnya dibuang.
   *
   * Statusnya baru saja dikembalikan ke keadaan awal di atas; pasangan yang
   * tertinggal akan membuat kartu tampak "sudah dibelanjakan" padahal
   * statusnya bilang sebaliknya, dan scan produksi menolak dengan alasan yang
   * tidak cocok dengan apa pun di layar.
   */
  const idKartu = (
    await db
      .select({ id: kanbans.id })
      .from(kanbans)
      .where(inArray(kanbans.partId, [...petaPart.values()]))
  ).map((k) => k.id);
  if (idKartu.length) {
    await db.delete(kanbanPairings).where(inArray(kanbanPairings.fgKanbanId, idKartu));
    await db.delete(kanbanPairings).where(inArray(kanbanPairings.wipKanbanId, idKartu));
  }

  /* ── Wajib Belanja ──────────────────────────────────────────────────────── */
  const dinyalakan: string[] = [];
  for (const proses of PROSES_WAJIB_BELANJA) {
    const hasil = await db
      .update(routeProcesses)
      .set({ requirePairing: true })
      .where(and(eq(routeProcesses.plantId, pabrik.id), eq(routeProcesses.processType, proses)))
      .returning({ proses: routeProcesses.processType });
    if (hasil.length) dinyalakan.push(proses);
    else console.warn(`[belanja-trial] rute BODY/${proses} tidak ada — bendera dilewati`);
  }

  console.log(`\n[belanja-trial] pabrik BODY, project ${PROJECT}, berlaku ${hariIni()}`);
  console.log(`  part        : ${POLA_PART.length} (dibuat/diperbarui)`);
  console.log(`  pasangan    : ${POLA_PASANGAN.length} baris (${pasanganBaru} baru)`);
  console.log(`  kartu kanban: ${idKartu.length} (status dikembalikan ke keadaan awal)`);
  console.log(`  Wajib Belanja NYALA di BODY: ${dinyalakan.join(', ') || '(tidak ada)'}`);
  console.log(`
  Coba belanja di tingkat ASSY:
    1. buka /belanja, pilih area BODY
    2. tembak kartu induk  TB10|0001   (assy FG, 20/box, AVAILABLE)
    3. tembak kartu box    TB11|0001   (cover painted, 20/box, PRODUCED)
    4. tembak kartu box    TB13|0001   (bracket painted, 40/box, PRODUCED)
       -> 20/20 dan 40/40, PAS, tombol SIMPAN menyala
    5. simpan: kartu assy jadi SHOPPED, kedua kartu painting kembali AVAILABLE

  Coba belanja di tingkat PAINTING (kartu painting yang AVAILABLE):
    induk TB11|0003 + box TB12|0001        (cover: butuh 20, kartu 20/box)
    induk TB13|0003 + box TB14|0001        (bracket: butuh 40, kartu 40/box)

  Yang sengaja bisa gagal, untuk dicoba juga:
    - tembak kartu box yang sama dua kali           -> ditolak "sudah ditembak"
    - tembak TB11|0001 + TB11|0002 (40 dari 20)     -> "lebih 20", SIMPAN mati
    - scan produksi assy TB10|0002 sebelum belanja  -> ditolak, belum belanja
    - baut W0999-00001 TIDAK diminta belanja: ia dibeli, datang lewat ARES

  Kartunya bisa dicetak sungguhan di /produksi/kanban (seri 1-4 sudah ada,
  jadi tidak akan dibuat baris baru), lalu QR-nya discan di stasiun.

  Membuang semuanya: db:seed-belanja-trial --hapus\n`);
}

/** Membuang seluruh jejak trial, termasuk mengembalikan bendera Wajib Belanja. */
async function bersihkan(db: ReturnType<typeof getDb>, plantId: number) {
  const partTrial = await db
    .select({ id: parts.id, partNumber: parts.partNumber })
    .from(parts)
    .where(and(eq(parts.plantId, plantId), eq(parts.project, PROJECT)));
  if (!partTrial.length) {
    console.log('[belanja-trial] tidak ada part trial untuk dibuang.');
    return;
  }
  const ids = partTrial.map((p) => p.id);

  /* Kartu dulu: pasangan, event, dan unit menempel ikut terbuang (cascade). */
  const kartu = await db.delete(kanbans).where(inArray(kanbans.partId, ids)).returning({
    id: kanbans.id,
  });
  await db.delete(partPairings).where(inArray(partPairings.parentPartId, ids));
  await db.delete(partPairings).where(inArray(partPairings.componentPartId, ids));
  await db.delete(partProcesses).where(inArray(partProcesses.partId, ids));

  for (const proses of PROSES_WAJIB_BELANJA) {
    await db
      .update(routeProcesses)
      .set({ requirePairing: false })
      .where(and(eq(routeProcesses.plantId, plantId), eq(routeProcesses.processType, proses)));
  }

  /*
   * Part paling akhir, dan BOLEH gagal.
   *
   * Scan produksi dan mutasi stok menunjuk part tanpa cascade. Kalau trial
   * sudah menghasilkan scan, part-nya tidak bisa dibuang — dan itu benar:
   * menghapusnya berarti menghapus riwayat produksi yang sudah tercatat.
   */
  try {
    await db.delete(parts).where(inArray(parts.id, ids));
    console.log(
      `[belanja-trial] dibuang: ${partTrial.length} part, ${kartu.length} kartu, pasangan, rute, dan bendera Wajib Belanja BODY dimatikan.`,
    );
  } catch {
    console.log(
      `[belanja-trial] kartu, pasangan, rute, dan bendera sudah dibuang; ${partTrial.length} part DIBIARKAN karena masih dipakai scan atau mutasi stok dari trial.\n` +
        `  Part: ${partTrial.map((p) => p.partNumber).join(', ')}\n` +
        '  Hapus dulu riwayat scan/mutasinya kalau memang mau dibersihkan total.',
    );
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('[belanja-trial] gagal:', err);
    await closeDb();
    process.exit(1);
  });
