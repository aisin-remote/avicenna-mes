import './load-env';
import { eq, sql } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { lines, parts } from './schema/master';
import { plants } from './schema/org';

/**
 * Menyelaraskan master kita dengan konvensi SAP: nomor part dan work center.
 *
 * Dua hal, keduanya mekanis dan keduanya terbukti dari data staging SAP
 * (database `aisinbisa_sap_stagging`, dibaca 3 November 2026):
 *
 *   1. NOMOR PART tanpa tanda hubung. SAP AIIA menyimpan `32119242010`,
 *      master kita `212110-34010`. Nomor yang sama; staging sendiri
 *      memperlakukannya begitu — TT_GOODS_MOVEMENT_L punya CHR_PART_NO dan
 *      CHR_PART_NO_DASH berdampingan.
 *
 *   2. WORK CENTER enam karakter tanpa pemisah: `DCAA01`, `ASDL01`, `GIIH01`.
 *      Kode lini kita yang berstrip (`AS-02`, `MC-01`) tidak pernah dikenal
 *      SAP.
 *
 * ── Kenapa SKRIP, bukan migrasi SQL ─────────────────────────────────────────
 *
 * Isi master berbeda di tiap lingkungan, dan penyelarasan ini harus bisa
 * DILIHAT dulu sebelum dijalankan: ia mengubah nilai yang tercetak di kartu
 * dan label yang sudah beredar di lantai. Migrasi yang jalan diam-diam saat
 * deploy bukan tempat untuk perubahan seperti itu.
 *
 * Tanpa argumen hanya melaporkan. `--tulis` menyimpan.
 *
 *   pnpm --filter @avicenna/db db:selaraskan-master-sap
 *   pnpm --filter @avicenna/db db:selaraskan-master-sap --tulis
 *
 * ── Kartu yang sudah tercetak tetap terbaca ─────────────────────────────────
 *
 * Kartu kanban dan label part yang sudah ada membawa bentuk berstrip di dalam
 * barcodenya. Itu TIDAK menjadi masalah: pencarian part dan pencocokan kartu
 * membandingkan dalam bentuk baku (lihat `normalkanNomorPart` di
 * @avicenna/domain), jadi kedua bentuk menunjuk part yang sama. Kartu tidak
 * perlu dicetak ulang.
 */

/** Work center SAP: enam karakter, huruf besar dan angka, tanpa pemisah. */
const BENTUK_WORK_CENTER = /^[A-Z0-9]{6}$/;

/**
 * Nomor part AISIN: `NNNNNN-NNNNN` dengan sufiks tahap proses yang opsional.
 *
 * ── Kenapa disaring bentuknya, bukan dikonversi semua ───────────────────────
 *
 * Aturannya "master mengikuti SAP", dan part yang tidak ada di SAP tidak
 * tercakup aturan itu. Part demo dan fixture QA — `QA-DEL-*`, `AV-12345-001`,
 * `RM-D-001` — tidak akan pernah ada di sana; mengubahnya jadi `QADEL1F045FF5`
 * tidak melayani siapa pun dan membuat data uji tidak terbaca lagi.
 *
 * Yang lolos saringan ini adalah nomor yang BENTUKNYA memang nomor material
 * AISIN, termasuk part trial yang sengaja dibuat berbentuk begitu.
 *
 * Diuji terhadap bentuk BAKU, bukan bentuk aslinya — jadi `212110-34010` dan
 * `21211034010` dua-duanya lolos. Kalau diuji terhadap bentuk berstrip saja,
 * part yang SUDAH dikonversi akan terbaca sebagai "bukan nomor AISIN" pada
 * jalan kedua, dan laporannya berbohong tentang apa yang dilewatinya.
 */
const BENTUK_AISIN = /^[0-9]{11}[A-Z0-9]{0,3}$/;

