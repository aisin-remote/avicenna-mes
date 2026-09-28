import './load-env';
import { eq, and } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { plants, customers, parts, programNumbers } from './schema/index';
import { PROGRAM_NUMBERS_AIIA, PARTS_AIIA } from './data/aiia-master';

/**
 * Memasukkan master NYATA AIIA: customer, part, dan program number.
 *
 * Dipisah dari `db:seed` dengan sengaja. Seed berisi data contoh untuk
 * pengembangan (AV-12345-001 dan kawan-kawan); ini data sungguhan dari pabrik.
 * Mencampurnya berarti tidak ada lagi cara membedakan mana yang boleh dihapus
 * saat membersihkan lingkungan uji.
 *
 *     pnpm db:import-aiia
 *
 * Aman diulang: tiap baris diperiksa dulu, yang sudah ada dilewati. Yang sudah
 * ada TIDAK ditimpa — perubahan yang dibuat orang lewat layar master tidak
 * boleh dibatalkan oleh skrip yang dijalankan ulang tanpa sengaja.
 *
 * ── Ini PEMINDAHAN SEKALI JALAN, bukan sumber kebenaran ─────────────────────
 *
 * Sesudah dijalankan, yang berlaku adalah isi tabel master — disunting lewat
 * /master/program-numbers dan /master/parts. Berkas data/aiia-master.ts TIDAK
 * ikut berubah saat orang menambah kode program lewat layar, dan memang tidak
 * seharusnya: ia rekaman keadaan sistem lama pada saat pemindahan, bukan
 * daftar yang harus dijaga tetap mutakhir.
 *
 * ── Yang TIDAK dikerjakan: rute proses ──────────────────────────────────────
 *
 * Lihat catatan di data/aiia-master.ts. Rute menentukan proses mana yang
 * mencatat hasil produksi; menebaknya berarti angka mendarat di proses yang
 * salah tanpa satu pun tanda di layar.
 */

const KODE_PABRIK = process.env.IMPORT_PLANT ?? 'UNIT';

