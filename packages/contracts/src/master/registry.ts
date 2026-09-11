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
] as const;

export type MasterEntity = (typeof MASTER_ENTITIES)[number];

export const PROCESS_TYPES = ['CASTING', 'MACHINING', 'ASSEMBLING', 'INJECTION'] as const;
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

export type FieldKind = 'text' | 'number' | 'decimal' | 'date' | 'boolean' | 'select' | 'reference';

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  /** Wajib diisi saat membuat data baru. */
  required?: boolean;
  /** Pilihan untuk kind 'select'. */
  options?: readonly string[];
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
        name: 'processType',
        label: 'Proses',
        kind: 'select',
        options: PROCESS_TYPES,
        inList: true,
      },
      { name: 'category', label: 'Kategori', kind: 'text', max: 64, inList: true },
      { name: 'sortOrder', label: 'Urutan', kind: 'number', min: 0, defaultValue: 0, numeric: true },
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
function toNumberOrUndefined(v: unknown): number | undefined {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? (v as never) : n;
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
      return z.preprocess((v) => (v === '' ? undefined : v), s.optional());
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
      const target = f.required && mode === 'create' ? withRange : withRange.optional();
      // Dikembalikan sebagai string: kolom DECIMAL di MySQL menerima string,
      // dan itu menghindari pembulatan float di tengah jalan.
      return z.preprocess(toNumberOrUndefined, target.transform((v: number | undefined) =>
        v === undefined ? undefined : String(v),
      ));
    }

    case 'date': {
      const base = z
        .string({ required_error: `${f.label} wajib diisi` })
        .regex(/^\d{4}-\d{2}-\d{2}$/, `${f.label} harus berformat YYYY-MM-DD`);
      if (f.required && mode === 'create') return base;
      return z.preprocess((v) => (v === '' ? undefined : v), base.optional());
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
      const target = f.required && mode === 'create' ? withRange : withRange.optional();
      return z.preprocess(toNumberOrUndefined, target);
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
      return z.preprocess((v) => (v === '' ? undefined : v), s.optional());
    }

    case 'reference': {
      const base = z
        .number({
          required_error: `${f.label} wajib dipilih`,
          invalid_type_error: `${f.label} wajib dipilih`,
        })
        .int()
        .positive(`${f.label} wajib dipilih`);
      const target = f.required && mode === 'create' ? base : base.optional();
      return z.preprocess(toNumberOrUndefined, target);
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
