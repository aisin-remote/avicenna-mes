import './load-env';
import { and, eq } from 'drizzle-orm';
import { getDb, closeDb } from './client';
import { locations } from './schema/inventory';
import { customerParts, customers, lines, partProcesses, parts, suppliers } from './schema/master';
import { plants } from './schema/org';
import type { ProcessType } from './schema/_shared';
import {
  GENTANI_UNIT,
  GENTANI_UNIT_DILEWATI,
  LINI_UNIT_GENTANI,
  type PartGentani,
} from './data/gentani-unit';

/**
 * Memasukkan master NYATA pabrik UNIT dari Gentani AII: lini, supplier,
 * customer, part, rute proses, dan nomor part customer.
 *
 *     pnpm --filter @avicenna/db db:impor-gentani            # hanya melihat
 *     pnpm --filter @avicenna/db db:impor-gentani --terapkan  # benar-benar menulis
 *
 * TANPA `--terapkan` skrip ini tidak menulis apa pun — ia hanya melaporkan apa
 * yang AKAN dikerjakan. Impor master 143 part ke basis data yang sudah dipakai
 * bukan hal yang pantas terjadi karena salah menekan panah atas.
 *
 * Aman diulang: tiap baris diperiksa dulu, yang sudah ada dilewati dan TIDAK
 * ditimpa — perubahan yang dibuat orang lewat layar master tidak boleh
 * dibatalkan oleh skrip yang dijalankan ulang tanpa sengaja. Sama seperti
 * db:import-aiia.
 *
 * ── Hubungannya dengan db:seed dan db:import-aiia ───────────────────────────
 *
 * db:seed menanam data contoh untuk pengembangan, termasuk lini `AS-01`,
 * `DC-01` dan kawan-kawan. Skrip ini menambahkan lini dengan kode AII yang
 * sungguhan (`AS 0003`, `DC AA01`) di sebelahnya, dan TIDAK menyentuh yang
 * lama — di lini contoh itu masih menempel data percobaan yang belum diperiksa
 * orang. Memensiunkannya keputusan terpisah.
 *
 * db:import-aiia memasukkan 14 part dari dump avicenna lama beserta kode
 * programnya. Part-part itu juga ada di Gentani, dan Gentani lebih mutakhir:
 * tiga di antaranya nomornya sudah berubah (212110-34140 -> 212110-34141,
 * 212110-34340 -> 212110-34341) dan satu back numbernya berbeda (243131-10490
 * DI02 -> DI04, sebab DI02 di Gentani adalah tahap die castingnya). Skrip ini
 * tidak menimpa part lama; selisihnya dilaporkan di akhir supaya orang yang
 * tahu bisa memutuskan.
 *
 * ── Part BELI tidak diimpor, dan itu disengaja ──────────────────────────────
 *
 * 70 dari 143 part di Gentani UNIT adalah part beli (P/CODE `KN` dan `MX`).
 * Kolom `parts.processType` wajib isi dan merujuk TM_PROCESS_TYPE, sedangkan
 * part beli tidak dibuat proses mana pun — yang bisa diisi hanyalah proses
 * yang MENGONSUMSINYA, dan itu hanya diketahui dari BOM. BOM Gentani tidak
 * bisa diurai (lihat catatan di data/gentani-unit.ts).
 *
 * Mengisinya dengan tebakan berarti part beli bergantung pada proses yang
 * salah tanpa satu pun tanda di layar. Jadi part beli DILEWATI, dan jumlahnya
 * dilaporkan. Beri `--jenis-proses-beli=<KODE>` kalau sudah ada keputusan
 * jenis proses mana yang menampungnya.
 */

const KODE_PABRIK = process.env.IMPORT_PLANT ?? 'UNIT';

const argv = process.argv.slice(2);
const TERAPKAN = argv.includes('--terapkan');
const JENIS_BELI =
  argv
    .find((a) => a.startsWith('--jenis-proses-beli='))
    ?.split('=')[1]
    ?.trim() || null;

/** SLOC masuk/keluar per jenis proses, mengikuti pola lini yang sudah ada di db:seed. */
function slocLini(jenis: string): { masuk: string; keluar: string } {
  return jenis.endsWith('_FG')
    ? { masuk: 'WP80', keluar: 'FG80' }
    : { masuk: 'WP80', keluar: 'WP80' };
}

