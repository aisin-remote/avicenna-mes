import './load-env';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from './client';
import { eq, inArray, notInArray } from 'drizzle-orm';
import { MENU_ITEMS } from '@avicenna/contracts';
import {
  plants,
  roles,
  users,
  menus,
  roleMenus,
  lines,
  customers,
  parts,
  partProcesses,
  kanbans,
  customerParts,
  ngMasters,
  locations,
  bomLines,
  suppliers,
} from './schema/index';

/**
 * Data awal untuk development.
 *
 * Isinya sengaja minimal tapi mewakili dua pabrik sekaligus, supaya asumsi
 * "satu sistem, dua proses" langsung teruji begitu app dijalankan.
 * Aman dijalankan berulang: baris yang sudah ada dilewati, bukan ditimpa.
 */
async function main() {
  const db = getDb();
  console.log('[seed] mulai...');

  /*
   * ── Plants ────────────────────────────────────────────────────────────────
   *
   * Pabrik hanya dibuat saat tabelnya MASIH KOSONG, tidak dicari berdasarkan
   * kode seperti data lain.
   *
   * Alasannya pahit: kode pabrik bisa diganti pengguna lewat layar master, dan
   * seed yang mencari "UNIT" lalu tidak menemukannya akan dengan senang
   * hati membuat pabrik KEMBAR — lengkap dengan line dan lokasi kembarnya.
   * Menjalankan seed pada database yang sudah dipakai seharusnya tidak pernah
   * menggandakan apa pun.
   */
  let plantRows = await db.select().from(plants);
  if (plantRows.length === 0) {
    await db.insert(plants).values([
      { code: 'UNIT', name: 'Plant Unit - Melting, Casting, Machining, Assembling' },
      { code: 'BODY', name: 'Plant Body - Injection, Painting, Assembling' },
    ]);
    plantRows = await db.select().from(plants);
    console.log(`[seed]   + ${plantRows.length} baris ke plants`);
  }

  // Dirujuk lewat urutan id, bukan kode — kodenya sudah boleh berubah.
  const sorted = [...plantRows].sort((a, b) => a.id - b.id);
  const unit = sorted[0];
  if (!unit) throw new Error('seed: tidak ada pabrik sama sekali');
  // Database satu pabrik tetap harus bisa di-seed; data pabrik kedua menumpang
  // ke pabrik yang sama.
  const body = sorted[1] ?? unit;

  // ── Roles ─────────────────────────────────────────────────────────────────
  /*
   * `kind` ditulis eksplisit, tidak dibiarkan memakai bawaan kolom.
   *
   * Bawaannya VIEW. Tanpa baris ini, role "admin" pada database yang baru dibuat
   * lahir sebagai VIEW — dan layar pengaturan pengguna tidak bisa dibuka siapa
   * pun, termasuk oleh akun ADMIN yang dibuat tepat di bawah ini. Sistemnya
   * hidup tapi tidak bisa diatur, dan satu-satunya jalan keluar adalah
   * menyunting database dengan tangan.
   */
  await insertMissing('roles', roles, 'name', [
    { name: 'admin', label: 'Administrator', kind: 'ADMIN' as const },
    { name: 'supervisor', label: 'Supervisor Produksi', kind: 'VIEW' as const },
    { name: 'operator', label: 'Operator', kind: 'SCANNING' as const },
    { name: 'quality', label: 'Quality Control', kind: 'VIEW' as const },
    { name: 'viewer', label: 'Lihat Saja', kind: 'VIEW' as const },
  ]);
  const roleRows = await db.select().from(roles);
  const adminRole = mustFind(roleRows, (r) => r.name === 'admin', 'role admin');

  /*
   * Jaring pengaman: role "admin" HARUS berjabatan ADMIN.
   *
   * insertMissing melewati baris yang sudah ada, jadi database yang terlanjur
   * punya role "admin" berjabatan VIEW tidak akan pernah diperbaiki olehnya.
   * Ini satu-satunya pembetulan paksa di seluruh seed, dan hanya menyentuh satu
   * baris dengan nama yang persis itu — tanpanya sistem bisa berada dalam
   * keadaan yang tidak bisa dipulihkan dari layar mana pun.
   */
  if (adminRole.kind !== 'ADMIN') {
    await db.update(roles).set({ kind: 'ADMIN' }).where(eq(roles.id, adminRole.id));
    console.log('[seed]   ! role "admin" dikembalikan ke jabatan ADMIN');
  }

  // ── User admin ────────────────────────────────────────────────────────────
  const existingAdmin = await db.select().from(users).where(eq(users.npk, 'ADMIN')).limit(1);
  if (existingAdmin.length === 0) {
    await db.insert(users).values({
      npk: 'ADMIN',
      name: 'Administrator',
      email: 'admin@aiia.co.id',
      passwordHash: await bcrypt.hash('admin123', 10),
      roleId: adminRole.id,
      plantId: unit.id,
    });
  }

  /*
   * ── Locations (SLOC) ──────────────────────────────────────────────────────
   *
   * Kodenya mengikuti SLOC yang dipakai SAP dan berulang di tiap pabrik —
   * itulah sebabnya "sudah ada" dinilai dari pabrik + kode, bukan kode saja.
   * Lihat docs/sap-integration.md.
   */
  const slocPerPlant = [
    { code: 'WH00', name: 'Komponen & Raw Material', kind: 'WAREHOUSE' as const },
    { code: 'WP01', name: 'Work In Process', kind: 'WIP' as const },
    { code: 'PP02', name: 'Finish Good', kind: 'FINISH_GOOD' as const },
    { code: 'PP04', name: 'Staging & Shipping', kind: 'STAGING' as const },
    // Area NG tidak punya padanan SLOC; tidak ikut dikirim ke SAP.
    { code: 'NG01', name: 'Area NG', kind: 'NG' as const },
  ];
  // Untuk SEMUA pabrik yang ada, bukan hanya dua yang dikenal lewat kode.
  // Kode pabrik bisa diganti lewat layar master, dan seed yang mencarinya
  // berdasarkan kode akan diam-diam membuat pabrik kembar.
  await insertMissing(
    'locations',
    locations,
    ['plantId', 'code'],
    plantRows.flatMap((p) => slocPerPlant.map((l) => ({ plantId: p.id, ...l }))),
  );

  // ── Lines ─────────────────────────────────────────────────────────────────
  //
  // Tiap line menunjuk SLOC asal (WP01) dan tujuannya (PP02). Itu yang membuat
  // produksi tercatat sebagai PERPINDAHAN — komponen keluar dari WP01, barang
  // jadi masuk ke PP02 — bukan sekadar penambahan dari ketiadaan.
  const locationRows = await db.select().from(locations);
  const sloc = (plantId: number, code: string) =>
    locationRows.find((l) => l.plantId === plantId && l.code === code)?.id ?? null;

  const lineDefaults = (plantId: number) => ({
    plantId,
    inputLocationId: sloc(plantId, 'WP01'),
    outputLocationId: sloc(plantId, 'PP02'),
  });

  await insertMissing(
    'lines',
    lines,
    ['plantId', 'code'],
    [
      { ...lineDefaults(unit.id), code: 'DC-01', name: 'Die Casting 1 (WIP)', processType: 'CASTING_WIP' as const, sortOrder: 1 },
      { ...lineDefaults(unit.id), code: 'DC-02', name: 'Die Casting 2 (FG)', processType: 'CASTING_FG' as const, sortOrder: 2 },
      { ...lineDefaults(unit.id), code: 'MC-01', name: 'Machining 1 (WIP)', processType: 'MACHINING_WIP' as const, sortOrder: 3 },
      { ...lineDefaults(unit.id), code: 'MC-02', name: 'Machining 2 (FG)', processType: 'MACHINING_FG' as const, sortOrder: 4 },
      { ...lineDefaults(unit.id), code: 'AS-01', name: 'Assembling 1', processType: 'ASSEMBLING_UNIT' as const, sortOrder: 5 },
      { ...lineDefaults(unit.id), code: 'ML-01', name: 'Melting 1', processType: 'MELTING' as const, sortOrder: 0 },
      { ...lineDefaults(body.id), code: 'INJ-01', name: 'Injection 1', processType: 'INJECTION' as const, sortOrder: 1 },
      { ...lineDefaults(body.id), code: 'INJ-02', name: 'Injection 2', processType: 'INJECTION' as const, sortOrder: 2 },
      { ...lineDefaults(body.id), code: 'PT-01', name: 'Painting 1', processType: 'PAINTING' as const, sortOrder: 3 },
      { ...lineDefaults(body.id), code: 'AS-02', name: 'Assembling 2', processType: 'ASSEMBLING_BODY' as const, sortOrder: 4 },
    ],
  );

  /*
   * Line yang sudah ada dari seed lama belum punya SLOC. Diisi di sini, bukan
   * lewat insertMissing yang memang hanya menambah baris baru.
   */
  for (const line of await db.select().from(lines)) {
    if (line.inputLocationId && line.outputLocationId) continue;
    const wip = line.inputLocationId ?? sloc(line.plantId, 'WP01');
    const fg = line.outputLocationId ?? sloc(line.plantId, 'PP02');
    if (!wip || !fg) {
      // Dilaporkan, bukan dilempar: pabrik yang SLOC-nya belum lengkap tidak
      // boleh menggagalkan seluruh seed.
      console.warn(`[seed]   ! line ${line.code}: SLOC pabriknya belum lengkap, dilewati`);
      continue;
    }
    await db
      .update(lines)
      .set({ inputLocationId: wip, outputLocationId: fg })
      .where(eq(lines.id, line.id));
    console.log(`[seed]   ~ SLOC line ${line.code} dilengkapi`);
  }

  /*
   * ── Suppliers ─────────────────────────────────────────────────────────────
   *
   * Dua part pada rantai contoh dibeli (RM-D-001 dan CMP-B-001), jadi tanpa
   * supplier layar penerimaan barang tidak bisa dipakai sama sekali.
   */
  await insertMissing('suppliers', suppliers, 'code', [
    { code: 'SUP-01', name: 'PT Sumber Logam Nusantara' },
    { code: 'SUP-02', name: 'PT Komponen Presisi' },
  ]);

  // ── Customers ─────────────────────────────────────────────────────────────
  await insertMissing('customers', customers, 'code', [
    { code: 'TMMIN', name: 'Toyota Motor Manufacturing Indonesia', dock: 'A1' },
    { code: 'DOWA', name: 'Dowa', dock: 'B2' },
  ]);

  // ── Parts ─────────────────────────────────────────────────────────────────
  const lineRows = await db.select().from(lines);
  const dc01 = mustFind(lineRows, (l) => l.code === 'DC-01', 'line DC-01');
  const inj01 = mustFind(lineRows, (l) => l.code === 'INJ-01', 'line INJ-01');
  const as01 = mustFind(lineRows, (l) => l.code === 'AS-01', 'line AS-01');

  /*
   * Part contoh mengikuti rantai pada docs/traceability-model.md:
   *
   *   RM-D-001  raw material aluminium  (dibeli, kg)
   *      v  dilebur di die casting
   *   WIP-A-001 housing cast A          (setengah jadi)
   *      +  CMP-B-001 bracket B (dibeli)
   *      v  dirakit
   *   AV-12345-001 housing cover A      (barang jadi, dikirim ke customer)
   *
   * Rantai ini ada di seed supaya begitu database dibuat, BOM, backflush, dan
   * telusur silsilah bisa langsung diperagakan tanpa mengetik master dulu.
   */
  await insertMissing('parts', parts, ['plantId', 'partNumber'], [
    {
      plantId: unit.id,
      lineId: dc01.id,
      partNumber: 'RM-D-001',
      project: 'TCC',
      name: 'Aluminium Ingot D',
      processType: 'CASTING_WIP' as const,
      partType: 'RAW_MATERIAL' as const,
      sourceType: 'PURCHASED' as const,
      trackingMode: 'LOT' as const,
      uom: 'kg',
      standardStock: 1000,
    },
    {
      plantId: unit.id,
      lineId: dc01.id,
      partNumber: 'WIP-A-001',
      project: 'TCC',
      name: 'Housing Cast A',
      processType: 'CASTING_WIP' as const,
      partType: 'WIP' as const,
      qtyPerKanban: 20,
      standardStock: 200,
    },
    {
      plantId: unit.id,
      lineId: as01.id,
      partNumber: 'CMP-B-001',
      project: 'TCC',
      backNumber: 'BN-B',
      name: 'Bracket B',
      processType: 'ASSEMBLING_UNIT' as const,
      partType: 'COMPONENT' as const,
      sourceType: 'PURCHASED' as const,
      trackingMode: 'LOT' as const,
      qtyPerKanban: 100,
      standardStock: 500,
    },
    {
      plantId: unit.id,
      lineId: dc01.id,
      partNumber: 'AV-12345-001',
      project: 'TCC',
      backNumber: 'BN-001',
      name: 'Housing Cover A',
      processType: 'CASTING_WIP' as const,
      qtyPerKanban: 20,
      standardStock: 200,
    },
    {
      plantId: body.id,
      lineId: inj01.id,
      partNumber: 'BL-98765-002',
      project: '660A',
      backNumber: 'BN-002',
      name: 'Clip Bracket B',
      processType: 'INJECTION' as const,
      qtyPerKanban: 50,
      standardStock: 500,
    },
  ]);

  /*
   * ── Rute proses per part ──────────────────────────────────────────────────
   *
   * Mengikuti bentuk rute nyata di AIIA: tiap part punya urutannya sendiri, dan
   * dua part bisa berbeda sekalipun satu proyek. Nomor urut dibuat berjarak 10
   * supaya langkah baru bisa disisipkan tanpa menomori ulang seluruh rute.
   *
   * AV-12345-001 mengikuti pola TCC   : Melting -> Casting -> Machining -> Assembling -> Delivery
   * WIP-A-001    berhenti sebagai WIP : Melting -> Casting
   * BL-98765-002 mengikuti pola HANDLE: Injection -> Painting -> Assembling -> Delivery
   *
   * RM-D-001 dan CMP-B-001 tidak diberi rute: keduanya dibeli, bukan diproses
   * di lini kita. Part tanpa rute tidak diperiksa urutannya — lihat catatan di
   * scan.service.ts.
   */
  const partUntukRute = await db.select().from(parts);
  const partId = (pn: string) =>
    mustFind(partUntukRute, (p) => p.partNumber === pn, `part ${pn}`).id;

  const langkah = (
    plantId: number,
    pn: string,
    daftar: readonly (typeof partProcesses.$inferInsert)['processType'][],
  ) =>
    daftar.map((processType, i) => ({
      plantId,
      partId: partId(pn),
      processType,
      seqNo: (i + 1) * 10,
    }));

  /*
   * Rute disisipkan PER PART, dan hanya untuk part yang belum punya rute sama
   * sekali — bukan per baris.
   *
   * Sebelumnya tiap langkah diperiksa sendiri-sendiri dengan kunci
   * (partId, processType). Itu melewatkan UNIQUE kedua di tabel yang sama,
   * (partId, seqNo): begitu seseorang menyunting rute lewat layar master
   * (di situ seqNo dihitung ulang menjadi 10, 20, 30, ...), angka urut bawaan
   * seed bertabrakan dengan urut hasil suntingan, dan `pnpm db:seed` berhenti
   * dengan ER_DUP_ENTRY — menghalangi SELURUH seed sesudahnya, termasuk master
   * yang sama sekali tidak berhubungan.
   *
   * Melengkapi rute yang sudah disunting orang juga bukan tugas seed: rute itu
   * data nyata, dan menambahinya langkah bawaan akan mengubah urutan produksi
   * tanpa ada yang meminta.
   */
  const ruteAwal: Array<{
    plantId: number;
    pn: string;
    langkah: readonly (typeof partProcesses.$inferInsert)['processType'][];
  }> = [
    // Machining masih WIP karena masih disusul assembling.
    {
      plantId: unit.id,
      pn: 'AV-12345-001',
      langkah: ['MELTING', 'CASTING_WIP', 'MACHINING_WIP', 'ASSEMBLING_UNIT', 'DELIVERY'],
    },
    // Berhenti sebagai WIP — dipakai proses lain, tidak dikirim ke customer.
    { plantId: unit.id, pn: 'WIP-A-001', langkah: ['MELTING', 'CASTING_WIP'] },
    {
      plantId: body.id,
      pn: 'BL-98765-002',
      langkah: ['INJECTION', 'PAINTING', 'ASSEMBLING_BODY', 'DELIVERY'],
    },
  ];

  const ruteAda = new Set(
    (await db.select({ partId: partProcesses.partId }).from(partProcesses)).map((r) => r.partId),
  );

  for (const r of ruteAwal) {
    const id = partId(r.pn);
    if (ruteAda.has(id)) {
      console.log(`[seed]   . rute ${r.pn} sudah ada — dibiarkan apa adanya`);
      continue;
    }
    await db.insert(partProcesses).values(langkah(r.plantId, r.pn, r.langkah));
    console.log(`[seed]   + rute ${r.pn} (${r.langkah.length} proses)`);
  }

  /*
   * ── Kartu kanban ──────────────────────────────────────────────────────────
   *
   * Hanya untuk part yang rutenya berakhir di lini finish good — di situlah
   * kanban mulai ditempel. Part yang berhenti sebagai WIP tidak punya kanban,
   * dan memberinya kanban justru menyesatkan.
   *
   * Serinya sengaja pendek seperti di sistem lama ('1456', '1082'): seri unik
   * per PART, bukan per pabrik, jadi angka yang sama boleh muncul di part lain.
   */
  await insertMissing('kanbans', kanbans, ['partId', 'serialNumber'], [
    ...['1001', '1002', '1003'].map((serialNumber) => ({
      plantId: unit.id,
      partId: partId('AV-12345-001'),
      serialNumber,
      qtyPerBox: 20,
      unitPerKanban: 1,
    })),
    ...['1001', '1002'].map((serialNumber) => ({
      plantId: body.id,
      partId: partId('BL-98765-002'),
      serialNumber,
      qtyPerBox: 50,
      unitPerKanban: 1,
    })),
  ]);

  // ── BOM: WIP-A-001 dibuat dari RM-D-001 ───────────────────────────────────
  const partRowsForBom = await db.select().from(parts);
  const findPart = (pn: string) =>
    mustFind(partRowsForBom, (p) => p.partNumber === pn, `part ${pn}`);
  const wipA = findPart('WIP-A-001');
  const rmD = findPart('RM-D-001');

  const bomAda = await db
    .select()
    .from(bomLines)
    .where(eq(bomLines.parentPartId, wipA.id))
    .limit(1);
  if (bomAda.length === 0) {
    await db.insert(bomLines).values({
      plantId: unit.id,
      parentPartId: wipA.id,
      componentPartId: rmD.id,
      // 1,7 kg aluminium per housing, ditambah 2% susut pembakaran.
      qtyPer: '1.7000',
      scrapPct: '2.00',
      uom: 'kg',
      effectiveFrom: '2026-01-01',
    });
    console.log('[seed]   + BOM WIP-A-001 <- RM-D-001');
  }

  // ── Mapping part <-> customer ─────────────────────────────────────────────
  const partRows = await db.select().from(parts);
  const customerRows = await db.select().from(customers);
  const tmmin = mustFind(customerRows, (c) => c.code === 'TMMIN', 'customer TMMIN');
  const housing = mustFind(partRows, (p) => p.partNumber === 'AV-12345-001', 'part AV-12345-001');

  const existingCp = await db
    .select()
    .from(customerParts)
    .where(eq(customerParts.customerPartNumber, '90210-BZ010'))
    .limit(1);
  if (existingCp.length === 0) {
    await db.insert(customerParts).values({
      partId: housing.id,
      customerId: tmmin.id,
      customerPartNumber: '90210-BZ010',
      customerBackNumber: 'TB-001',
      qtyPerKanban: 20,
    });
  }

  /*
   * ── Master NG ───────────────────────────────────────────────────────────
   *
   * Nama-nama casting diambil dari layar NG avicenna yang dipakai sekarang
   * (tombol 1-18 di tracebility/casting/ng2), bukan dikarang: operator sudah
   * menyebut kerusakan dengan istilah-istilah itu, dan menggantinya berarti
   * data NG lama tidak bisa dibandingkan dengan yang baru.
   *
   * Lingkupnya GRUP proses. "DLL" sengaja tanpa lingkup supaya selalu muncul:
   * operator yang menemukan kerusakan yang belum terdaftar harus tetap punya
   * pilihan, kalau tidak barang rusaknya lewat sebagai barang baik.
   */
  await insertMissing('ng_masters', ngMasters, 'code', [
    { plantId: unit.id, code: 'CRACK', name: 'Crack', processGroup: 'CASTING' as const, sortOrder: 1 },
    { plantId: unit.id, code: 'YUZIWA', name: 'Yuziwa', processGroup: 'CASTING' as const, sortOrder: 2 },
    { plantId: unit.id, code: 'KAJIRI', name: 'Kajiri', processGroup: 'CASTING' as const, sortOrder: 3 },
    { plantId: unit.id, code: 'YOGORE', name: 'Yogore', processGroup: 'CASTING' as const, sortOrder: 4 },
    { plantId: unit.id, code: 'DENT', name: 'Dent', processGroup: 'CASTING' as const, sortOrder: 5 },
    { plantId: unit.id, code: 'NG_DIAL', name: 'NG Dial', processGroup: 'CASTING' as const, sortOrder: 6 },
    { plantId: unit.id, code: 'CORE_PIN', name: 'Core Pin Patah', processGroup: 'CASTING' as const, sortOrder: 7 },
    { plantId: unit.id, code: 'TOOL_INJURY', name: 'Tool Injury', processGroup: 'CASTING' as const, sortOrder: 8 },
    { plantId: unit.id, code: 'YAKITSUKI', name: 'Yakitsuki', processGroup: 'CASTING' as const, sortOrder: 9 },
    { plantId: unit.id, code: 'SCRATCH', name: 'Scratch', processGroup: 'CASTING' as const, sortOrder: 10 },
    { plantId: unit.id, code: 'NG_MARKING', name: 'NG Marking', processGroup: 'CASTING' as const, sortOrder: 11 },
    { plantId: unit.id, code: 'MIKUI', name: 'Mikui', processGroup: 'CASTING' as const, sortOrder: 12 },
    { plantId: unit.id, code: 'DIE_CRACK', name: 'Die Crack', processGroup: 'CASTING' as const, sortOrder: 13 },
    { plantId: unit.id, code: 'GOMPAL', name: 'Produk Gompal', processGroup: 'CASTING' as const, sortOrder: 14 },
    { plantId: unit.id, code: 'MENGELUPAS', name: 'Mengelupas', processGroup: 'CASTING' as const, sortOrder: 15 },
    { plantId: unit.id, code: 'OVER_KIKIR', name: 'Over Kikir', processGroup: 'CASTING' as const, sortOrder: 16 },
    { plantId: unit.id, code: 'GAP_TEBAL', name: 'Gap Tebal', processGroup: 'CASTING' as const, sortOrder: 17 },
    { plantId: unit.id, code: 'BURR', name: 'Burr', processGroup: 'MACHINING' as const, sortOrder: 20 },
    { plantId: unit.id, code: 'DIM_NG', name: 'Dimensi NG', processGroup: 'MACHINING' as const, sortOrder: 21 },
    { plantId: unit.id, code: 'DLL', name: 'DLL', processGroup: null, sortOrder: 99 },
    { plantId: body.id, code: 'SHORT', name: 'Short Shot', processGroup: 'INJECTION' as const, sortOrder: 1 },
    { plantId: body.id, code: 'FLASH', name: 'Flashing', processGroup: 'INJECTION' as const, sortOrder: 2 },
    { plantId: body.id, code: 'SILVER', name: 'Silver Streak', processGroup: 'INJECTION' as const, sortOrder: 3 },
    { plantId: body.id, code: 'BUREK', name: 'Burek / Kotor', processGroup: 'PAINTING' as const, sortOrder: 10 },
    { plantId: body.id, code: 'DLL', name: 'DLL', processGroup: null, sortOrder: 99 },
  ]);

  await seedMenu();

  console.log('[seed] selesai. Login: NPK "ADMIN" / password "admin123"');
  await closeDb();
}

