import './load-env';
import bcrypt from 'bcryptjs';
import { getDb, closeDb } from './client';
import { eq } from 'drizzle-orm';
import {
  plants,
  roles,
  users,
  lines,
  customers,
  parts,
  customerParts,
  ngMasters,
  locations,
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
   * seed yang mencari "AVICENNA" lalu tidak menemukannya akan dengan senang
   * hati membuat pabrik KEMBAR — lengkap dengan line dan lokasi kembarnya.
   * Menjalankan seed pada database yang sudah dipakai seharusnya tidak pernah
   * menggandakan apa pun.
   */
  let plantRows = await db.select().from(plants);
  if (plantRows.length === 0) {
    await db.insert(plants).values([
      { code: 'AVICENNA', name: 'Plant Avicenna - Die Casting & Machining' },
      { code: 'BELLA', name: 'Plant Bella - Injection' },
    ]);
    plantRows = await db.select().from(plants);
    console.log(`[seed]   + ${plantRows.length} baris ke plants`);
  }

  // Dirujuk lewat urutan id, bukan kode — kodenya sudah boleh berubah.
  const sorted = [...plantRows].sort((a, b) => a.id - b.id);
  const avicenna = sorted[0];
  if (!avicenna) throw new Error('seed: tidak ada pabrik sama sekali');
  // Database satu pabrik tetap harus bisa di-seed; data pabrik kedua menumpang
  // ke pabrik yang sama.
  const bella = sorted[1] ?? avicenna;

  // ── Roles ─────────────────────────────────────────────────────────────────
  await insertMissing('roles', roles, 'name', [
    { name: 'admin', label: 'Administrator' },
    { name: 'supervisor', label: 'Supervisor Produksi' },
    { name: 'operator', label: 'Operator' },
    { name: 'quality', label: 'Quality Control' },
    { name: 'viewer', label: 'Lihat Saja' },
  ]);
  const roleRows = await db.select().from(roles);
  const adminRole = mustFind(roleRows, (r) => r.name === 'admin', 'role admin');

  // ── User admin ────────────────────────────────────────────────────────────
  const existingAdmin = await db.select().from(users).where(eq(users.npk, 'ADMIN')).limit(1);
  if (existingAdmin.length === 0) {
    await db.insert(users).values({
      npk: 'ADMIN',
      name: 'Administrator',
      email: 'admin@aiia.co.id',
      passwordHash: await bcrypt.hash('admin123', 10),
      roleId: adminRole.id,
      plantId: avicenna.id,
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
      { ...lineDefaults(avicenna.id), code: 'DC-01', name: 'Die Casting 1', processType: 'CASTING' as const, sortOrder: 1 },
      { ...lineDefaults(avicenna.id), code: 'MC-01', name: 'Machining 1', processType: 'MACHINING' as const, sortOrder: 2 },
      { ...lineDefaults(avicenna.id), code: 'AS-01', name: 'Assembling 1', processType: 'ASSEMBLING' as const, sortOrder: 3 },
      { ...lineDefaults(bella.id), code: 'INJ-01', name: 'Injection 1', processType: 'INJECTION' as const, sortOrder: 1 },
      { ...lineDefaults(bella.id), code: 'INJ-02', name: 'Injection 2', processType: 'INJECTION' as const, sortOrder: 2 },
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

  // ── Customers ─────────────────────────────────────────────────────────────
  await insertMissing('customers', customers, 'code', [
    { code: 'TMMIN', name: 'Toyota Motor Manufacturing Indonesia', dock: 'A1' },
    { code: 'DOWA', name: 'Dowa', dock: 'B2' },
  ]);

  // ── Parts ─────────────────────────────────────────────────────────────────
  const lineRows = await db.select().from(lines);
  const dc01 = mustFind(lineRows, (l) => l.code === 'DC-01', 'line DC-01');
  const inj01 = mustFind(lineRows, (l) => l.code === 'INJ-01', 'line INJ-01');

  await insertMissing('parts', parts, 'partNumber', [
    {
      plantId: avicenna.id,
      lineId: dc01.id,
      partNumber: 'AV-12345-001',
      backNumber: 'BN-001',
      name: 'Housing Cover A',
      processType: 'CASTING' as const,
      qtyPerKanban: 20,
      standardStock: 200,
    },
    {
      plantId: bella.id,
      lineId: inj01.id,
      partNumber: 'BL-98765-002',
      backNumber: 'BN-002',
      name: 'Clip Bracket B',
      processType: 'INJECTION' as const,
      qtyPerKanban: 50,
      standardStock: 500,
    },
  ]);

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

  // ── Master NG ─────────────────────────────────────────────────────────────
  await insertMissing('ng_masters', ngMasters, 'code', [
    { plantId: avicenna.id, code: 'CRACK', name: 'Retak', processType: 'CASTING' as const, sortOrder: 1 },
    { plantId: avicenna.id, code: 'POROUS', name: 'Keropos', processType: 'CASTING' as const, sortOrder: 2 },
    { plantId: bella.id, code: 'SHORT', name: 'Short Shot', processType: 'INJECTION' as const, sortOrder: 1 },
    { plantId: bella.id, code: 'FLASH', name: 'Flashing', processType: 'INJECTION' as const, sortOrder: 2 },
  ]);

  console.log('[seed] selesai. Login: NPK "ADMIN" / password "admin123"');
  await closeDb();
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