/**
 * Posisi part di rantai pasok, diturunkan dari SLOC tujuan dan tujuan customer.
 *
 * Yang punya tujuan customer pasti barang jadi — itu terbukti di datanya:
 * seluruh 32 baris bertujuan customer ada di SLOC barang jadi, tidak satu pun
 * di gudang WIP.
 */
function posisiPart(p: PartGentani): 'RAW_MATERIAL' | 'COMPONENT' | 'WIP' | 'FINISHED_GOOD' {
  if (p.sourceType === 'PURCHASED') return p.uom === 'pcs' ? 'COMPONENT' : 'RAW_MATERIAL';
  if (p.destCustomer || p.sloc === 'FG80') return 'FINISHED_GOOD';
  return 'WIP';
}

/**
 * Cara part ditelusuri.
 *
 * Part melting tidak punya back number di Gentani — seluruh 18 barisnya kosong —
 * dan memang tidak mungkin berseri: yang keluar dari tungku itu logam cair per
 * model, bukan barang yang discan satu per satu.
 */
function caraTelusur(p: PartGentani): 'SERIAL' | 'LOT' | 'QUANTITY' {
  if (p.processType === 'MELTING' || !p.backNumber) return 'QUANTITY';
  return 'SERIAL';
}

type Catatan = { tindakan: 'baru' | 'ada' | 'lewat'; pesan: string };

