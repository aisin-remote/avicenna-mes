import { boolean, index, integer, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import {
  PART_TYPES,
  SOURCE_TYPES,
  TRACKING_MODES,
  daftarNilai,
  enumCol,
  fk,
  masterSchema,
  pk,
  timestamps,
  type ProcessType,
} from './_shared';
import { PROCESS_GROUPS, SAP_CLASSES, SCAN_MODE_ENUM } from '@avicenna/contracts';
import { plants } from './org';

/** Line produksi. Satu line terikat pada satu pabrik dan satu jenis proses. */
export const lines = masterSchema.table(
  'TM_LINE',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code)
      .notNull(),
    /**
     * Penimpa METODE SCAN untuk lini ini. Kosong = ikut master Jenis Proses.
     *
     * Injection dan assembling BODY ada di pabrik yang sama tetapi caranya
     * berbeda: yang satu mulai dari tag mold, yang lain dari papan dandori.
     * Tanpa penimpa per lini, keduanya terpaksa berbagi satu metode yang tidak
     * cocok untuk salah satunya.
     */
    scanMode: enumCol('CHR_SCAN_MODE', SCAN_MODE_ENUM),
    /**
     * Work center SAP untuk lini ini. Kosong = hasil produksinya DITAHAN.
     *
     * ── Kenapa kolom sendiri, bukan memakai CHR_CODE ────────────────────────
     *
     * Dulu push hasil produksi mengirim `CHR_CODE` lini sebagai
     * CHR_WORK_CENTER. Kode kita berbentuk lain — `AS-02`, `INJ-01`, `MC-01` —
     * sedangkan SAP memakai enam karakter tanpa pemisah: `DCAA01`, `ASDL01`,
     * `GIIH01`. Tidak satu pun kode berstrip kita dikenal di sana, jadi setiap
     * dokumen produksi membawa work center yang tidak ada.
     *
     * Dipisah karena keduanya milik pihak berbeda: kode lini muncul di alamat
     * halaman dan bookmark layar lantai, sedangkan work center milik SAP dan
     * bisa berubah tanpa lini kita berganti nama.
     *
     * KOSONG BERARTI DITAHAN, bukan ditebak. Lini yang belum punya padanan di
     * SAP memunculkan dokumen HELD dengan sebab tertulis — satu-satunya
     * kegagalan yang bisa dilihat orang. Menebak dari kode lini berarti
     * barisnya tersaring penjemput SAP tanpa jejak sama sekali.
     */
    sapWorkCenter: varchar('CHR_SAP_WORK_CENTER', { length: 10 }),
    /*
     * SLOC asal dan tujuan line ini.
     *
     * Produksi adalah perpindahan barang, bukan sekadar penambahan: komponen
     * KELUAR dari gudang WIP dan barang jadi MASUK ke gudang finish good. Tanpa
     * kedua kolom ini sistem tidak tahu SLOC mana yang harus dipotong dan mana
     * yang ditambah, sehingga saldo totalnya benar tetapi saldo per SLOC —
     * justru angka yang dicocokkan dengan SAP — tidak akan pernah cocok.
     *
     * Disimpan per line, bukan diturunkan dari jenis lokasi, karena satu pabrik
     * bisa punya beberapa gudang WIP dan tebakan berdasarkan jenis akan salah
     * begitu gudang kedua dibuat.
     *
     * Tanpa .references(): `locations` didefinisikan di inventory.ts yang
     * sendirinya mengimpor berkas ini, jadi menambahkan rujukannya membuat
     * impor berputar. Keutuhannya dijaga di service — lokasi wajib milik pabrik
     * yang sama, dan itu memang pemeriksaan yang tidak bisa dilakukan FK.
     */
    inputLocationId: fk('INT_INPUT_LOCATION_ID'),
    outputLocationId: fk('INT_OUTPUT_LOCATION_ID'),
    sortOrder: integer('INT_SORT_ORDER').notNull().default(0),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_LINE_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_LINE_PROCESS_IDX').on(t.processType),
    daftarNilai('TM_LINE_CHR_SCAN_MODE_CHK', t.scanMode, SCAN_MODE_ENUM),
  ],
);