/**
 * ── Katalog menu dan hak bawaannya ──────────────────────────────────────────
 *
 * Katalognya disalin dari MENU_ITEMS, sumber yang sama dipakai sidebar dan API.
 * API juga menyalinnya saat menyala; dikerjakan di sini juga supaya
 * `pnpm db:seed` menghasilkan sistem yang lengkap tanpa menuntut API pernah
 * dijalankan lebih dulu.
 */
async function seedMenu(): Promise<void> {
  const db = getDb();

  const ada = await db.select().from(menus);
  const perKunci = new Map(ada.map((m) => [m.key, m]));

  let baru = 0;
  for (const item of MENU_ITEMS) {
    const nilai = {
      label: item.label,
      href: item.href,
      icon: item.icon,
      menuGroup: item.group,
      sortOrder: item.sortOrder,
      adminOnly: Boolean(item.adminOnly),
      isActive: true,
    };
    const lama = perKunci.get(item.key);
    if (!lama) {
      await db.insert(menus).values({ key: item.key, ...nilai });
      baru += 1;
    } else {
      await db.update(menus).set(nilai).where(eq(menus.id, lama.id));
    }
  }

  /*
   * Menu yang hilang dari katalog dinonaktifkan, tidak dihapus — menghapusnya
   * ikut menghapus pemberian haknya (ON DELETE CASCADE), dan daftar role yang
   * dulu boleh membukanya tidak bisa dipulihkan.
   */
  const kunci = MENU_ITEMS.map((m) => m.key);
  await db.update(menus).set({ isActive: false }).where(notInArray(menus.key, kunci));

  if (baru > 0) console.log(`[seed]   + ${baru} menu ke katalog`);

  /*
   * Hak bawaan HANYA untuk role yang belum diatur sama sekali.
   *
   * Menulis ulang tiap kali seed dijalankan akan membatalkan pengaturan yang
   * sudah dibuat orang lewat layar role — dan mereka tidak akan tahu kapan itu
   * terjadi. ADMIN sengaja dilewati: jabatannya sudah membuka seluruh menu,
   * dan menautkannya di sini justru membuka kemungkinan hak admin ikut tercabut
   * lewat layar biasa.
   */
  const semuaRole = await db.select().from(roles);
  const sudahPunya = new Set(
    (await db.select({ roleId: roleMenus.roleId }).from(roleMenus)).map((r) => r.roleId),
  );

  const bawaan: Record<'SCANNING' | 'VIEW', string[]> = {
    // Lasman: layar kerjanya, ditambah NG outline untuk barang yang ketemu
    // belakangan. Tidak diberi master apa pun.
    SCANNING: ['dashboard', 'scan', 'ng-outline'],
    // JP dan leader memeriksa, tidak men-scan.
    VIEW: ['dashboard', 'monitor', 'trace'],
  };

  const menuRows = await db.select({ id: menus.id, key: menus.key }).from(menus);
  const idMenu = new Map(menuRows.map((m) => [m.key, m.id]));

  let diberi = 0;
  for (const r of semuaRole) {
    if (r.kind === 'ADMIN' || sudahPunya.has(r.id)) continue;
    const keys = bawaan[r.kind] ?? [];
    const values = keys
      .map((k) => idMenu.get(k))
      .filter((id): id is number => id !== undefined)
      .map((menuId) => ({ roleId: r.id, menuId }));
    if (values.length === 0) continue;
    await db.insert(roleMenus).values(values);
    diberi += 1;
  }
  if (diberi > 0) console.log(`[seed]   + hak menu bawaan untuk ${diberi} role`);
}

