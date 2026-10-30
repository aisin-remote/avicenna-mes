import './load-env';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { lines, parts, customers } from './schema/master';
import { plants } from './schema/org';
import { productionPlans } from './schema/production';

/**
 * Mengisi rencana produksi SATU HARI untuk satu lini, supaya papan perintah
 * kerja bisa dilihat isinya.
 *
 * ── Kenapa ini skrip terpisah, bukan bagian db:seed ─────────────────────────
 *
 * Jalur masuknya rencana produksi BELUM diputuskan — bisa diketik di master,
 * diimpor dari PPIC, atau ditarik dari SAP. Menaruhnya di seed utama berarti
 * setiap lingkungan baru mendapat rencana palsu yang kelihatan sah, dan
 * nantinya bercampur dengan rencana sungguhan tanpa bisa dibedakan.
 *
 * Skrip ini menandai barisnya dengan CHR_PLAN_SOURCE = 'MANUAL' dan memakai
 * tanggal hari ini. Jalankan ulang akan MENGGANTI rencana hari itu di lini
 * tersebut, bukan menumpuk.
 *
 *   pnpm --filter @avicenna/db db:seed-papan-trial AS-01
 */

/** Satu perintah kerja: part mana, berapa, dan sudah selesai berapa. */
const POLA: Array<{ cari: string; qty: number }> = [
  { cari: 'QA-TRIAL-ASFG', qty: 80 },
  { cari: 'QA-TRIAL-MAFG', qty: 80 },
  { cari: 'QA-TRIAL-DCFG', qty: 44 },
  { cari: 'QA-TRIAL-ASFG', qty: 60 },
  { cari: 'QA-TRIAL-MAFG', qty: 72 },
];

function tanggalLokal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${t}`;
}

async function main() {
  const kodeLini = process.argv[2];
  if (!kodeLini) throw new Error('Sebutkan kode lini, mis. AS-01');

  const db = getDb();
  const [line] = await db
    .select({ id: lines.id, code: lines.code, plantId: lines.plantId, proses: lines.processType })
    .from(lines)
    .where(eq(lines.code, kodeLini))
    .limit(1);
  if (!line) throw new Error(`Lini ${kodeLini} tidak ada`);
  if (!line.proses.endsWith('_FG')) {
    throw new Error(
      `Lini ${kodeLini} berproses ${line.proses} — papan perintah kerja baru untuk lini FG.`,
    );
  }

  const [pabrik] = await db.select().from(plants).where(eq(plants.id, line.plantId)).limit(1);
  const [cust] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .orderBy(asc(customers.id))
    .limit(1);

  const tanggal = tanggalLokal(new Date());

  // Jalankan ulang MENGGANTI, bukan menumpuk — lihat catatan di atas.
  await db
    .delete(productionPlans)
    .where(and(eq(productionPlans.lineId, line.id), eq(productionPlans.planDate, tanggal)));

  let seq = 10;
  let dibuat = 0;
  for (const pola of POLA) {
    const [part] = await db
      .select({ id: parts.id, partNumber: parts.partNumber, backNumber: parts.backNumber })
      .from(parts)
      .where(and(eq(parts.plantId, line.plantId), eq(parts.partNumber, pola.cari)))
      .limit(1);
    if (!part) {
      console.log(`  dilewati: part ${pola.cari} tidak ada di pabrik ${pabrik?.code ?? '?'}`);
      continue;
    }
    await db.insert(productionPlans).values({
      plantId: line.plantId,
      lineId: line.id,
      partId: part.id,
      customerId: cust?.id ?? null,
      planDate: tanggal,
      cycle: 1,
      seqNo: seq,
      orderQty: pola.qty,
      planSource: 'MANUAL',
      status: 'RELEASED',
    });
    console.log(
      `  ${kodeLini}/${tanggal.replaceAll('-', '')}/${String(seq).padStart(3, '0')}  ` +
        `${part.backNumber ?? part.partNumber}  qty ${pola.qty}`,
    );
    seq += 10;
    dibuat += 1;
  }

  console.log(`\n${dibuat} perintah kerja dibuat untuk ${kodeLini} tanggal ${tanggal}.`);
  console.log(`Buka papannya di /papan/${encodeURIComponent(kodeLini)}`);
  await closeDb();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