export const customers = masterSchema.table(
  'TM_CUST',
  {
    id: pk(),
    code: varchar('CHR_CUST_NO', { length: 32 }).notNull(),
    name: varchar('CHR_CUST_NAME', { length: 128 }).notNull(),
    /** Dock tujuan pengiriman (TMMIN dsb). */
    dock: varchar('CHR_DOCK', { length: 32 }),
    /**
     * Aturan penulisan nomor part pada barcode customer.
     *
     * Di bella aturan ini dipilih berdasarkan ID customer yang di-hardcode
     * (14 dan 22 untuk SUZUKI, 6/23/24/28 untuk MMKI). ID itu tidak akan sama
     * setelah data dipindah, dan aturan yang bergantung pada nomor baris
     * database akan diam-diam salah begitu urutannya berubah.
     */
    partNumberFormat: enumCol('CHR_PART_NUMBER_FORMAT', [
      'TMMIN',
      'SUZUKI',
      'MMKI',
      'TBINA',
      'NONE',
    ])
      .notNull()
      .default('NONE'),
    /**
     * Customer yang memakai kanban miliknya sendiri.
     *
     * Bedanya di dua tempat:
     *   lini FG   yang ditempel kartu customer, bukan kartu internal
     *   delivery  tidak scan apa pun — pasangannya sudah terbentuk sejak lini FG
     *
     * Customer biasa menempel kartu internal di lini FG, lalu di delivery
     * dicocokkan tiga arah: loading list, kanban internal, kanban customer.
     */
    directKanban: boolean('FLG_DIRECT_KANBAN').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_CUST_CODE_UNIQUE').on(t.code),
    daftarNilai('TM_CUST_CHR_PART_NUMBER_FORMAT_CHK', t.partNumberFormat, [
      'TMMIN',
      'SUZUKI',
      'MMKI',
      'TBINA',
      'NONE',
    ]),
  ],
);

export const suppliers = masterSchema.table(
  'TM_VENDOR',
  {
    id: pk(),
    code: varchar('CHR_SUPPLIER_ID', { length: 32 }).notNull(),
    name: varchar('CHR_SUPPLIER_NAME', { length: 128 }).notNull(),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_VENDOR_CODE_UNIQUE').on(t.code)],
);

/**
 * Part versi internal — penggabungan `internal_parts` (bella) dan `avi_parts` (avicenna).
 * `back_number` dipertahankan karena dipakai di seluruh proses scan kedua pabrik.
 */
export const parts = masterSchema.table(
  'TM_PARTS',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    partNumber: varchar('CHR_PART_NO', { length: 64 }).notNull(),
    backNumber: varchar('CHR_BACK_NO', { length: 64 }),
    /**
     * Proyek/model tempat part ini dipakai — TCC, OPN, CSH, 4L45W, 660A.
     *
     * Kolom biasa, bukan tabel master: dipakai untuk mengelompokkan laporan dan
     * layar monitor, dan tidak punya atribut lain yang perlu disimpan.
     *
     * Proyek TIDAK menentukan rute. Pada proyek 660A, GARNISH melewati Injection
     * lalu langsung Assembling sedangkan HANDLE melewati Painting lebih dulu —
     * jadi rute tetap melekat pada part, lihat TM_PROCESS_PARTS.
     */
    project: varchar('CHR_PROJECT', { length: 32 }),
    name: varchar('CHR_PART_NAME', { length: 191 }).notNull(),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code)
      .notNull(),
    /** Posisi part di rantai pasok — menentukan aturan apa yang berlaku baginya. */
    partType: enumCol('CHR_PART_TYPE', PART_TYPES).notNull().default('FINISHED_GOOD'),
    /** Dibeli atau diproduksi sendiri. */
    sourceType: enumCol('CHR_SOURCE_TYPE', SOURCE_TYPES).notNull().default('MANUFACTURED'),
    /**
     * Cara part ini ditelusuri. Lihat docs/traceability-model.md.
     * Raw material yang dilebur tidak mungkin berseri; part casting justru
     * sudah discan satu per satu.
     */
    trackingMode: enumCol('CHR_TRACKING_MODE', TRACKING_MODES).notNull().default('SERIAL'),
    /** Satuan. Raw material sering kilogram, bukan pcs. */
    uom: varchar('CHR_PART_UOM', { length: 16 }).notNull().default('pcs'),
    /**
     * PRODUCTION VERSION milik material ini di SAP.
     *
     * Di SAP sebuah Production Version adalah pasangan BOM + Rate Routing untuk
     * satu material di satu plant, bernomor '0001', '0002', dan seterusnya.
     * Blueprint PP AIIA menjadikannya SYARAT pembuatan kanban (PP-MD-05
     * langkah 1): Project Control memastikan dulu versinya tersedia dan valid,
     * baru kartunya dibuat.
     *
     * Disimpan di part, bukan hanya di kartu, karena versinya memang milik
     * MATERIAL — satu part bisa punya ribuan kartu, dan mengetik versinya satu
     * per satu adalah cara paling pasti untuk membuat sebagian kartu memakai
     * versi yang berbeda tanpa ada yang menyadarinya. Kartu mewarisi dari sini.
     *
     * Kosong sampai diisi orang atau ditarik dari SAP. Blueprint menyebut SAP
     * sebagai pemiliknya ("source of truth") dan akan mendorongnya ke sistem
     * ini, tetapi spesifikasi antarmukanya belum ada — lihat docs/sap-integration.md.
     */
    productionVersion: varchar('CHR_PRODUCTION_VERSION', { length: 8 }),
    /** Jumlah pcs per kanban standar (bisa dioverride per customer di customer_parts). */
    qtyPerKanban: integer('INT_QTY_PER_BOX'),
    standardStock: integer('INT_STANDARD_STOCK').notNull().default(0),
    photoPath: varchar('CHR_PHOTO_PATH', { length: 255 }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PARTS_PLANT_PARTNUMBER_UNIQUE').on(t.plantId, t.partNumber),
    index('TM_PARTS_BACK_NUMBER_IDX').on(t.backNumber),
    index('TM_PARTS_LINE_IDX').on(t.lineId),
    daftarNilai('TM_PARTS_CHR_PART_TYPE_CHK', t.partType, PART_TYPES),
    daftarNilai('TM_PARTS_CHR_SOURCE_TYPE_CHK', t.sourceType, SOURCE_TYPES),
    daftarNilai('TM_PARTS_CHR_TRACKING_MODE_CHK', t.trackingMode, TRACKING_MODES),
  ],
);