async function main() {
  const db = getDb();

  const [pabrik] = await db.select().from(plants).where(eq(plants.code, KODE_PABRIK)).limit(1);
  if (!pabrik) {
    throw new Error(
      `Pabrik "${KODE_PABRIK}" tidak ada. Jalankan pnpm db:seed lebih dulu, ` +
        'atau set IMPORT_PLANT ke kode pabrik yang benar.',
    );
  }
  console.log(`[impor] pabrik ${pabrik.code} (#${pabrik.id})`);

  /* ── Customer ──────────────────────────────────────────────────────────── */
  const kodeCustomer = [...new Set(PARTS_AIIA.map((p) => p.customer))];
  const petaCustomer = new Map<string, number>();

  for (const kode of kodeCustomer) {
    const [ada] = await db.select().from(customers).where(eq(customers.code, kode)).limit(1);
    if (ada) {
      petaCustomer.set(kode, ada.id);
      continue;
    }
    const hasil = await db.insert(customers).values({
      code: kode,
      name: kode,
      /*
       * Format barcode customer menentukan bagaimana barcode saat muat
       * dicocokkan ke master. TMMIN punya formatnya sendiri dan namanya sudah
       * ada di daftar PART_NUMBER_FORMATS.
       */
      partNumberFormat: kode === 'TMMIN' ? 'TMMIN' : 'NONE',
    });
    const id = Number((hasil as unknown as Array<{ insertId: number }>)[0]?.insertId);
    petaCustomer.set(kode, id);
    console.log(`[impor]   + customer ${kode}`);
  }

  /* ── Part ──────────────────────────────────────────────────────────────── */
  //
  // TM_PARTS tidak punya kolom customer, dan itu memang benar: satu part bisa
  // dikirim ke beberapa customer dengan nomor part berbeda di sisi mereka.
  // Tautannya ada di TM_PROGRAM_NUMBER (per model) dan TM_CUSTOMER_PART.
  //
  // Dicari dengan (pabrik, part number) — mengikuti UNIQUE di TM_PARTS.
  //
  // ── Data lama memuat satu part number DUA KALI ──────────────────────────
  //
  // 212110-34340 muncul dengan back number CI17 dan CI18: produk sama, nama
  // sama, hanya back number-nya beda. Di tabel lama ada kolom
  // `back_number_adm` di sebelah `back_number`, jadi kemungkinan besar itu
  // cara sistem lama menyimpan back number KEDUA untuk customer berbeda —
  // bukan dua barang yang berlainan.
  //
  // Nomor part adalah nomor material di SAP dan memang satu per pabrik, jadi
  // skema kita yang benar dan data lama yang punya artefak. Yang pertama masuk
  // dipakai, yang kedua DILAPORKAN untuk dipastikan orang — tidak dibuang
  // diam-diam, dan tidak ditimpakan ke baris yang sudah ada.
  const petaPart = new Map<string, number>();
  const backNumberLain: string[] = [];
  let partBaru = 0;

  for (const p of PARTS_AIIA) {
    const kunci = `${p.partNumber}|${p.backNumber}`;
    const [ada] = await db
      .select()
      .from(parts)
      .where(and(eq(parts.plantId, pabrik.id), eq(parts.partNumber, p.partNumber)))
      .limit(1);

    if (ada) {
      petaPart.set(kunci, ada.id);
      if (ada.backNumber && ada.backNumber !== p.backNumber) {
        backNumberLain.push(
          `${p.partNumber}: tersimpan "${ada.backNumber}", data lama juga menyebut "${p.backNumber}"`,
        );
      }
      continue;
    }

    const hasil = await db.insert(parts).values({
      plantId: pabrik.id,
      partNumber: p.partNumber,
      backNumber: p.backNumber,
      name: p.name,
      /*
       * CHR_PROCESS_TYPE adalah peninggalan dari masa satu part = satu proses,
       * dan sejak rute jadi data ia hanya dipakai sebagai cadangan terakhir
       * ketika scan datang TANPA lini (mis. dari alat genggam).
       *
       * Diisi CASTING_WIP karena seluruh part di daftar ini — TCC, CSH, OPN —
       * adalah hasil die casting aluminium, dan casting memang langkah
       * pertamanya. Yang menentukan sesungguhnya tetap TM_PROCESS_PARTS.
       */
      processType: 'CASTING_WIP',
      partType: 'FINISHED_GOOD',
      sourceType: 'MANUFACTURED',
      trackingMode: 'SERIAL',
    });
    const id = Number((hasil as unknown as Array<{ insertId: number }>)[0]?.insertId);
    petaPart.set(kunci, id);
    partBaru += 1;
  }
  console.log(`[impor]   + ${partBaru} part baru (${PARTS_AIIA.length} baris di daftar)`);

  /* ── Program number ────────────────────────────────────────────────────── */
  let pnBaru = 0;
  const bentrok: string[] = [];

  for (const pn of PROGRAM_NUMBERS_AIIA) {
    const partId = petaPart.get(`${pn.partNumber}|${pn.backNumber}`);
    if (!partId) {
      console.warn(`[impor]   ! kode ${pn.code}: part ${pn.partNumber}/${pn.backNumber} tidak ketemu`);
      continue;
    }

    const [ada] = await db
      .select()
      .from(programNumbers)
      .where(and(eq(programNumbers.plantId, pabrik.id), eq(programNumbers.code, pn.code)))
      .limit(1);

    if (ada) {
      /*
       * Kode program unik per pabrik — satu kode hanya boleh menerjemahkan satu
       * part. Data lama memuat kode '13' dua kali (CI17 dan CI18), jadi yang
       * kedua pasti bertabrakan.
       *
       * Dilaporkan dengan keras, TIDAK ditimpa diam-diam: menimpa berarti part
       * mana yang menang ditentukan urutan baris di dump, dan seluruh scan
       * berkode itu mendarat di part yang belum tentu benar.
       */
      if (ada.partId !== partId) {
        bentrok.push(`${pn.code} -> sudah menunjuk part lain (${pn.product}/${pn.backNumber} dilewati)`);
      }
      continue;
    }

    await db.insert(programNumbers).values({
      plantId: pabrik.id,
      code: pn.code,
      partId,
      product: pn.product,
      customerId: petaCustomer.get(pn.customer) ?? null,
      isAssy: pn.isAssy,
    });
    pnBaru += 1;
  }
  console.log(`[impor]   + ${pnBaru} program number baru (${PROGRAM_NUMBERS_AIIA.length} di daftar)`);

  if (backNumberLain.length > 0) {
    console.warn('');
    console.warn('[impor] PERLU DIPASTIKAN ORANG — satu part number, dua back number:');
    for (const b of backNumberLain) console.warn(`          ${b}`);
    console.warn('        Kalau keduanya memang barang BERBEDA, skema harus diubah:');
    console.warn('        TM_PARTS sekarang mewajibkan nomor part unik per pabrik.');
    console.warn('        Kalau ini back number untuk customer lain, tempatnya di');
    console.warn('        TM_CUSTOMER_PART, bukan baris part kedua.');
  }

  if (bentrok.length > 0) {
    console.warn('');
    console.warn('[impor] PERLU DIPUTUSKAN ORANG — kode program bentrok:');
    for (const b of bentrok) console.warn(`          ${b}`);
    console.warn('        Perbaiki lewat /master/program-numbers setelah memastikan');
    console.warn('        mana yang benar. Barcode berkode itu sekarang diterjemahkan');
    console.warn('        ke part yang pertama masuk.');
  }

  console.log('');
  console.log('[impor] selesai. LANGKAH BERIKUTNYA: isi rute tiap part di');
  console.log('        /master/part-processes — tanpa rute, urutan proses tidak diperiksa.');
  await closeDb();
}

main().catch(async (err) => {
  console.error('[impor] gagal:', err);
  await closeDb();
  process.exit(1);
});
