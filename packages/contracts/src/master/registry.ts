import { z } from 'zod';

/**
 * Daftar entitas master beserta definisi kolomnya.
 *
 * INI SATU-SATUNYA SUMBER KEBENARAN untuk CRUD master data. API memakainya
 * untuk validasi, dan UI memakainya untuk membangun tabel serta formulir.
 * Menambah kolom cukup dilakukan di sini — endpoint, tabel, dan formulirnya
 * ikut menyesuaikan sendiri.
 *
 * Alasan dibuat begini: ada sembilan entitas master dengan pola yang persis
 * sama. Menulisnya satu per satu berarti sembilan tempat yang harus diubah
 * setiap kali ada kolom baru, dan sembilan kesempatan untuk lupa.
 */

export const MASTER_ENTITIES = [
  'plants',
  'lines',
  'parts',
  'customers',
  'suppliers',
  'machines',
  'toolings',
  'locations',
  'ng-masters',
  'bom',
  'part-processes',
  'route-processes',
  'kanbans',
  'program-numbers',
  'work-times',
  'work-breaks',
  'stop-reasons',
] as const;

export type MasterEntity = (typeof MASTER_ENTITIES)[number];

/*
 * Diambil dari processTypeSchema, TIDAK ditulis ulang.
 *
 * Sebelumnya daftar ini salinan tersendiri, dan saat jenis proses bertambah
 * salinan ini tertinggal: formulir master menawarkan nilai yang sudah tidak ada
 * di kolom enum, lalu setiap penyimpanan gagal dengan pesan dari MySQL yang
 * tidak menyebut sebabnya.
 */
export { PROCESS_TYPES, PROCESS_GROUPS, SCAN_MODES, SCAN_MODE_LABELS } from '../common';
import { PROCESS_TYPES, PROCESS_GROUPS, SCAN_MODES, SCAN_MODE_LABELS } from '../common';
export const KANBAN_TYPES = ['REGULER', 'SPARE'] as const;
export const KANBAN_OWNERS = ['INTERNAL', 'CUSTOMER'] as const;
export type KanbanOwner = (typeof KANBAN_OWNERS)[number];
export const TOOLING_KINDS = ['MOLD', 'DIES', 'JIG'] as const;
export const LOCATION_KINDS = [
  'WAREHOUSE',
  'WIP',
  'FINISH_GOOD',
  'STAGING',
  'CHUTE',
  'NG',
  'TRANSIT',
] as const;
export const PART_TYPES = ['RAW_MATERIAL', 'COMPONENT', 'WIP', 'FINISHED_GOOD'] as const;
export const SOURCE_TYPES = ['PURCHASED', 'MANUFACTURED'] as const;
export const TRACKING_MODES = ['SERIAL', 'LOT', 'QUANTITY'] as const;
export const PART_NUMBER_FORMATS = ['TMMIN', 'SUZUKI', 'MMKI', 'TBINA', 'NONE'] as const;

/** Kategori alasan berhenti — harus sama dengan STOP_REASON_CATEGORIES di @avicenna/db. */
export const STOP_REASON_CATEGORIES = [
  'PROBLEM',
  'SETUP',
  'QC',
  'CHANGEOVER',
  'MATERIAL',
  'LAINNYA',
] as const;
export type StopReasonCategory = (typeof STOP_REASON_CATEGORIES)[number];

export const STOP_REASON_CATEGORY_LABELS: Record<StopReasonCategory, string> = {
  PROBLEM: 'Problem / kerusakan',
  SETUP: 'Setup / dandori',
  QC: 'Pemeriksaan kualitas',
  CHANGEOVER: 'Ganti model',
  MATERIAL: 'Material habis / menunggu',
  LAINNYA: 'Lainnya',
};

export type FieldKind =
  | 'text'
  | 'number'
  | 'decimal'
  | 'date'
  | 'boolean'
  | 'select'
  | 'reference'
  /**
   * Berkas gambar yang diunggah dan disimpan aplikasi.
   *
   * Yang tersimpan di kolom tetap teks — nama berkas di penyimpanan, atau
   * alamat penuh bila gambarnya memang sudah ada di server lain. Yang berubah
   * hanya cara mengisinya: orang memilih berkas, bukan mengetik nama yang
   * harus ia cocokkan sendiri dengan isi folder.
   */
  | 'image';

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  /** Wajib diisi saat membuat data baru. */
  required?: boolean;
  /** Pilihan untuk kind 'select'. */
  options?: readonly string[];
  /**
   * Label yang ditampilkan untuk tiap pilihan.
   *
   * Tanpa ini layar menampilkan nilai enum apa adanya. Untuk kolom seperti
   * metode scan, yang dibaca leader produksi bukan "PART_TANPA_KANBAN"
   * melainkan apa artinya di lantai. Pilihan tanpa entri di sini tampil apa
   * adanya, jadi kolom lain tidak perlu disentuh.
   */
  optionLabels?: Readonly<Record<string, string>>;
  /** Entitas tujuan untuk kind 'reference'. */
  refEntity?: MasterEntity;
  /** Tampil sebagai kolom di tabel daftar. */
  inList?: boolean;
  /** Rata kanan di tabel — untuk angka. */
  numeric?: boolean;
  max?: number;
  min?: number;
  hint?: string;
  defaultValue?: string | number | boolean;
}