/**
 * ─── JENIS PROSES — kosakata yang dulu ditanam di kode ──────────────────────
 *
 * Satu baris = satu LINI yang berbeda secara fisik: Casting WIP dan Casting FG
 * adalah dua baris, bukan satu baris dengan penanda.
 *
 * ── Kenapa pindah dari enum ke tabel ────────────────────────────────────────
 *
 * Daftarnya berubah mengikuti pabrik, bukan mengikuti rilis. Dalam satu bulan
 * ia bertambah pabrik Electric (empat proses), lalu Inspection dan Vacuum
 * dipecah WIP/FG, lalu Injection dan Painting menyusul. Setiap kali: sunting
 * enum, sunting tiga peta klasifikasi, tulis migrasi yang memindahkan nilai
 * lama, lalu deploy. Orang yang tahu pabriknya harus menunggu orang yang tahu
 * kodenya.
 *
 * ── Yang HILANG karena perpindahan ini, dan penggantinya ────────────────────
 *
 * Dulu `Record<ProcessType, …>` memaksa compiler menolak proses baru yang
 * belum diklasifikasikan — itulah yang menangkap proses Electric yang lupa
 * diberi kelas SFG/FG. Sekarang penjagaannya pindah ke KOLOM: ketiganya
 * NOT NULL tanpa bawaan, jadi baris baru tidak bisa lahir tanpa menjawab
 * pertanyaan yang sama.
 *
 *   CHR_SAP_CLASS    menentukan SLOC hasil DAN dokumen SAP-nya
 *   CHR_PROCESS_GROUP  lingkup role — siapa boleh men-scan di lini ini
 *   CHR_SCAN_MODE    metode scan; master Line boleh menimpanya per lini
 *
 * ── Kodenya, bukan id-nya, yang disimpan di tabel lain ──────────────────────
 *
 * Tujuh kolom CHR_PROCESS_TYPE di lima tabel menyimpan KODE-nya, dan
 * menunjuk ke sini lewat foreign key. Menggantinya dengan id berarti menyunting
 * setiap kueri yang membandingkan jenis proses, dan tidak ada yang didapat:
 * kodenya sudah unik, sudah terbaca manusia, dan sudah terlanjur ada di
 * seluruh data lama.
 */
