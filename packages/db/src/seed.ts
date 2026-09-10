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

  // ── Plants ────────────────────────────────────────────────────────────────
  await insertMissing(
    'plants',
    plants,
    'code',
    [
      { code: 'AVICENNA', name: 'Plant Avicenna - Die Casting & Machining' },
      { code: 'BELLA', name: 'Plant Bella - Injection' },
    ],
  );
  const plantRows = await db.select().from(plants);
  const avicenna = mustFind(plantRows, (p) => p.code === 'AVICENNA', 'plant AVICENNA');
  const bella = mustFind(plantRows, (p) => p.code === 'BELLA', 'plant BELLA');

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

  // ── Lines ─────────────────────────────────────────────────────────────────
  await insertMissing('lines', lines, 'code', [
    { plantId: avicenna.id, code: 'DC-01', name: 'Die Casting 1', processType: 'CASTING' as const, sortOrder: 1 },
    { plantId: avicenna.id, code: 'MC-01', name: 'Machining 1', processType: 'MACHINING' as const, sortOrder: 2 },
    { plantId: avicenna.id, code: 'AS-01', name: 'Assembling 1', processType: 'ASSEMBLING' as const, sortOrder: 3 },
    { plantId: bella.id, code: 'INJ-01', name: 'Injection 1', processType: 'INJECTION' as const, sortOrder: 1 },
    { plantId: bella.id, code: 'INJ-02', name: 'Injection 2', processType: 'INJECTION' as const, sortOrder: 2 },
  ]);

  // ── Customers ─────────────────────────────────────────────────────────────
  await insertMissing('customers', customers, 'code', [
    { code: 'TMMIN', name: 'Toyota Motor Manufacturing Indonesia', dock: 'A1' },
    { code: 'DOWA', name: 'Dowa', dock: 'B2' },
  ]);

  // ── Locations ─────────────────────────────────────────────────────────────
  await insertMissing('locations', locations, 'code', [
    { plantId: avicenna.id, code: 'FG-AV', name: 'Finish Good Avicenna', kind: 'FINISH_GOOD' as const },
    { plantId: avicenna.id, code: 'NG-AV', name: 'Area NG Avicenna', kind: 'NG' as const },
    { plantId: bella.id, code: 'FG-BL', name: 'Finish Good Bella', kind: 'FINISH_GOOD' as const },
    { plantId: bella.id, code: 'CH-BL', name: 'Chute Bella', kind: 'CHUTE' as const },
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
>(label: string, table: TTable, keyColumn: TKey, values: TValues[]): Promise<void> {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyTable = table as any;
  const existing: Array<Record<string, unknown>> = await db.select().from(anyTable);
  const existingKeys = new Set(existing.map((row) => String(row[keyColumn])));
  const toInsert = values.filter((v) => !existingKeys.has(String(v[keyColumn])));
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
