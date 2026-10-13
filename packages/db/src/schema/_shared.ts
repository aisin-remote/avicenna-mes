import { bigint, varchar, timestamp, pgSchema, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

/**
 * ─── SKEMA PER MODUL ────────────────────────────────────────────────────────
 *
 * Postgres punya tingkat yang tidak dimiliki MySQL: server → database → SKEMA →
 * tabel. Satu database `avicenna`, satu skema per modul, sehingga membuka
 * database di DBeaver langsung memperlihatkan pembagian yang sama dengan
 * pembagian berkas di folder ini.
 *
 * Nama skemanya SENGAJA sama dengan nama berkas di direktori ini. Begitu
 * keduanya berbeda, orang harus menghafal pemetaannya — dan itu persis jenis
 * pengetahuan yang hilang saat orangnya pindah tim.
 *
 * Nama tabel tetap TM_/TT_ huruf besar seperti sebelumnya: itu konvensi yang
 * dipakai bersama database staging SAP, dan menggantinya hanya karena Postgres
 * lebih suka huruf kecil berarti memutus padanan yang sudah ada. Konsekuensinya
 * setiap identifier dikutip — Drizzle melakukannya sendiri, TAPI SQL mentah
 * harus menuliskan kutipnya: `SELECT ... FROM master."TM_PARTS"`, bukan
 * `FROM master.TM_PARTS` yang akan dicari sebagai `tm_parts` lalu gagal.
 */
export const orgSchema = pgSchema('org');
export const masterSchema = pgSchema('master');
export const productionSchema = pgSchema('production');
export const kanbanSchema = pgSchema('kanban');
export const inventorySchema = pgSchema('inventory');
export const logisticsSchema = pgSchema('logistics');
export const qualitySchema = pgSchema('quality');
export const machineSchema = pgSchema('machine');
export const sapSchema = pgSchema('sap');

/**
 * PK standar: BIGINT IDENTITY.
 *
 * `generatedByDefaultAsIdentity`, bukan `generatedAlwaysAsIdentity`: yang kedua
 * MENOLAK insert yang menyebutkan id-nya sendiri, dan itu dibutuhkan dua kali —
 * saat memindahkan data lama dari MySQL (id harus dipertahankan supaya seluruh
 * foreign key ikut benar) dan saat seed menyiapkan baris dengan id tetap.
 * Perilakunya sama dengan AUTO_INCREMENT yang kita tinggalkan.
 *
 * Tidak ada UNSIGNED di Postgres; bigint bertanda jangkauannya tetap jauh lebih
 * dari cukup (9,2 triliun) untuk tabel yang tumbuh belasan juta baris setahun.
 */
export const pk = () =>
  bigint('INT_ID', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity();

/** FK standar ke pk() di atas. */
export const fk = (name: string) => bigint(name, { mode: 'number' });

/**
 * created_at / updated_at.
 *
 * Prefiks DTM_ mengikuti konvensi database staging (CHR_/INT_/FLT_), tetapi
 * dengan prefiks yang JUJUR soal tipe: staging menyimpan tanggal sebagai
 * CHR_ char(8) + char(6) terpisah, sedangkan kolom ini timestamp sungguhan.
 *
 * ── withTimezone, dan kenapa itu alasan utama pindah ────────────────────────
 *
 * `timestamptz` menyimpan satu momen, bukan "angka jam tanpa keterangan". Di
 * MySQL, kolom yang diisi Node (UTC) dan kolom ber-DEFAULT CURRENT_TIMESTAMP
 * (waktu lokal sesi) bisa berselisih tujuh jam PADA BARIS YANG SAMA, dan
 * selisih itu tidak memunculkan galat apa pun — hanya laporan shift yang salah.
 * Dengan timestamptz, keduanya momen yang sama apa pun zona sesinya.
 *
 * ── $onUpdate, bukan ON UPDATE CURRENT_TIMESTAMP ────────────────────────────
 *
 * Postgres tidak punya padanan klausa itu; yang setara adalah trigger. Di sini
 * dipakai $onUpdate milik Drizzle, yang mengisi nilainya saat UPDATE lewat ORM.
 * Konsekuensinya jujur disebut: UPDATE lewat SQL MENTAH tidak akan memajukan
 * DTM_UPDATED_AT. Kalau suatu saat ada jalur tulis di luar ORM yang bergantung
 * pada kolom ini, pasang trigger — jangan berharap pada klausa yang tidak ada.
 */
export const timestamps = {
  createdAt: timestamp('DTM_CREATED_AT', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('DTM_UPDATED_AT', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Kolom berdaftar-nilai — pengganti ENUM MySQL.
 *
 * ── Kenapa varchar + CHECK, bukan tipe enum Postgres ────────────────────────
 *
 * Enum Postgres adalah TIPE tersendiri. Menambah nilai mudah, tetapi mengganti
 * nama dan MENGHAPUS nilai tidak: tipe lama harus dibuat ulang beserta seluruh
 * kolom yang memakainya. Daftar nilai di aplikasi ini justru yang paling sering
 * berubah — metode scan sudah tujuh nilai dan masih bertambah, dan status
 * pengiriman pernah kehilangan satu nilai ('LOADED') yang tidak terpakai.
 *
 * Dengan varchar + CHECK, perubahan daftar adalah satu constraint yang diganti.
 * Penjagaan di sisi database tetap ada — nilai di luar daftar ditolak, bukan
 * diterima diam-diam — dan tipe TypeScript-nya tetap sempit lewat $type.
 */
export const enumCol = <T extends string>(name: string, _values: readonly T[], length = 32) =>
  varchar(name, { length }).$type<T>();

/**
 * CHECK untuk kolom enumCol. Dipanggil di konfigurasi tabel:
 *
 *   (t) => [daftarNilai('TM_PART_TYPE_CHK', t.partType, PART_TYPES)]
 *
 * Nama constraint ditulis eksplisit, bukan dibangkitkan: nama yang dibangkitkan
 * berubah saat kolomnya diganti nama, dan migrasi lalu menghapus-dan-membuat
 * ulang constraint yang sebenarnya tidak berubah.
 */
export const daftarNilai = (nama: string, kolom: AnyPgColumn, nilai: readonly string[]) =>
  /*
   * Nilainya ditulis sebagai LITERAL, bukan parameter terikat.
   *
   * `sql`${v}`` menghasilkan placeholder $1, $2, … — benar untuk kueri, tetapi
   * CHECK adalah bagian dari DEFINISI tabel dan tidak pernah dieksekusi dengan
   * parameter. Yang tersimpan di database akhirnya berbunyi `IN ($1, $2)`, dan
   * constraint itu menolak SEMUA nilai tanpa pernah mengeluh saat dibuat.
   */
  check(
    nama,
    sql`${kolom} IN (${sql.raw(nilai.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '))})` as SQL,
  );

/**
 * Jenis proses produksi.
 *
 * Diambil dari rute nyata part di AIIA, bukan dikarang. Dua alur yang berbeda
 * sepenuhnya berjalan di pabrik yang berbeda:
 *
 *   UNIT  MELTING -> CASTING -> MACHINING -> ASSEMBLING_UNIT -> DELIVERY
 *   BODY  INJECTION -> PAINTING -> ASSEMBLING_BODY -> DELIVERY
 *
 * Casting dan machining masing-masing punya lini WIP dan lini FG yang TERPISAH
 * secara fisik — lihat FINISH_GOOD_PROCESSES di bawah.
 *
 * ── Kenapa ASSEMBLING dipecah dua ───────────────────────────────────────────
 *
 * Di tabel rute AIIA, "Assembling" muncul sebagai DUA kolom terpisah: satu
 * setelah Machining di alur UNIT, satu setelah Painting di alur BODY. Keduanya
 * proses yang berlainan, dikerjakan di lini yang berbeda. Menyatukannya menjadi
 * satu nilai membuat hasil kedua pabrik tercampur di laporan, dan tidak ada cara
 * memisahkannya kembali setelah datanya terlanjur masuk.
 *
 * ── Urutan di daftar ini TIDAK menentukan rute ──────────────────────────────
 *
 * Rute melekat pada PART, bukan pada jenis prosesnya — lihat TM_PROCESS_PARTS.
 * Dua part di proyek yang sama pun bisa berbeda rute: pada proyek 660A, GARNISH
 * melewati Injection lalu langsung Assembling, sedangkan HANDLE melewati
 * Painting lebih dulu. Daftar ini hanya kosakata yang sah, bukan urutannya.
 */
/*
 * Diimpor dari @avicenna/contracts, TIDAK didefinisikan ulang di sini.
 *
 * Kolom enum di database dan pilihan di formulir harus selalu sama persis;
 * dua daftar terpisah pernah menyimpang dua kali.
 */
export {
  PROCESS_TYPES,
  FINISH_GOOD_PROCESSES,
  PROCESS_LABELS,
  menghasilkanFinishGood,
  type ProcessType,
} from '@avicenna/contracts';

/**
 * Jenis part menurut posisinya di rantai pasok.
 *
 * Diperlukan karena `parts` sebelumnya tidak membedakan raw material, komponen
 * beli, dan barang jadi — padahal aturannya berbeda: raw material tidak punya
 * BOM, barang jadi tidak dibeli, dan WIP tidak dikirim ke customer.
 */
export const PART_TYPES = ['RAW_MATERIAL', 'COMPONENT', 'WIP', 'FINISHED_GOOD'] as const;
export type PartType = (typeof PART_TYPES)[number];

/** Dibeli dari supplier, atau diproduksi sendiri. */
export const SOURCE_TYPES = ['PURCHASED', 'MANUFACTURED'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Cara part ditelusuri.
 *
 * KEPUTUSAN PALING MENENTUKAN di seluruh skema ini — lihat
 * docs/traceability-model.md.
 *
 *   SERIAL   satu barcode = satu barang. Part hasil casting dan barang jadi.
 *   LOT      sekelompok barang satu batch. Raw material dan komponen beli.
 *   QUANTITY hanya jumlah, tanpa identitas. Consumable.
 *
 * Raw material yang dilebur mustahil diberi nomor seri, sementara part hasil
 * casting justru sudah discan satu per satu. Memaksa satu cara untuk semuanya
 * akan mematahkan salah satunya.
 */
export const TRACKING_MODES = ['SERIAL', 'LOT', 'QUANTITY'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];