export const processTypes = masterSchema.table(
  'TM_PROCESS_TYPE',
  {
    id: pk(),
    /** Dipakai sebagai nilai di seluruh kolom CHR_PROCESS_TYPE. */
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    /** Yang dibaca orang di kepala kolom dan di laporan. */
    label: varchar('CHR_LABEL', { length: 64 }).notNull(),
    processGroup: enumCol('CHR_PROCESS_GROUP', PROCESS_GROUPS).notNull(),
    sapClass: enumCol('CHR_SAP_CLASS', SAP_CLASSES).notNull(),
    /** Metode scan proses ini. TM_LINE boleh menimpanya per lini. */
    scanMode: enumCol('CHR_SCAN_MODE', SCAN_MODE_ENUM).notNull(),
    /**
     * Urutan kolom di matriks rute.
     *
     * BUKAN urutan rute: rute melekat pada part lewat INT_SEQ_NO, dan matriks
     * menyusunnya dari urutan klik. Yang ini hanya pengelompokan di layar
     * supaya enak dibaca — proses satu pabrik berdampingan.
     */
    sortOrder: integer('INT_SORT_ORDER').notNull().default(0),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PROCESS_TYPE_CODE_UNIQUE').on(t.code),
    index('TM_PROCESS_TYPE_ORDER_IDX').on(t.sortOrder),
    daftarNilai('TM_PROCESS_TYPE_CHR_PROCESS_GROUP_CHK', t.processGroup, PROCESS_GROUPS),
    daftarNilai('TM_PROCESS_TYPE_CHR_SAP_CLASS_CHK', t.sapClass, SAP_CLASSES),
    daftarNilai('TM_PROCESS_TYPE_CHR_SCAN_MODE_CHK', t.scanMode, SCAN_MODE_ENUM),
  ],
);

/**
 * RUTE PROSES PER PART — proses apa saja yang harus dilalui sebuah part, dan
 * dalam urutan yang mana.
 *
 * ── Kenapa tabel, bukan aturan di kode ──────────────────────────────────────
 *
 * Sebelumnya urutan proses adalah satu rantai global di process-chain.ts, sama
 * untuk semua part. Kenyataannya di AIIA tiap part punya rutenya sendiri:
 *
 *   TCC A   Melting -> Casting -> Machining -> Assembling -> Delivery
 *   OPN A   Melting -> Casting -> Machining -> Delivery
 *   CSH A   Melting -> Casting -> Delivery
 *   HANDLE  Injection -> Painting -> Assembling -> Delivery
 *   GARNISH Injection -> Assembling -> Delivery
 *
 * Satu rantai global tidak bisa menyatakan bahwa proses sebelum Delivery adalah
 * Casting untuk CSH A, Machining untuk OPN A, dan Assembling untuk TCC A. Dan
 * karena rutenya bertambah setiap kali ada part baru, ia harus jadi data yang
 * bisa diubah lewat master — bukan kode yang menuntut deploy.
 *
 * ── Kenapa berkunci part, bukan proyek ──────────────────────────────────────
 *
 * Dua part dalam proyek yang sama bisa berbeda rute. Pada proyek 660A, GARNISH
 * tidak melewati Painting sedangkan HANDLE melewatinya. Mengikat rute ke proyek
 * akan membuat salah satunya selalu keliru.
 */