export interface EntityDef {
  key: MasterEntity;
  /** Label jamak, dipakai di judul halaman dan menu. */
  label: string;
  /** Label tunggal, dipakai di tombol dan judul formulir. */
  singular: string;
  /** Nama ikon lucide-react. Dipetakan ke komponen di sisi UI. */
  icon: string;
  description: string;
  /** Kolom yang ikut dicari saat pengguna mengetik di kotak pencarian. */
  searchFields: string[];
  /** Kolom untuk mengurutkan daftar secara bawaan. */
  defaultSort: string;
  fields: FieldDef[];
}

const activeField: FieldDef = {
  name: 'isActive',
  label: 'Aktif',
  kind: 'boolean',
  inList: true,
  defaultValue: true,
  hint: 'Data non-aktif tidak muncul sebagai pilihan di modul lain, tapi riwayatnya tetap utuh.',
};

const plantRef: FieldDef = {
  name: 'plantId',
  label: 'Pabrik',
  kind: 'reference',
  refEntity: 'plants',
  required: true,
  inList: true,
};

export const ENTITY_DEFS: Record<MasterEntity, EntityDef> = {
  plants: {
    key: 'plants',
    label: 'Pabrik',
    singular: 'Pabrik',
    icon: 'Factory',
    description: 'Unit produksi yang datanya dipisahkan dalam sistem',
    searchFields: ['code', 'name'],
    defaultSort: 'code',
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        name: 'sapCode',
        label: 'Kode SAP',
        kind: 'text',
        max: 4,
        inList: true,
        hint: 'Maksimal 3 karakter — kolom CHR_PLANT di database jembatan char(3).',
      },
      {
        name: 'scanDirectKanbanSaatMuat',
        label: 'Direct Kanban Tetap Scan',
        kind: 'boolean',
        defaultValue: false,
        hint: 'Di pabrik ini, customer direct kanban tetap scan kanban customer saat muat.',
      },
      activeField,
    ],
  },

  lines: {
    key: 'lines',
    label: 'Line',
    singular: 'Line',
    icon: 'GitBranch',
    description: 'Line produksi beserta jenis prosesnya',
    searchFields: ['code', 'name'],
    defaultSort: 'code',
    fields: [
      plantRef,
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        name: 'processType',
        label: 'Proses',
        kind: 'select',
        options: PROCESS_TYPES,
        required: true,
        inList: true,
      },
      {
        name: 'scanMode',
        label: 'Metode Scan',
        kind: 'select',
        options: SCAN_MODES,
        optionLabels: SCAN_MODE_LABELS,
        inList: true,
        hint:
          'Kosongkan untuk mengikuti master Rute Proses. Isi hanya bila lini ini berbeda ' +
          'dari lini lain pada proses yang sama — mis. injection (tag mold) dan assembling ' +
          'BODY (papan dandori) di pabrik yang sama.',
      },
      {
        name: 'inputLocationId',
        label: 'SLOC Asal',
        kind: 'reference',
        refEntity: 'locations',
        hint: 'Gudang tempat komponen diambil saat produksi (WP01). Stok di sini yang berkurang.',
      },
      {
        name: 'outputLocationId',
        label: 'SLOC Tujuan',
        kind: 'reference',
        refEntity: 'locations',
        hint: 'Gudang tempat barang jadi disimpan (PP02). Stok di sini yang bertambah.',
      },
      {
        name: 'sortOrder',
        label: 'Urutan',
        kind: 'number',
        min: 0,
        defaultValue: 0,
        numeric: true,
        hint: 'Menentukan urutan tampil pada daftar dan dashboard.',
      },
      activeField,
    ],
  },

  parts: {
    key: 'parts',
    label: 'Part',
    singular: 'Part',
    icon: 'Package',
    description: 'Part internal beserta standar kemasannya',
    searchFields: ['partNumber', 'name', 'backNumber'],
    defaultSort: 'partNumber',
    fields: [
      plantRef,
      { name: 'lineId', label: 'Line', kind: 'reference', refEntity: 'lines', inList: true },
      {
        name: 'partNumber',
        label: 'Part Number',
        kind: 'text',
        required: true,
        max: 64,
        inList: true,
      },
      { name: 'backNumber', label: 'Back Number', kind: 'text', max: 64, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 191, inList: true },
      {
        name: 'processType',
        label: 'Proses',
        kind: 'select',
        options: PROCESS_TYPES,
        required: true,
        inList: true,
      },
      {
        name: 'partType',
        label: 'Jenis Part',
        kind: 'select',
        options: PART_TYPES,
        required: true,
        inList: true,
        hint: 'Posisi part di rantai pasok. Raw material tidak punya BOM; barang jadi tidak dibeli.',
      },
      {
        name: 'sourceType',
        label: 'Asal',
        kind: 'select',
        options: SOURCE_TYPES,
        required: true,
        hint: 'Dibeli dari supplier, atau diproduksi sendiri.',
      },
      {
        name: 'trackingMode',
        label: 'Cara Telusur',
        kind: 'select',
        options: TRACKING_MODES,
        required: true,
        inList: true,
        hint: 'SERIAL untuk part berbarcode satuan. LOT untuk raw material dan komponen beli yang datang per batch.',
      },
      { name: 'uom', label: 'Satuan', kind: 'text', max: 16, hint: 'pcs, kg, liter, …' },
      {
        name: 'photoPath',
        label: 'Foto Part',
        kind: 'image',
        max: 255,
        hint:
          'Ditampilkan besar di layar scan saat master sample part ini discan — operator ' +
          'mencocokkan barang di tangannya dengan gambar. Pilih berkas dari komputer; ' +
          'gambarnya disimpan di aplikasi.',
      },
      {
        name: 'qtyPerKanban',
        label: 'Qty per Kanban',
        kind: 'number',
        min: 1,
        numeric: true,
        inList: true,
        hint: 'Jumlah pcs per kanban standar. Bisa ditimpa per customer.',
      },
      {
        name: 'standardStock',
        label: 'Stok Standar',
        kind: 'number',
        min: 0,
        defaultValue: 0,
        numeric: true,
      },
      activeField,
    ],
  },

  customers: {
    key: 'customers',
    label: 'Customer',
    singular: 'Customer',
    icon: 'Users',
    description: 'Tujuan pengiriman barang jadi',
    searchFields: ['code', 'name'],
    defaultSort: 'code',
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      { name: 'dock', label: 'Dock', kind: 'text', max: 32, inList: true },
      {
        name: 'directKanban',
        label: 'Direct Kanban',
        kind: 'boolean',
        defaultValue: false,
        inList: true,
        hint: 'Memakai kanban miliknya sendiri. Di delivery tidak scan apa pun.',
      },
      {
        name: 'partNumberFormat',
        label: 'Format Part Number',
        kind: 'select',
        options: PART_NUMBER_FORMATS,
        required: true,
        inList: true,
        hint: 'Aturan penulisan nomor part pada barcode customer. Menentukan bagaimana barcode saat muat dicocokkan ke master.',
      },
      activeField,
    ],
  },

  suppliers: {
    key: 'suppliers',
    label: 'Supplier',
    singular: 'Supplier',
    icon: 'Truck',
    description: 'Pemasok material dan komponen',
    searchFields: ['code', 'name'],
    defaultSort: 'code',
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      activeField,
    ],
  },

  machines: {
    key: 'machines',
    label: 'Mesin',
    singular: 'Mesin',
    icon: 'Cog',
    description: 'Mesin produksi dan tautannya ke sumber data mesin',
    searchFields: ['code', 'name', 'externalRef'],
    defaultSort: 'code',
    fields: [
      plantRef,
      { name: 'lineId', label: 'Line', kind: 'reference', refEntity: 'lines', inList: true },
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        name: 'externalRef',
        label: 'Ref. Eksternal',
        kind: 'text',
        max: 64,
        inList: true,
        hint: 'ID mesin di SQL Server J922, dipakai worker sinkronisasi.',
      },
      activeField,
    ],
  },

  toolings: {
    key: 'toolings',
    label: 'Tooling',
    singular: 'Tooling',
    icon: 'Wrench',
    description: 'Mold, dies, dan jig',
    searchFields: ['code', 'name'],
    defaultSort: 'code',
    fields: [
      plantRef,
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        name: 'kind',
        label: 'Jenis',
        kind: 'select',
        options: TOOLING_KINDS,
        required: true,
        inList: true,
      },
      {
        name: 'cavity',
        label: 'Cavity',
        kind: 'number',
        min: 1,
        defaultValue: 1,
        numeric: true,
        inList: true,
      },
      activeField,
    ],
  },

  locations: {
    key: 'locations',
    label: 'Lokasi',
    singular: 'Lokasi',
    icon: 'MapPin',
    description: 'Area penyimpanan dan transit',
    searchFields: ['code', 'name'],
    defaultSort: 'code',
    fields: [
      plantRef,
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        name: 'kind',
        label: 'Jenis',
        kind: 'select',
        options: LOCATION_KINDS,
        required: true,
        inList: true,
      },
    ],
  },

  'ng-masters': {
    key: 'ng-masters',
    label: 'Master NG',
    singular: 'Jenis NG',
    icon: 'TriangleAlert',
    description: 'Daftar jenis defect per proses',
    searchFields: ['code', 'name', 'category'],
    defaultSort: 'code',
    fields: [
      plantRef,
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        /*
         * GRUP proses, bukan jenis proses.
         *
         * "Crack" berlaku di lini Casting WIP maupun Casting FG. Saat kolomnya
         * masih CHR_PROCESS_TYPE, jenis NG yang diisi CASTING_WIP hilang dari
         * layar lini FG dan orang di situ tidak punya pilihan apa pun.
         */
        name: 'processGroup',
        label: 'Grup Proses',
        kind: 'select',
        options: PROCESS_GROUPS,
        inList: true,
        hint: 'Kosongkan bila berlaku di semua proses — seperti tombol "DLL" di layar NG.',
      },
      { name: 'category', label: 'Kategori', kind: 'text', max: 64, inList: true },
      { name: 'sortOrder', label: 'Urutan', kind: 'number', min: 0, defaultValue: 0, numeric: true },
      activeField,
    ],
  },

  /**
   * Rute proses per part — proses apa saja yang dilalui sebuah part, urut.
   *
   * Dikelola lewat master biasa supaya penambahan part baru tidak menuntut
   * deploy. Untuk mengisi banyak part sekaligus, layar matriks di
   * /master/part-processes jauh lebih cepat daripada formulir satu per satu.
   */
  /**
   * Kartu kanban fisik.
   *
   * Serinya unik PER PART, bukan per pabrik — seri yang sama bisa ada pada part
   * berbeda. Karena itu di lini FG part code discan lebih dulu, baru kanbannya.
   */
  /**
   * Program number — dua digit pertama pada barcode part.
   *
   * Barcode produksi tidak memuat nomor part sama sekali; dua digit inilah yang
   * menerjemahkannya. Satu part boleh punya beberapa kode, satu per model.
   */
  'program-numbers': {
    key: 'program-numbers',
    label: 'Program Number',
    singular: 'Program Number',
    icon: 'Hash',
    description: 'Dua digit pertama barcode part — penerjemah barcode ke part',
    searchFields: ['code', 'product'],
    defaultSort: 'code',
    fields: [
      plantRef,
      {
        name: 'code',
        label: 'Kode',
        kind: 'text',
        required: true,
        max: 4,
        inList: true,
        hint: 'Dua digit pertama pada barcode, mis. 01, 12, 17.',
      },
      { name: 'partId', label: 'Part', kind: 'reference', refEntity: 'parts', required: true, inList: true },
      {
        name: 'product',
        label: 'Model',
        kind: 'text',
        required: true,
        max: 64,
        inList: true,
        /*
         * WAJIB, karena satu part memang punya beberapa kode program.
         *
         * Di master AIIA, 243202-10630 dipakai kode 10 (OPN 889F), 15
         * (OPN D81F), dan 18 (OPN 889F PULSE). Tanpa model, ketiganya tampil
         * sebagai baris kembar yang tidak bisa dibedakan siapa pun — dan yang
         * menyunting salah satunya tidak punya cara tahu mana yang ia ubah.
         */
        hint: 'Mis. "OPN 889F". Satu part boleh punya beberapa kode; model inilah yang membedakannya.',
      },
      { name: 'customerId', label: 'Customer', kind: 'reference', refEntity: 'customers', inList: true },
      { name: 'isAssy', label: 'Part Rakitan', kind: 'boolean', defaultValue: false },
      activeField,
    ],
  },

  /**
   * Pengaturan stok & SAP PER PROSES — satu baris per jenis proses per pabrik.
   *
   * Berlaku untuk semua part yang melewati proses itu. Kosong berarti memakai
   * SLOC milik lini saat scan. Ada di menu Integrasi, karena pengurusnya
   * PPIC/IT, bukan leader produksi.
   */
  'route-processes': {
    key: 'route-processes',
    label: 'Rute Proses',
    singular: 'Proses',
    icon: 'Route',
    description: 'SLOC masuk/keluar/transfer dan izin push SAP untuk tiap jenis proses',
    searchFields: [],
    defaultSort: 'processType',
    fields: [
      plantRef,
      {
        name: 'processType',
        label: 'Proses',
        kind: 'select',
        options: PROCESS_TYPES,
        required: true,
        inList: true,
      },
      {
        name: 'scanMode',
        label: 'Metode Scan',
        kind: 'select',
        options: SCAN_MODES,
        optionLabels: SCAN_MODE_LABELS,
        required: true,
        defaultValue: 'PART_SAJA',
        inList: true,
        hint:
          'Menentukan seluruh syarat scan di lini ini: wajib kanban atau tidak, ' +
          'unit ditempel ke kartu atau tidak, dan jumlah diambil dari kartu atau dari barcode.',
      },
      {
        name: 'inputLocationId',
        label: 'SLOC Masuk',
        kind: 'reference',
        refEntity: 'locations',
        inList: true,
        hint: 'Gudang tempat komponen diambil. Kosong = pakai SLOC asal lini.',
      },
      {
        name: 'outputLocationId',
        label: 'SLOC Keluar',
        kind: 'reference',
        refEntity: 'locations',
        inList: true,
        hint: 'Gudang tempat hasil disimpan. Kosong = pakai SLOC tujuan lini.',
      },
      {
        name: 'transferLocationId',
        label: 'SLOC Transfer',
        kind: 'reference',
        refEntity: 'locations',
        inList: true,
        hint: 'Bila diisi, hasil scan langsung dipindah dari SLOC keluar ke sini (dua mutasi TRANSFER).',
      },
      {
        name: 'sapProductionEnabled',
        label: 'Push Produksi ke SAP',
        kind: 'boolean',
        defaultValue: false,
        inList: true,
        hint: 'Nonaktif: dokumen produksi tetap dibuat di outbox tetapi ditahan (HELD).',
      },
      {
        name: 'sapTransferEnabled',
        label: 'Push Transfer ke SAP',
        kind: 'boolean',
        defaultValue: false,
        inList: true,
        hint: 'Butuh SLOC Transfer terisi. Dokumen transfer menunggu dokumen produksinya lebih dulu.',
      },
      {
        name: 'sapTransferMovementType',
        label: 'Movement Type Transfer',
        kind: 'text',
        max: 3,
        hint: 'Tiga digit, mis. 311. Disahkan sebelum push transfer — belum dikonfirmasi tim SAP.',
      },
      activeField,
    ],
  },

  kanbans: {
    key: 'kanbans',
    label: 'Kanban',
    singular: 'Kartu Kanban',
    icon: 'Tag',
    description: 'Kartu kanban fisik — seri, part, dan isi per kemasan',
    searchFields: ['serialNumber'],
    defaultSort: 'partId',
    fields: [
      plantRef,
      { name: 'partId', label: 'Part', kind: 'reference', refEntity: 'parts', required: true, inList: true },
      {
        name: 'serialNumber',
        label: 'No. Seri',
        kind: 'text',
        required: true,
        max: 64,
        inList: true,
        hint: 'Tercetak di kartu. Boleh sama dengan part lain, asal beda di part yang sama.',
      },
      { name: 'kanbanNo', label: 'No. Kanban SAP', kind: 'number', inList: true },
      {
        name: 'owner',
        label: 'Pemilik Kartu',
        kind: 'select',
        options: KANBAN_OWNERS,
        required: true,
        defaultValue: 'INTERNAL',
        inList: true,
        hint: 'CUSTOMER untuk kartu milik customer yang direct kanban.',
      },
      {
        name: 'kanbanType',
        label: 'Jenis',
        kind: 'select',
        options: KANBAN_TYPES,
        required: true,
        defaultValue: 'REGULER',
        inList: true,
      },
      {
        name: 'qtyPerBox',
        label: 'Qty per Kemasan',
        kind: 'number',
        required: true,
        defaultValue: 1,
        inList: true,
      },
      {
        name: 'unitPerKanban',
        label: 'Unit per Kanban',
        kind: 'number',
        required: true,
        defaultValue: 1,
        hint: 'Berapa unit ditempel ke satu kartu. Assembling tertentu menempelkan dua.',
      },
      { name: 'side', label: 'Side', kind: 'text', max: 8, hint: 'LH / RH untuk part berpasangan.' },
      { name: 'boxType', label: 'Jenis Box', kind: 'text', max: 8 },
      { name: 'customerId', label: 'Customer', kind: 'reference', refEntity: 'customers' },
      activeField,
    ],
  },

  'part-processes': {
    key: 'part-processes',
    /*
     * JUNCTION: part ini lewat proses apa, urutan ke berapa. Tidak lebih.
     * SLOC dan bendera SAP-nya ada di 'route-processes', per proses.
     */
    label: 'Rute Proses per Part',
    singular: 'Langkah Rute Part',
    icon: 'Route',
    description: 'Proses yang dilalui tiap part, beserta urutannya',
    searchFields: [],
    defaultSort: 'partId',
    fields: [
      plantRef,
      {
        name: 'partId',
        label: 'Part',
        kind: 'reference',
        refEntity: 'parts',
        required: true,
        inList: true,
      },
      {
        name: 'processType',
        label: 'Proses',
        kind: 'select',
        options: PROCESS_TYPES,
        required: true,
        inList: true,
      },
      {
        name: 'seqNo',
        label: 'Urutan',
        kind: 'number',
        required: true,
        inList: true,
        hint: 'Beri jarak (10, 20, 30) supaya langkah baru bisa disisipkan tanpa menomori ulang.',
      },
      {
        name: 'lineId',
        label: 'Line',
        kind: 'reference',
        refEntity: 'lines',
        inList: true,
        hint: 'Boleh kosong bila prosesnya dikerjakan beberapa line yang setara.',
      },

      activeField,
    ],
  },

  bom: {
    key: 'bom',
    label: 'BOM',
    singular: 'Baris BOM',
    icon: 'Network',
    description: 'Komposisi part — apa membutuhkan apa',
    searchFields: ['note'],
    defaultSort: 'parentPartId',
    fields: [
      plantRef,
      {
        name: 'parentPartId',
        label: 'Part Induk',
        kind: 'reference',
        refEntity: 'parts',
        required: true,
        inList: true,
        hint: 'Part yang dibuat.',
      },
      {
        name: 'componentPartId',
        label: 'Komponen',
        kind: 'reference',
        refEntity: 'parts',
        required: true,
        inList: true,
        hint: 'Part yang dibutuhkan untuk membuat induk.',
      },
      {
        name: 'qtyPer',
        label: 'Qty per Induk',
        kind: 'decimal',
        min: 0,
        required: true,
        numeric: true,
        inList: true,
        hint: 'Boleh desimal — raw material sering dipakai dalam kilogram.',
      },
      { name: 'uom', label: 'Satuan', kind: 'text', max: 16, inList: true },
      {
        name: 'scrapPct',
        label: 'Susut (%)',
        kind: 'decimal',
        min: 0,
        numeric: true,
        hint: 'Persentase susut wajar, ikut diperhitungkan saat menghitung kebutuhan material.',
      },
      { name: 'sequence', label: 'Urutan', kind: 'number', min: 0, numeric: true },
      {
        name: 'effectiveFrom',
        label: 'Berlaku Dari',
        kind: 'date',
        required: true,
        inList: true,
        hint: 'BOM berversi: telusur produksi lama tetap memakai komposisi yang berlaku saat itu.',
      },
      {
        name: 'effectiveTo',
        label: 'Berlaku Sampai',
        kind: 'date',
        hint: 'Kosongkan bila masih berlaku.',
      },
      { name: 'note', label: 'Catatan', kind: 'text', max: 255 },
    ],
  },

  /**
   * JAM KERJA per pabrik — menentukan hari produksi dan rentang laporan.
   *
   * Jam mulai hari produksi dulu ditanam di kode (07:00), padahal UNIT dan BODY
   * berbeda dan keduanya berubah mengikuti kebutuhan produksi.
   */
  'work-times': {
    key: 'work-times',
    label: 'Jam Kerja',
    singular: 'Jam Kerja',
    icon: 'Clock',
    description: 'Shift dan jamnya per pabrik — dasar hari produksi dan laporan per jam',
    searchFields: ['code', 'name'],
    defaultSort: 'startTime',
    fields: [
      plantRef,
      {
        name: 'code',
        label: 'Kode Shift',
        kind: 'text',
        required: true,
        max: 16,
        inList: true,
        hint: 'Mis. 1, 2, 3.',
      },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 64, inList: true },
      { name: 'startTime', label: 'Mulai', kind: 'text', required: true, max: 8, inList: true, hint: 'Format 24 jam, mis. 07:00.' },
      {
        name: 'endTime',
        label: 'Selesai',
        kind: 'text',
        required: true,
        max: 8,
        inList: true,
        hint: 'Boleh lebih kecil dari jam mulai untuk shift malam, mis. 23:00 → 07:00.',
      },
      {
        name: 'startsProductionDay',
        label: 'Awal Hari Produksi',
        kind: 'boolean',
        defaultValue: false,
        inList: true,
        hint: 'Tandai TEPAT SATU shift per pabrik. Scan sebelum jam ini masuk hari sebelumnya.',
      },
      activeField,
    ],
  },

  /** Istirahat terjadwal di dalam sebuah shift — dipotong dari waktu kerja. */
  'work-breaks': {
    key: 'work-breaks',
    label: 'Jam Istirahat',
    singular: 'Jam Istirahat',
    icon: 'Coffee',
    description: 'Istirahat terjadwal; dipotong dari waktu kerja saat menghitung efisiensi',
    searchFields: ['name'],
    defaultSort: 'startTime',
    fields: [
      {
        name: 'workTimeId',
        label: 'Shift',
        kind: 'reference',
        refEntity: 'work-times',
        required: true,
        inList: true,
      },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 64, inList: true },
      { name: 'startTime', label: 'Mulai', kind: 'text', required: true, max: 8, inList: true },
      { name: 'endTime', label: 'Selesai', kind: 'text', required: true, max: 8, inList: true },
      activeField,
    ],
  },

  /**
   * ALASAN BERHENTI — menempel pada lini.
   *
   * Lini dikosongkan berarti berlaku untuk semua lini di pabrik itu.
   */
  'stop-reasons': {
    key: 'stop-reasons',
    label: 'Alasan Berhenti',
    singular: 'Alasan Berhenti',
    icon: 'OctagonPause',
    description: 'Pilihan yang muncul saat operator menekan tombol berhenti di layar scan',
    searchFields: ['code', 'name'],
    defaultSort: 'sortOrder',
    fields: [
      plantRef,
      {
        name: 'lineId',
        label: 'Line',
        kind: 'reference',
        refEntity: 'lines',
        inList: true,
        hint: 'Kosongkan bila alasan ini berlaku untuk semua lini di pabrik.',
      },
      { name: 'code', label: 'Kode', kind: 'text', required: true, max: 32, inList: true },
      { name: 'name', label: 'Nama', kind: 'text', required: true, max: 128, inList: true },
      {
        name: 'category',
        label: 'Kategori',
        kind: 'select',
        options: STOP_REASON_CATEGORIES,
        optionLabels: STOP_REASON_CATEGORY_LABELS,
        required: true,
        defaultValue: 'PROBLEM',
        inList: true,
      },
      {
        name: 'isPlanned',
        label: 'Direncanakan',
        kind: 'boolean',
        defaultValue: false,
        inList: true,
        hint: 'Setup dan QC biasanya direncanakan; kerusakan tidak. Memisahkan keduanya di laporan efisiensi.',
      },
      {
        name: 'sortOrder',
        label: 'Urutan',
        kind: 'number',
        min: 0,
        defaultValue: 0,
        numeric: true,
        hint: 'Yang paling sering dipakai ditaruh di atas supaya operator tidak mencari.',
      },
      activeField,
    ],
  },

};

