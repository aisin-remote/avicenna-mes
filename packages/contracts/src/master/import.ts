import { z } from 'zod';
import { ENTITY_DEFS, type FieldDef, type MasterEntity } from './registry';

/**
 * ─── UNGGAH EXCEL UNTUK SELURUH MASTER ──────────────────────────────────────
 *
 * Dituntun registry entitas, sama seperti CRUD-nya. Menambah entitas master
 * berarti template dan unggahnya ikut ada sendiri — tidak ada daftar kedua
 * yang bisa ketinggalan.
 *
 * ── Menambah, TIDAK PERNAH menimpa ──────────────────────────────────────────
 *
 * Baris yang kuncinya sudah ada di database DITOLAK, bukan diperbarui. Ini
 * keputusan yang disengaja: berkas Excel beredar lewat surel dan folder
 * bersama, dan yang paling sering terjadi adalah orang mengunggah ulang salinan
 * lama. Kalau unggahan menimpa, perubahan sebulan terakhir hilang dalam satu
 * klik tanpa ada yang menyadarinya. Menyunting data yang sudah ada dilakukan
 * lewat layarnya, satu per satu, dengan sadar.
 */

/**
 * Kolom yang dipakai mengenali baris master dari luar sistem.
 *
 * Template tidak boleh meminta orang mengetik id internal — angka itu tidak
 * ada di dokumen mana pun di pabrik. Yang dikenal orang adalah KODE: UNIT,
 * DC-01, 212110-34010.
 */
export interface KunciAlami {
  /** Kolom yang memuat kode itu. */
  kolom: string;
  /**
   * Kodenya hanya unik DI DALAM satu pabrik.
   *
   * Penting saat mencocokkan referensi: "DC-01" di pabrik UNIT dan di pabrik
   * BODY adalah dua lini berbeda. Tanpa penyaringan pabrik, unggahan bisa
   * menautkan part ke lini pabrik lain — dan hasilnya tidak terlihat sampai
   * laporan per pabrik dibandingkan.
   */
  perPabrik: boolean;
}

export const KUNCI_ALAMI: Record<MasterEntity, KunciAlami> = {
  plants: { kolom: 'code', perPabrik: false },
  customers: { kolom: 'code', perPabrik: false },
  suppliers: { kolom: 'code', perPabrik: false },
  lines: { kolom: 'code', perPabrik: true },
  locations: { kolom: 'code', perPabrik: true },
  machines: { kolom: 'code', perPabrik: true },
  toolings: { kolom: 'code', perPabrik: true },
  'ng-masters': { kolom: 'code', perPabrik: true },
  'program-numbers': { kolom: 'code', perPabrik: true },
  // Satu baris per proses per pabrik — prosesnya sendiri yang jadi kunci.
  'route-processes': { kolom: 'processType', perPabrik: true },
  parts: { kolom: 'partNumber', perPabrik: true },
  /*
   * Tiga entitas berikut tidak punya kode sendiri — identitasnya gabungan
   * beberapa kolom (part + proses, part + seri, induk + komponen). Kolom di
   * sini dipakai hanya sebagai label saat melaporkan baris yang bentrok.
   */
  kanbans: { kolom: 'serialNumber', perPabrik: true },
  'work-times': { kolom: 'code', perPabrik: true },
  // Istirahat tidak punya kode; identitasnya shift + jam mulai. Nama dipakai
  // sebagai label saat melaporkan baris yang bentrok.
  'work-breaks': { kolom: 'name', perPabrik: false },
  'stop-reasons': { kolom: 'code', perPabrik: true },
  'part-processes': { kolom: 'seqNo', perPabrik: true },
  bom: { kolom: 'qtyPer', perPabrik: true },
};

/** Judul kolom di berkas Excel — memakai label yang sama dengan formulir. */
export interface KolomImpor {
  /** Nama field di sistem. */
  name: string;
  /** Judul yang dilihat orang di baris pertama Excel. */
  header: string;
  kind: FieldDef['kind'];
  required: boolean;
  options?: readonly string[];
  /** Untuk kolom referensi: entitas tujuan dan kode apa yang harus diisi. */
  refEntity?: MasterEntity;
  hint?: string;
}

/**
 * Kolom template untuk sebuah entitas.
 *
 * Kolom referensi berubah judulnya menjadi "<Label> (kode)" supaya jelas yang
 * diminta kode, bukan angka id. Tanpa itu orang akan mengetik apa saja yang
 * ada di layar — nama pabrik, nomor urut — dan setiap barisnya ditolak dengan
 * alasan yang terdengar seperti kesalahan sistem.
 */
export function kolomImpor(entity: MasterEntity): KolomImpor[] {
  return ENTITY_DEFS[entity].fields.map((f) => ({
    name: f.name,
    header: f.kind === 'reference' ? `${f.label} (kode)` : f.label,
    kind: f.kind,
    required: Boolean(f.required),
    options: f.options,
    refEntity: f.refEntity,
    hint: f.hint,
  }));
}

/** Satu baris yang ditolak, beserta nomor barisnya SEPERTI DI EXCEL. */
export const barisDitolakSchema = z.object({
  /**
   * Nomor baris di berkas Excel, bukan indeks array.
   *
   * Baris 1 adalah judul, jadi data pertama ada di baris 2. Melaporkan indeks
   * array membuat orang membetulkan baris yang salah — dan mengunggah ulang
   * berkas yang sama persis.
   */
  baris: z.number(),
  kolom: z.string().nullable(),
  sebab: z.string(),
});
export type BarisDitolak = z.infer<typeof barisDitolakSchema>;

export const hasilImporSchema = z.object({
  /** true berarti tidak ada yang ditulis — ini baru pemeriksaan. */
  ujiSaja: z.boolean(),
  totalBaris: z.number(),
  /** Baris yang lolos dan (akan) masuk. */
  diterima: z.number(),
  /** Benar-benar tertulis ke database. Nol saat ujiSaja. */
  ditulis: z.number(),
  ditolak: z.array(barisDitolakSchema),
});
export type HasilImpor = z.infer<typeof hasilImporSchema>;

/**
 * Batas ukuran berkas.
 *
 * Master terbesar di AIIA berisi ratusan baris, bukan ratusan ribu. Batas ini
 * bukan soal memori melainkan soal maksud: berkas 20 MB yang diunggah ke layar
 * master hampir pasti berkas yang keliru, dan menolaknya lebih cepat daripada
 * membiarkan orang menunggu lalu gagal.
 */
export const MAKS_UKURAN_IMPOR = 5 * 1024 * 1024;
export const MAKS_BARIS_IMPOR = 5000;