export const partProcesses = masterSchema.table(
  'TM_PROCESS_PARTS',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code)
      .notNull(),
    /**
     * Urutan dalam rangkaian produksi. Bukan urutan global.
     *
     * Part number berubah di tiap tahap, jadi urutan ini tidak dipakai memeriksa
     * tahap sebelumnya saat scan. Work center alternatif berbagi nilai yang sama.
     */
    seqNo: integer('INT_SEQ_NO').notNull(),
    /**
     * Work center yang mengerjakannya. Work center alternatif memakai baris sendiri.
     *
     * Baris tanpa line masih berlaku untuk scan di line berproses sama, supaya
     * rute lama yang belum dilengkapi tidak berubah perilakunya.
     */
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    /**
     * Production Version SAP untuk LANGKAH ini. Kosong = ikut TM_PARTS.
     *
     * ── Kenapa di sini, bukan di part ───────────────────────────────────────
     *
     * PV adalah pasangan (alternatif BOM + routing) untuk satu material, dan
     * di SAP ia berkunci (nomor part + PV) — satu baris per langkah proses.
     * Terbukti dari staging: part `-3121104010B1` punya ENAM PV, masing-masing
     * terikat work center, dan tiga di antaranya berbagi work center yang sama.
     *
     * `TM_PARTS.CHR_PRODUCTION_VERSION` menyimpan satu nilai per part, jadi
     * part yang lewat casting lalu machining lalu assembly hanya bisa membawa
     * satu dari tiga versinya. Itulah sebabnya kolom itu masih kosong pada 89
     * dari 92 part UNIT: tidak ada satu nilai yang benar untuk diisi.
     *
     * Yang di TM_PARTS dibiarkan sebagai cadangan selama peralihan — bukan
     * sumber kedua. Begitu tarik SAP mengisi kolom ini untuk seluruh langkah,
     * kolom di part tidak dipakai lagi.
     */
    productionVersion: varchar('CHR_PRODUCTION_VERSION', { length: 8 }),
    /*
     * ── Rute per work center ────────────────────────────────────────────────
     *
     * Part menempel pada work center: satu baris di sini menjawab sendiri SLOC,
     * metode scan, dan izin SAP untuk part di work center itu. Line DCAA08
     * mengerjakan part WIP dan FG sekaligus, jadi jawabannya tidak bisa
     * disimpan per line maupun per jenis proses.
     *
     * Kosong berarti memakai milik line saat scan.
     */
    /** SLOC asal. */
    inputLocationId: fk('INT_INPUT_LOCATION_ID'),
    /** SLOC tujuan. */
    outputLocationId: fk('INT_OUTPUT_LOCATION_ID'),
    /** Metode scan part ini di work center ini. */
    scanMode: enumCol('CHR_SCAN_MODE', SCAN_MODE_ENUM),
    /** Izin membuat dokumen produksi ke staging SAP. Nonaktif = dokumen ditahan (HELD). */
    sapProductionEnabled: boolean('FLG_SAP_PRODUCTION_ENABLED').notNull().default(false),
    /**
     * Work center yang tercetak di QR kartu kanban.
     *
     * Part yang punya work center alternatif tetap hanya punya satu kartu, jadi
     * satu baris harus ditunjuk. Paling banyak satu per part; dijaga indeks di
     * bawah, bukan oleh layar.
     */
    isPrimary: boolean('FLG_IS_PRIMARY').notNull().default(false),
    /** SLOC tempat hasil dipindah setelah produksi. Kosong = tidak dipindah lagi. */
    transferLocationId: fk('INT_TRANSFER_LOCATION_ID'),
    /** Izin membuat dokumen transfer ke staging SAP. */
    sapTransferEnabled: boolean('FLG_SAP_TRANSFER_ENABLED').notNull().default(false),
    sapTransferMovementType: varchar('CHR_SAP_TRANSFER_MVT', { length: 3 }),
    /** Kartu harus melewati stasiun belanja sebelum boleh discan di sini. */
    requirePairing: boolean('FLG_REQUIRE_PAIRING').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    /*
     * Satu part hanya sekali di satu work center. Work center alternatif memakai
     * baris sendiri dan boleh berbagi proses maupun sequence, jadi keduanya
     * tidak lagi unik per part. Baris tanpa line (Delivery) tetap unik per proses.
     */
    uniqueIndex('TM_PROCESS_PARTS_PART_LINE_UNIQUE')
      .on(t.partId, t.lineId)
      .where(sql`${t.lineId} is not null`),
    uniqueIndex('TM_PROCESS_PARTS_PART_PROCESS_NOLINE_UNIQUE')
      .on(t.partId, t.processType)
      .where(sql`${t.lineId} is null`),
    index('TM_PROCESS_PARTS_PLANT_PROCESS_IDX').on(t.plantId, t.processType),
    uniqueIndex('TM_PROCESS_PARTS_PART_PRIMARY_UNIQUE').on(t.partId).where(sql`${t.isPrimary}`),
    daftarNilai('TM_PROCESS_PARTS_CHR_SCAN_MODE_CHK', t.scanMode, SCAN_MODE_ENUM),
  ],
);