/**
 * Menyisipkan hanya baris yang nilai `keyColumn`-nya belum ada.
 * Dipakai supaya `pnpm db:seed` aman dijalankan berkali-kali tanpa menimpa
 * perubahan yang sudah dibuat manual saat development.
 */
async function insertMissing<
  TTable extends { [K in TKey]: unknown },
  TKey extends string,
  TValues extends Record<string, unknown>,
>(
  label: string,
  table: TTable,
  /*
   * Kolom penentu "sudah ada". Boleh beberapa kolom sekaligus, karena sebagian
   * kode memang berulang antar pabrik: SLOC WH00 ada di setiap pabrik, persis
   * seperti di SAP. Dengan satu kolom saja, pabrik kedua akan dilewati diam-diam.
   */
  keyColumn: TKey | TKey[],
  values: TValues[],
): Promise<void> {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyTable = table as any;
  const cols = Array.isArray(keyColumn) ? keyColumn : [keyColumn];
  const keyOf = (row: Record<string, unknown>) => cols.map((c) => String(row[c])).join('\u0000');
  const existing: Array<Record<string, unknown>> = await db.select().from(anyTable);
  const existingKeys = new Set(existing.map(keyOf));
  const toInsert = values.filter((v) => !existingKeys.has(keyOf(v)));
  if (toInsert.length === 0) return;
  await db.insert(anyTable).values(toInsert);
  console.log(`[seed]   + ${toInsert.length} baris ke ${label}`);
}

function mustFind<T>(rows: T[], pred: (row: T) => boolean, label: string): T {
  const found = rows.find(pred);
  if (!found) throw new Error(`seed: ${label} tidak ditemukan`);
  return found;
}

main().catch(async (err) => {
  console.error('[seed] gagal:', err);
  await closeDb();
  process.exit(1);
});