export function isMasterEntity(value: string): value is MasterEntity {
  return (MASTER_ENTITIES as readonly string[]).includes(value);
}

export function getEntityDef(key: MasterEntity): EntityDef {
  return ENTITY_DEFS[key];
}

/**
 * Membangun schema Zod dari definisi kolom.
 *
 * Dipakai API untuk memvalidasi dan UI untuk memeriksa sebelum kirim, sehingga
 * aturannya tidak mungkin melenceng antara keduanya.
 *
 * Nilai dari formulir HTML selalu berupa string, jadi setiap tipe di sini
 * mentoleransi string lalu mengubahnya — termasuk string kosong yang
 * diperlakukan sebagai "tidak diisi", bukan sebagai nol.
 */
/** Mengubah nilai formulir menjadi angka; kosong tetap undefined agar required_error bekerja. */
function toNumberOrUndefined(v: unknown): number | null | undefined {
  // null diteruskan apa adanya: itu tanda "kosongkan kolom" dari kosongDariFormulir.
  if (v === null) return null;
  if (v === '' || v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? (v as never) : n;
}

/**
 * Arti string kosong dari formulir, dan kenapa berbeda antara buat dan ubah.
 *
 *   buat            "" = tidak diisi -> undefined -> kolom memakai bawaannya
 *   ubah, wajib     "" = tidak diisi -> undefined -> kolom TIDAK disentuh
 *   ubah, opsional  "" = DIKOSONGKAN -> null      -> kolom diset NULL
 *
 * Tanpa baris ketiga, field opsional yang pernah terisi TIDAK PERNAH bisa
 * dikosongkan lagi dari layar: formulir mengirim "", API menerjemahkannya
 * sebagai "tidak diubah", dan menjawab 200. Pernah terjadi pada SLOC transfer
 * rute proses — pengaturan uji tertinggal di produksi dan setiap scan casting
 * diam-diam memindahkan barang ke PP04, tanpa satu pun galat.
 *
 * Yang absen dari payload (undefined) tetap berarti "tidak disentuh" — itu
 * yang menjaga PATCH dari pemanggil API langsung tidak mengosongkan kolom
 * yang tidak ia sebut.
 */
function kosongDariFormulir(f: FieldDef, mode: 'create' | 'update') {
  const bolehDikosongkan = mode === 'update' && !f.required;
  return (v: unknown) => (v === '' ? (bolehDikosongkan ? null : undefined) : v);
}

function fieldSchema(f: FieldDef, mode: 'create' | 'update'): z.ZodTypeAny {
  const optional = mode === 'update' || !f.required;

  switch (f.kind) {
    case 'text': {
      // required_error perlu diisi terpisah: pesan pada .min() hanya muncul
      // kalau field-nya ADA tapi kosong, sedangkan field yang tidak dikirim
      // sama sekali memakai required_error.
      const s = z
        .string({ required_error: `${f.label} wajib diisi` })
        .trim()
        .max(f.max ?? 255, `${f.label} maksimal ${f.max ?? 255} karakter`);
      if (f.required && mode === 'create') {
        return s.min(1, `${f.label} wajib diisi`);
      }
      return z.preprocess(kosongDariFormulir(f, mode), s.nullable().optional());
    }

    case 'decimal': {
      // Desimal disimpan MySQL sebagai string agar presisinya utuh; angka
      // pecahan pada float bisa bergeser, dan untuk kebutuhan material
      // pergeseran sekecil apa pun terkumpul menjadi selisih stok.
      // .finite() dipakai, bukan .refine(): refine mengubah tipe menjadi
      // ZodEffects yang kehilangan .min(), sedangkan .finite() tetap ZodNumber.
      const base = z
        .number({
          required_error: `${f.label} wajib diisi`,
          invalid_type_error: `${f.label} harus berupa angka`,
        })
        .finite(`${f.label} harus berupa angka`);
      const withRange = f.min !== undefined ? base.min(f.min, `${f.label} minimal ${f.min}`) : base;
      const target = f.required && mode === 'create' ? withRange : withRange.nullable().optional();
      // Dikembalikan sebagai string: kolom DECIMAL di MySQL menerima string,
      // dan itu menghindari pembulatan float di tengah jalan.
      return z.preprocess(
        (v) => toNumberOrUndefined(kosongDariFormulir(f, mode)(v)),
        target.transform((v: number | null | undefined) =>
          v === undefined ? undefined : v === null ? null : String(v),
        ),
      );
    }

    case 'date': {
      const base = z
        .string({ required_error: `${f.label} wajib diisi` })
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label} harus berformat YYYY-MM-DD`);
      if (f.required && mode === 'create') return base;
      return z.preprocess(kosongDariFormulir(f, mode), base.nullable().optional());
    }

    case 'number': {
      // Konversi dilakukan di preprocess, BUKAN dengan z.coerce.number().
      // z.coerce mengubah undefined menjadi NaN, sehingga required_error tidak
      // pernah terpicu dan pengguna melihat "Expected number, received nan".
      const base = z
        .number({
          required_error: `${f.label} wajib diisi`,
          invalid_type_error: `${f.label} harus berupa angka`,
        })
        .int(`${f.label} harus bilangan bulat`);
      const withRange =
        f.min !== undefined ? base.min(f.min, `${f.label} minimal ${f.min}`) : base;
      const target = f.required && mode === 'create' ? withRange : withRange.nullable().optional();
      return z.preprocess((v) => toNumberOrUndefined(kosongDariFormulir(f, mode)(v)), target);
    }

    case 'boolean': {
      /*
       * Nilai yang TIDAK dikirim sama sekali memakai defaultValue, bukan false.
       *
       * Checkbox HTML memang tidak mengirim apa pun saat tidak dicentang, tapi
       * server action di web selalu mengirim boolean eksplisit, jadi formulir
       * tidak pernah bergantung pada ketiadaan nilai. Yang benar-benar mengirim
       * payload tanpa field adalah pemanggilan API langsung — dan di situ yang
       * dimaksud adalah "pakai bawaannya".
       *
       * Sebelum diperbaiki, membuat part lewat API tanpa menyebut isActive
       * menghasilkan baris non-aktif yang tidak muncul di dropdown mana pun.
       * Impor master data akan menghasilkan ratusan baris tak terlihat tanpa
       * ada yang menyadarinya.
       */
      const fallback = f.defaultValue === undefined ? false : Boolean(f.defaultValue);
      return z.preprocess(
        (v) =>
          v === undefined || v === null
            ? fallback
            : v === '' ? false : v === 'on' || v === 'true' || v === true,
        z.boolean(),
      );
    }

    case 'select': {
      const s = z.enum((f.options ?? ['']) as [string, ...string[]], {
        errorMap: (issue) => ({
          message:
            issue.code === 'invalid_type'
              ? `${f.label} wajib dipilih`
              : `${f.label} tidak valid`,
        }),
      });
      if (f.required && mode === 'create') return s;
      return z.preprocess(kosongDariFormulir(f, mode), s.nullable().optional());
    }

    case 'reference': {
      const base = z
        .number({
          required_error: `${f.label} wajib dipilih`,
          invalid_type_error: `${f.label} wajib dipilih`,
        })
        .int()
        .positive(`${f.label} wajib dipilih`);
      const target = f.required && mode === 'create' ? base : base.nullable().optional();
      // Kosong lebih dulu diartikan (null/undefined), baru sisanya diubah ke angka.
      return z.preprocess((v) => toNumberOrUndefined(kosongDariFormulir(f, mode)(v)), target);
    }
  }

  return optional ? z.unknown().optional() : z.unknown();
}

export function buildCreateSchema(key: MasterEntity) {
  const def = getEntityDef(key);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) shape[f.name] = fieldSchema(f, 'create');
  return z.object(shape);
}

export function buildUpdateSchema(key: MasterEntity) {
  const def = getEntityDef(key);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) shape[f.name] = fieldSchema(f, 'update');
  return z.object(shape);
}

export type MasterRow = Record<string, unknown> & { id: number };