/**
 * ─── Pengaturan stok & SAP per proses (lama) ────────────────────────────────
 *
 * Tidak dibaca lagi sejak scan, cetak kanban, dan belanja memakai rute per work
 * center (TM_PROCESS_PARTS). Tabelnya dibiarkan sampai peralihan terbukti
 * berjalan, supaya masih ada jalan kembali.
 */
export const routeProcesses = masterSchema.table(
  'TM_ROUTE_PROCESS',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    processType: varchar('CHR_PROCESS_TYPE', { length: 32 })
      .$type<ProcessType>()
      .references(() => processTypes.code)
      .notNull(),
    /**
     * Scan produksi di proses ini WAJIB didahului belanja.
     *
     * Belanja = kartu FG dicocokkan dengan kartu-kartu WIP yang isinya sesuai
     * BOM. Tanpa pencocokan itu, scan produksinya ditolak — itulah interlock-nya.
     *
     * ── Kenapa per (pabrik + proses), bukan per project ─────────────────────
     *
     * Di bella aturan ini berupa daftar putih di dalam kode
     * (`KanbanPairing::INTERLOCK_PROJECTS = ['660A']`), jadi menyalakannya
     * untuk project berikutnya menuntut deploy — dan daftar itu tidak terlihat
     * oleh siapa pun yang memakai aplikasinya. Di sini keadaannya terbaca di
     * master Rute Proses, sebaris dengan bendera SAP yang sudah ada.
     *
     * Bawaannya mati: proses yang tidak pernah belanja tidak boleh berubah
     * perilakunya hanya karena kolomnya ditambahkan.
     */
    requirePairing: boolean('FLG_REQUIRE_PAIRING').notNull().default(false),
    /** Kosong = pakai SLOC asal lini. */
    inputLocationId: fk('INT_INPUT_LOCATION_ID'),
    /** Kosong = pakai SLOC tujuan lini. */
    outputLocationId: fk('INT_OUTPUT_LOCATION_ID'),
    /** Bila diisi, hasil scan langsung dipindah dari SLOC keluar ke sini. */
    transferLocationId: fk('INT_TRANSFER_LOCATION_ID'),
    /** Izin membuat dokumen produksi ke staging SAP. Nonaktif = dokumen ditahan (HELD). */
    sapProductionEnabled: boolean('FLG_SAP_PRODUCTION_ENABLED').notNull().default(false),
    /** Izin membuat dokumen transfer SLOC ke staging SAP. Butuh transferLocationId. */
    sapTransferEnabled: boolean('FLG_SAP_TRANSFER_ENABLED').notNull().default(false),
    /** Movement type SAP untuk transfer, mis. 311. Belum dikonfirmasi tim SAP. */
    sapTransferMovementType: varchar('CHR_SAP_TRANSFER_MVT', { length: 3 }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_ROUTE_PROCESS_PLANT_PROCESS_UNIQUE').on(t.plantId, t.processType),
  ],
);

export const routeProcessesRelations = relations(routeProcesses, ({ one }) => ({
  plant: one(plants, { fields: [routeProcesses.plantId], references: [plants.id] }),
}));

export const partProcessesRelations = relations(partProcesses, ({ one }) => ({
  plant: one(plants, { fields: [partProcesses.plantId], references: [plants.id] }),
  part: one(parts, { fields: [partProcesses.partId], references: [parts.id] }),
  line: one(lines, { fields: [partProcesses.lineId], references: [lines.id] }),
}));

/**
 * PROGRAM NUMBER — dua digit pertama pada barcode part.
 *
 * Diambil dari `avi_trace_program_number` sistem lama (944 baris). Dua digit itu
 * yang menerjemahkan barcode menjadi part: sisa barcode tidak memuat nomor part
 * sama sekali, hanya identitas unitnya.
 *
 * ── Kenapa berdiri sendiri, bukan kolom di TM_PARTS ─────────────────────────
 *
 * Satu part bisa punya BEBERAPA program number, satu per model. Pada data lama,
 * kode "10" dan "15" sama-sama menunjuk part 243202-10630 tetapi model
 * "OPN 889F" dan "OPN D81F". Menyimpannya sebagai kolom di part memaksa memilih
 * salah satu, dan modelnya hilang.
 *
 * ── Dipakai untuk apa ───────────────────────────────────────────────────────
 *
 * 1. Menerjemahkan barcode 15 karakter menjadi part saat scan produksi.
 * 2. Mencocokkan model part dengan kanban — kartu kanban terikat pada back
 *    number, dan back number itu datang dari sini.
 */