function bentukSap(nomor: string): string {
  return nomor.trim().replace(/-/g, '').toUpperCase();
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  const lokal = ['localhost', '127.0.0.1'].includes(url.hostname);
  const tulis = process.argv.includes('--tulis');
  if (tulis && !lokal) {
    /*
     * Di server, penyelarasan ini harus dijalankan sadar — bukan kebetulan
     * karena seseorang menyalin perintah dari catatan. Nomor part yang berubah
     * di server berarti berubah untuk seluruh pabrik sekaligus.
     */
    if (!process.argv.includes('--server')) {
      throw new Error(
        `DATABASE_URL menunjuk ${url.hostname}, bukan lokal. ` +
          'Tambahkan --server bila memang itu yang kamu maksud.',
      );
    }
  }

  const db = getDb();
  console.log(`\n[selaraskan] database ${url.hostname}${tulis ? ' — MENULIS' : ' — laporan saja'}`);

  /* ── 1. Nomor part ───────────────────────────────────────────────────────── */
  const semuaPart = await db
    .select({
      id: parts.id,
      plantId: parts.plantId,
      partNumber: parts.partNumber,
      pabrik: plants.code,
    })
    .from(parts)
    .innerJoin(plants, eq(plants.id, parts.plantId));

  const berbentukAisin = semuaPart.filter((p) => BENTUK_AISIN.test(bentukSap(p.partNumber)));
  const dilewati = semuaPart.filter((p) => !BENTUK_AISIN.test(bentukSap(p.partNumber)));
  const perlu = berbentukAisin.filter((p) => p.partNumber !== bentukSap(p.partNumber));

  /*
   * Tabrakan diperiksa DULU, dan satu saja membatalkan seluruh penyelarasan.
   *
   * Dua nomor berbeda yang menjadi sama setelah stripnya dibuang berarti
   * keduanya tidak bisa dibedakan lagi — dan karena kuncinya (pabrik, nomor),
   * yang kedua akan gagal disimpan di tengah jalan, meninggalkan master
   * setengah terkonversi.
   */
  const peta = new Map<string, string[]>();
  for (const p of berbentukAisin) {
    const kunci = `${p.plantId}|${bentukSap(p.partNumber)}`;
    peta.set(kunci, [...(peta.get(kunci) ?? []), p.partNumber]);
  }
  const tabrakan = [...peta.entries()].filter(([, v]) => v.length > 1);

  console.log(`\n── Nomor part ──`);
  console.log(
    `  ${semuaPart.length} part; ${berbentukAisin.length} berbentuk AISIN, ` +
      `${perlu.length} perlu diubah, ${dilewati.length} dilewati (demo/QA — tidak ada di SAP)`,
  );
  if (tabrakan.length) {
    console.log(`\n  DIBATALKAN — ${tabrakan.length} tabrakan:`);
    for (const [k, v] of tabrakan) console.log(`    ${k.split('|')[1]} <- ${v.join(' + ')}`);
    throw new Error('Nomor part bertabrakan setelah strip dibuang; master tidak diubah.');
  }
  for (const p of perlu.slice(0, 10)) {
    console.log(`  ${p.pabrik.padEnd(5)} ${p.partNumber.padEnd(20)} -> ${bentukSap(p.partNumber)}`);
  }
  if (perlu.length > 10) console.log(`  … dan ${perlu.length - 10} lagi`);

  if (tulis) {
    for (const p of perlu) {
      await db
        .update(parts)
        .set({ partNumber: bentukSap(p.partNumber) })
        .where(eq(parts.id, p.id));
    }
    console.log(`  ${perlu.length} nomor part disimpan dalam bentuk SAP.`);
  }

  /* ── 2. Work center ──────────────────────────────────────────────────────── */
  const semuaLini = await db
    .select({
      id: lines.id,
      code: lines.code,
      name: lines.name,
      sapWorkCenter: lines.sapWorkCenter,
      pabrik: plants.code,
    })
    .from(lines)
    .innerJoin(plants, eq(plants.id, lines.plantId));

  /*
   * Hanya kode yang SUDAH berbentuk work center yang diisikan.
   *
   * Lini berkode `AS-02` TIDAK ditebak menjadi `AS0002`: tebakan seperti itu
   * menghasilkan work center yang kebetulan berbentuk benar tetapi menunjuk
   * mesin yang salah — dan SAP akan membukukan produksinya di sana tanpa
   * keluhan apa pun. Yang kosong dibiarkan kosong, dan dokumennya ditahan.
   */
  const bisaDiisi = semuaLini.filter(
    (l) => !l.sapWorkCenter && BENTUK_WORK_CENTER.test(l.code.toUpperCase()),
  );
  const perluTangan = semuaLini.filter(
    (l) => !l.sapWorkCenter && !BENTUK_WORK_CENTER.test(l.code.toUpperCase()),
  );

  console.log(`\n── Work center SAP ──`);
  console.log(
    `  ${semuaLini.length} lini; ${semuaLini.length - bisaDiisi.length - perluTangan.length} sudah terisi, ` +
      `${bisaDiisi.length} bisa diisi dari kodenya, ${perluTangan.length} HARUS diisi tangan`,
  );
  for (const l of bisaDiisi)
    console.log(`  ${l.pabrik.padEnd(5)} ${l.code} -> ${l.code.toUpperCase()}`);
  if (perluTangan.length) {
    console.log(`\n  Belum punya padanan SAP — produksinya akan DITAHAN sampai diisi:`);
    for (const l of perluTangan)
      console.log(`    ${l.pabrik.padEnd(5)} ${l.code.padEnd(9)} ${l.name}`);
  }

  if (tulis) {
    for (const l of bisaDiisi) {
      await db.update(lines).set({ sapWorkCenter: l.code.toUpperCase() }).where(eq(lines.id, l.id));
    }
    console.log(`\n  ${bisaDiisi.length} work center disimpan.`);
  }

  /* ── 3. Production version per langkah ───────────────────────────────────── */
  const [pv] = await db
    .select({
      langkah: sql<number>`count(*)`,
      terisi: sql<number>`count("CHR_PRODUCTION_VERSION")`,
    })
    .from(sql`master."TM_PROCESS_PARTS"`);
  console.log(`\n── Production version per langkah ──`);
  console.log(
    `  ${pv?.terisi ?? 0} dari ${pv?.langkah ?? 0} langkah rute sudah punya PV. ` +
      'Diisi tarik SAP (TM_PROCESS_PARTS) setelah work center dipetakan, atau tangan ' +
      'di Master Data › Rute Proses per Part.',
  );

  console.log(
    tulis
      ? '\n[selaraskan] selesai, perubahan disimpan.\n'
      : '\n[selaraskan] laporan saja. Jalankan ulang dengan --tulis untuk menyimpan.\n',
  );
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error('[selaraskan] gagal:', err instanceof Error ? err.message : err);
    await closeDb();
    process.exit(1);
  });