async function main() {
  const db = getDb();
  const catat: Record<string, Catatan[]> = {};
  const tulis = (bagian: string, c: Catatan) => (catat[bagian] ??= []).push(c);

  console.log(
    TERAPKAN
      ? '[impor] MENULIS ke basis data'
      : '[impor] hanya melihat — tidak ada yang ditulis. Tambahkan --terapkan untuk menulis.',
  );

  const [pabrik] = await db.select().from(plants).where(eq(plants.code, KODE_PABRIK)).limit(1);
  if (!pabrik) {
    throw new Error(
      `Pabrik "${KODE_PABRIK}" tidak ada. Jalankan pnpm db:seed lebih dulu, ` +
        'atau set IMPORT_PLANT ke kode pabrik yang benar.',
    );
  }
  console.log(`[impor] pabrik ${pabrik.code} (#${pabrik.id})`);

  /* ── SLOC ──────────────────────────────────────────────────────────────── */
  const daftarLokasi = await db.select().from(locations).where(eq(locations.plantId, pabrik.id));
  const petaLokasi = new Map(daftarLokasi.map((l) => [l.code, l.id]));
  for (const kode of ['WH80', 'WP80', 'FG80']) {
    if (!petaLokasi.has(kode)) {
      throw new Error(
        `SLOC ${kode} tidak ada di pabrik ${pabrik.code}. ` +
          'Jalankan pnpm db:seed atau db:selaraskan lebih dulu.',
      );
    }
  }

  /* ── Lini ──────────────────────────────────────────────────────────────── */
  const petaLini = new Map<string, number>();
  for (const l of LINI_UNIT_GENTANI) {
    const [ada] = await db
      .select()
      .from(lines)
      .where(and(eq(lines.plantId, pabrik.id), eq(lines.code, l.code)))
      .limit(1);
    if (ada) {
      petaLini.set(l.code, ada.id);
      tulis('lini', { tindakan: 'ada', pesan: `${l.code} (#${ada.id})` });
      continue;
    }
    const sloc = slocLini(l.processType);
    const nilai = {
      plantId: pabrik.id,
      code: l.code,
      name: l.code,
      processType: l.processType as ProcessType,
      inputLocationId: petaLokasi.get(sloc.masuk)!,
      outputLocationId: petaLokasi.get(sloc.keluar)!,
    };
    if (TERAPKAN) {
      const hasil = await db.insert(lines).values(nilai).returning({ id: lines.id });
      petaLini.set(l.code, Number(hasil[0]?.id));
    }
    tulis('lini', {
      tindakan: 'baru',
      pesan:
        `${l.code}  ${l.processType}  ${sloc.masuk} -> ${sloc.keluar}` +
        (l.campuran.length ? `   CAMPURAN, juga membuat: ${l.campuran.join(', ')}` : ''),
    });
  }

  /* ── Supplier ──────────────────────────────────────────────────────────── */
  const kodeSupplier = new Map<string, string>();
  for (const p of GENTANI_UNIT) {
    if (p.sourceType !== 'PURCHASED' || !p.lineNo || !p.supplier) continue;
    if (!kodeSupplier.has(p.lineNo)) kodeSupplier.set(p.lineNo, p.supplier);
  }
  for (const [kode, nama] of kodeSupplier) {
    /*
     * Kode supplier kembar di sumbernya, kurang satu nol.
     *
     * Gentani memuat `7D0050` di samping `7D00050`, `7D0076` di samping
     * `7D00076`, dan `7D0093` di samping `7D00093` — orang yang sama, kode
     * salah ketik. Bentuk tujuh karakter yang benar: 1.519 baris memakainya,
     * sedangkan yang enam karakter cuma tiga.
     *
     * Dilewati, bukan diperbaiki diam-diam: memperbaikinya di sini berarti
     * berkas Gentani dan master kita berbeda tanpa ada yang tahu. Yang perlu
     * diperbaiki adalah Gentaninya.
     */
    const panjang = kode.replace(/^7D0/, '7D00');
    if (kode.length === 6 && kodeSupplier.has(panjang)) {
      tulis('supplier', {
        tindakan: 'lewat',
        pesan: `${kode} ${nama} — kembar dengan ${panjang}, kode di Gentani kurang satu nol`,
      });
      continue;
    }

    const [ada] = await db.select().from(suppliers).where(eq(suppliers.code, kode)).limit(1);
    if (ada) {
      tulis('supplier', { tindakan: 'ada', pesan: `${kode} ${ada.name}` });
      continue;
    }
    if (TERAPKAN) await db.insert(suppliers).values({ code: kode, name: nama.slice(0, 128) });
    tulis('supplier', { tindakan: 'baru', pesan: `${kode} ${nama}` });
  }

  /* ── Customer ──────────────────────────────────────────────────────────── */
  const petaCustomer = new Map<string, number>();
  const kodeCustomer = [...new Set(GENTANI_UNIT.map((p) => p.destCustomer).filter(Boolean))];
  for (const kode of kodeCustomer as string[]) {
    const [ada] = await db.select().from(customers).where(eq(customers.code, kode)).limit(1);
    if (ada) {
      petaCustomer.set(kode, ada.id);
      tulis('customer', { tindakan: 'ada', pesan: `${kode} ${ada.name}` });
      continue;
    }
    const nilai = {
      code: kode,
      name: kode,
      /* Lihat catatan format barcode di import-aiia.ts: hanya TMMIN yang punya. */
      partNumberFormat: (kode === 'TMMIN' ? 'TMMIN' : 'NONE') as 'TMMIN' | 'NONE',
    };
    if (TERAPKAN) {
      const hasil = await db.insert(customers).values(nilai).returning({ id: customers.id });
      petaCustomer.set(kode, Number(hasil[0]?.id));
    }
    tulis('customer', {
      tindakan: 'baru',
      pesan: `${kode} (format barcode ${nilai.partNumberFormat})`,
    });
  }

  /* ── Part ──────────────────────────────────────────────────────────────── */
  const petaPart = new Map<string, number>();
  const bedaDariLama: string[] = [];

  for (const p of GENTANI_UNIT) {
    if (p.sourceType === 'PURCHASED' && !JENIS_BELI) {
      tulis('part', { tindakan: 'lewat', pesan: `${p.partNumber} part beli (${p.pcode})` });
      continue;
    }
    const jenis = p.processType ?? JENIS_BELI;
    if (!jenis) {
      tulis('part', { tindakan: 'lewat', pesan: `${p.partNumber} tanpa jenis proses` });
      continue;
    }

    const [ada] = await db
      .select({ id: parts.id, name: parts.name, backNumber: parts.backNumber })
      .from(parts)
      .where(and(eq(parts.plantId, pabrik.id), eq(parts.partNumber, p.partNumber)))
      .limit(1);
    if (ada) {
      petaPart.set(p.partNumber, ada.id);
      tulis('part', { tindakan: 'ada', pesan: `${p.partNumber} (#${ada.id})` });
      if ((ada.backNumber ?? null) !== p.backNumber) {
        bedaDariLama.push(
          `${p.partNumber}: back number di basis data ${ada.backNumber ?? '(kosong)'}, ` +
            `di Gentani ${p.backNumber ?? '(kosong)'}`,
        );
      }
      continue;
    }

    const nilai = {
      plantId: pabrik.id,
      lineId: petaLini.get(`${p.pcode} ${p.lineNo}`) ?? null,
      partNumber: p.partNumber,
      backNumber: p.backNumber,
      project: p.product || null,
      name: p.name,
      processType: jenis as ProcessType,
      partType: posisiPart(p),
      sourceType: p.sourceType,
      trackingMode: caraTelusur(p),
      uom: p.uom,
      /* Production Version tidak ada di Gentani — lihat catatan di data/gentani-unit.ts. */
      productionVersion: null,
      qtyPerKanban: p.qtyPerBox,
    };
    if (TERAPKAN) {
      const hasil = await db.insert(parts).values(nilai).returning({ id: parts.id });
      petaPart.set(p.partNumber, Number(hasil[0]?.id));
    }
    tulis('part', {
      tindakan: 'baru',
      pesan:
        `${p.partNumber.padEnd(22)}${(p.backNumber ?? '-').padEnd(6)}` +
        `${nilai.processType.padEnd(20)}${nilai.partType.padEnd(15)}` +
        `${nilai.trackingMode.padEnd(9)}${nilai.uom.padEnd(5)}` +
        `qty/box ${p.qtyPerBox ?? p.qtyBoxRaw ?? '-'}`,
    });
  }

  /* ── Rute proses ───────────────────────────────────────────────────────── */
  /*
   * Satu langkah per part, bukan rantai.
   *
   * AIIA memberi nomor part berbeda untuk setiap tahap (-02 melting, -04 die
   * casting, tanpa sufiks machining), jadi satu part memang hanya melewati satu
   * proses. Rantainya adalah konsumsi BOM antar part, dan BOM belum diisi —
   * lihat data/gentani-unit.ts.
   */
  for (const p of GENTANI_UNIT) {
    const partId = petaPart.get(p.partNumber);
    const jenis = p.processType ?? JENIS_BELI;
    if (!jenis) continue;
    if (!partId) {
      if (TERAPKAN) continue;
      tulis('rute', { tindakan: 'baru', pesan: `${p.partNumber} -> ${jenis} seq 10 (part baru)` });
      continue;
    }
    const [ada] = await db
      .select({ id: partProcesses.id })
      .from(partProcesses)
      .where(
        and(eq(partProcesses.partId, partId), eq(partProcesses.processType, jenis as ProcessType)),
      )
      .limit(1);
    if (ada) {
      tulis('rute', { tindakan: 'ada', pesan: `${p.partNumber} -> ${jenis}` });
      continue;
    }
    if (TERAPKAN) {
      await db.insert(partProcesses).values({
        plantId: pabrik.id,
        partId,
        processType: jenis as ProcessType,
        seqNo: 10,
        lineId: petaLini.get(`${p.pcode} ${p.lineNo}`) ?? null,
      });
    }
    tulis('rute', {
      tindakan: 'baru',
      pesan: `${p.partNumber.padEnd(22)}-> ${jenis.padEnd(20)}seq 10   lini ${p.pcode} ${p.lineNo}`,
    });
  }

  /* ── Nomor part customer ───────────────────────────────────────────────── */
  for (const p of GENTANI_UNIT) {
    if (!p.custPartNo || !p.destCustomer) continue;
    const partId = petaPart.get(p.partNumber);
    const customerId = petaCustomer.get(p.destCustomer);

    /*
     * Dalam mode hanya melihat, part/customer baru belum punya id karena belum
     * benar-benar ditulis. Ketiadaan id itu tetap boleh dilaporkan sebagai
     * pemetaan "baru" HANYA bila part-nya memang termasuk rencana impor.
     *
     * Tanpa pembeda ini, dua part beli tujuan TTI dilaporkan sebagai pemetaan
     * baru walau part-nya sengaja dilewati. Saat --terapkan, pemetaan itu lalu
     * hilang diam-diam karena `partId` tidak pernah ada.
     */
    const jenis = p.processType ?? JENIS_BELI;
    const partAkanAda = partId !== undefined || (!TERAPKAN && jenis !== null);
    const customerAkanAda = customerId !== undefined || !TERAPKAN;

    if (!partAkanAda || !customerAkanAda) {
      tulis('nomor part customer', {
        tindakan: 'lewat',
        pesan:
          `${p.custPartNo} (${p.destCustomer}) -> ${p.partNumber} — ` +
          (!partAkanAda ? 'part sumber tidak diimpor' : 'customer tujuan tidak tersedia'),
      });
      continue;
    }

    if (!partId || !customerId) {
      if (!TERAPKAN) {
        tulis('nomor part customer', {
          tindakan: 'baru',
          pesan: `${p.custPartNo} (${p.destCustomer}) -> ${p.partNumber}`,
        });
      }
      continue;
    }
    const [ada] = await db
      .select({ id: customerParts.id })
      .from(customerParts)
      .where(
        and(
          eq(customerParts.customerId, customerId),
          eq(customerParts.customerPartNumber, p.custPartNo),
        ),
      )
      .limit(1);
    if (ada) {
      tulis('nomor part customer', {
        tindakan: 'ada',
        pesan: `${p.custPartNo} (${p.destCustomer})`,
      });
      continue;
    }
    if (TERAPKAN) {
      await db.insert(customerParts).values({
        partId,
        customerId,
        customerPartNumber: p.custPartNo,
        qtyPerKanban: p.qtyPerBox,
      });
    }
    tulis('nomor part customer', {
      tindakan: 'baru',
      pesan: `${p.custPartNo.padEnd(18)}${p.destCustomer.padEnd(8)}-> ${p.partNumber}`,
    });
  }

  /* ── Laporan ───────────────────────────────────────────────────────────── */
  for (const [bagian, daftar] of Object.entries(catat)) {
    const baru = daftar.filter((c) => c.tindakan === 'baru');
    const ada = daftar.filter((c) => c.tindakan === 'ada');
    const lewat = daftar.filter((c) => c.tindakan === 'lewat');
    console.log(
      `\n── ${bagian}: ${baru.length} baru, ${ada.length} sudah ada, ${lewat.length} dilewati`,
    );
    for (const c of baru) console.log(`   + ${c.pesan}`);
    /*
     * Yang dilewati karena data sumbernya bermasalah harus terbaca satu per
     * satu — itu daftar kerja untuk orang yang memelihara Gentani. Yang
     * dilewati karena keputusan yang belum diambil (part beli) cukup
     * jumlahnya, sebab alasannya satu dan sudah tertulis di kepala skrip.
     */
    const perlu = lewat.filter((c) => c.pesan.includes('—'));
    for (const c of perlu) console.log(`   ! ${c.pesan}`);
    if (lewat.length > perlu.length) {
      console.log(
        `   (dilewati ${lewat.length - perlu.length} karena keputusan belum diambil, ` +
          'lihat catatan di kepala skrip)',
      );
    }
  }

  if (bedaDariLama.length) {
    console.log(`\n── SELISIH dengan part yang sudah ada (tidak ditimpa, perlu diputuskan orang)`);
    for (const b of bedaDariLama) console.log(`   ! ${b}`);
  }

  console.log(`\n── baris Gentani yang sengaja tidak diimpor: ${GENTANI_UNIT_DILEWATI.length}`);
  const alasan = new Map<string, number>();
  for (const d of GENTANI_UNIT_DILEWATI) alasan.set(d.alasan, (alasan.get(d.alasan) ?? 0) + 1);
  for (const [a, n] of alasan) console.log(`   ${n.toString().padStart(3)}  ${a}`);

  if (!TERAPKAN) console.log('\nTidak ada yang ditulis. Jalankan ulang dengan --terapkan.');
  await closeDb();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeDb();
  process.exit(1);
});