export const programNumbers = masterSchema.table(
  'TM_PROGRAM_NUMBER',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    /** Dua digit pertama barcode. Unik per pabrik. */
    code: varchar('CHR_CODE', { length: 4 }).notNull(),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id),
    /** Model, mis. "OPN 889F". Inilah yang membedakan dua kode pada part yang sama. */
    product: varchar('CHR_PRODUCT', { length: 64 }),
    customerId: fk('INT_CUSTOMER_ID').references(() => customers.id),
    /** Part rakitan — dipakai sistem lama membedakan perlakuan scan. */
    isAssy: boolean('FLG_IS_ASSY').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_PROGRAM_NUMBER_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_PROGRAM_NUMBER_PART_IDX').on(t.partId),
  ],
);

export const programNumbersRelations = relations(programNumbers, ({ one }) => ({
  plant: one(plants, { fields: [programNumbers.plantId], references: [plants.id] }),
  part: one(parts, { fields: [programNumbers.partId], references: [parts.id] }),
  customer: one(customers, { fields: [programNumbers.customerId], references: [customers.id] }),
}));

/** Pemetaan part internal -> penomoran milik customer. */
export const customerParts = masterSchema.table(
  'TM_SHIPPING_PARTS',
  {
    id: pk(),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    customerPartNumber: varchar('CHR_CUS_PART_NO', { length: 64 }).notNull(),
    customerBackNumber: varchar('CHR_CUS_BACK_NO', { length: 64 }),
    qtyPerKanban: integer('INT_QTY_PER_BOX'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_SHIPPING_PARTS_UNIQUE').on(t.customerId, t.customerPartNumber),
    index('TM_SHIPPING_PARTS_PART_IDX').on(t.partId),
  ],
);

/** Mesin produksi. `externalRef` menautkan ke ID mesin di SQL Server J922. */
export const machines = masterSchema.table(
  'TM_MACHINE',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    lineId: fk('INT_LINE_ID').references(() => lines.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    externalRef: varchar('CHR_EXTERNAL_REF', { length: 64 }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_MACHINE_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    index('TM_MACHINE_EXTERNAL_REF_IDX').on(t.externalRef),
  ],
);

/** Tooling: mold (injection) dan dies (casting) disatukan di sini. */
export const toolings = masterSchema.table(
  'TM_TOOLING',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    kind: enumCol('CHR_KIND', ['MOLD', 'DIES', 'JIG']).notNull(),
    cavity: integer('INT_CAVITY').notNull().default(1),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_TOOLING_PLANT_CODE_UNIQUE').on(t.plantId, t.code),
    daftarNilai('TM_TOOLING_CHR_KIND_CHK', t.kind, ['MOLD', 'DIES', 'JIG']),
  ],
);

export const toolingParts = masterSchema.table(
  'TM_TOOLING_PARTS',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    toolingId: fk('INT_TOOLING_ID')
      .notNull()
      .references(() => toolings.id, { onDelete: 'cascade' }),
    partId: fk('INT_PART_ID')
      .notNull()
      .references(() => parts.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_TOOLING_PARTS_UNIQUE').on(t.toolingId, t.partId),
    index('TM_TOOLING_PARTS_PLANT_IDX').on(t.plantId),
  ],
);

export const linesRelations = relations(lines, ({ one, many }) => ({
  plant: one(plants, { fields: [lines.plantId], references: [plants.id] }),
  parts: many(parts),
  machines: many(machines),
}));

export const partsRelations = relations(parts, ({ one, many }) => ({
  plant: one(plants, { fields: [parts.plantId], references: [plants.id] }),
  line: one(lines, { fields: [parts.lineId], references: [lines.id] }),
  customerParts: many(customerParts),
}));

export const customerPartsRelations = relations(customerParts, ({ one }) => ({
  part: one(parts, { fields: [customerParts.partId], references: [parts.id] }),
  customer: one(customers, { fields: [customerParts.customerId], references: [customers.id] }),
}));

export const machinesRelations = relations(machines, ({ one }) => ({
  plant: one(plants, { fields: [machines.plantId], references: [plants.id] }),
  line: one(lines, { fields: [machines.lineId], references: [lines.id] }),
}));
