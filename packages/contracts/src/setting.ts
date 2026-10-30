/**
 * Pengaturan sistem yang boleh diubah dari layar, tanpa menyentuh .env.
 *
 * ── Kenapa hanya SAKLAR, bukan seluruh .env ─────────────────────────────────
 *
 * Yang ada di sini hanya keputusan OPERASIONAL: boleh/tidak sistem ini
 * berbicara dengan sistem lain. Alamat host, nama database, user, password,
 * dan JWT_SECRET sengaja TIDAK pernah masuk daftar ini.
 *
 * Alasannya bukan kerapian. Menaruh kredensial di layar berarti siapa pun yang
 * bisa membuka halaman pengaturan — atau menemukan endpoint-nya — bisa
 * membacanya kembali, dan sebuah password yang pernah tampil di browser harus
 * dianggap sudah bocor. Kredensial tetap di .env, di server, dibaca saat
 * proses start. Layar pengaturan hanya boleh menyalakan dan mematikan.
 *
 * ── Kenapa ada `env` sebagai cadangan ───────────────────────────────────────
 *
 * Nilai yang berlaku dibaca dari tabel `org.TM_SETTING`. Bila barisnya belum
 * ada, yang dipakai adalah environment variable yang namanya tertulis di
 * `env` — jadi lingkungan yang sudah berjalan hari ini tidak berubah
 * perilakunya hanya karena tabelnya masih kosong.
 *
 * Begitu seseorang mengubahnya dari layar, barisnya dibuat dan SEJAK ITU
 * tabel yang menang. Itu disengaja: kalau .env tetap menang, orang akan
 * menggeser saklar di layar, melihat angka tidak berubah, dan menyimpulkan
 * aplikasinya rusak.
 */

export type JenisPengaturan = 'boolean';

export interface DefinisiPengaturan {
  /** Kunci tetap, dipakai sebagai kunci baris di TM_SETTING. */
  key: string;
  label: string;
  /** Apa yang berubah kalau ini dinyalakan — ditulis untuk operator, bukan programmer. */
  deskripsi: string;
  jenis: JenisPengaturan;
  /** Nama environment variable yang dipakai bila barisnya belum ada. */
  env: string;
  bawaan: boolean;
  grup: string;
  /**
   * Berlaku seketika, atau perlu API di-restart dulu.
   *
   * Dibedakan karena saklar yang dibaca saat proses start TIDAK akan berubah
   * apa pun sampai di-restart — dan saklar yang tampak menyala padahal belum
   * berlaku adalah cara paling cepat membuat orang tidak percaya pada layar
   * ini lagi.
   */
  berlaku: 'seketika' | 'perlu-restart';
  /**
   * Peringatan yang WAJIB dibaca sebelum dinyalakan. Kosong berarti aman.
   *
   * Hanya untuk akibat yang tidak bisa dibatalkan dengan mematikannya lagi.
   */
  peringatan?: string;
}

export const PENGATURAN: DefinisiPengaturan[] = [
  {
    key: 'STAGING_PUSH_ENABLED',
    label: 'Dorong transaksi ke staging SAP',
    deskripsi:
      'Hasil produksi, perpindahan barang, dan penerimaan ditulis ke database jembatan SAP. ' +
      'Kalau mati, dokumennya tetap dibuat dan menunggu di outbox — tidak ada yang hilang.',
    jenis: 'boolean',
    env: 'STAGING_PUSH_ENABLED',
    bawaan: false,
    grup: 'SAP',
    berlaku: 'seketika',
  },
  {
    key: 'STAGING_PULL_ENABLED',
    label: 'Tarik master dari staging SAP',
    deskripsi:
      'Part, customer, dan supplier diambil dari staging SAP secara berkala. ' +
      'Kolom yang ditarik berhenti bisa diketik di layar master.',
    jenis: 'boolean',
    env: 'STAGING_PULL_ENABLED',
    bawaan: false,
    grup: 'SAP',
    berlaku: 'seketika',
    peringatan:
      'Sejak dinyalakan, isi staging yang menang. Apa pun yang diketik orang di layar master ' +
      'pada kolom yang ditarik akan tertimpa pada putaran berikutnya, dan ketikan itu tidak ' +
      'bisa dikembalikan dengan mematikan saklar ini lagi.',
  },
  {
    /*
     * Dipisah dari STAGING_PULL_ENABLED dengan sengaja.
     *
     * Master jarang berubah — nomor part baru datang mingguan, bukan tiap
     * menit. Yang dibutuhkan orang hampir selalu "tarik sekarang karena ada
     * part baru", bukan tarikan berkala yang 96 kali sehari membaca tabel yang
     * sama tanpa ada yang berubah.
     *
     * Dan tarikan berkala punya biaya yang tidak kelihatan: setiap putaran
     * adalah jendela di mana seseorang sedang menyunting master lalu
     * ketikannya tertimpa di tengah pekerjaan. Mematikan ini membuat jendela
     * itu hanya terbuka saat ada yang menekan tombol — dan orang yang menekan
     * tombol tahu apa yang sedang ia lakukan.
     */
    key: 'STAGING_PULL_SCHEDULED',
    label: 'Tarik master otomatis tiap 15 menit',
    deskripsi:
      'Kalau mati, master hanya ditarik saat tombol "Tarik master sekarang" di layar Integrasi SAP ' +
      'ditekan. Tarik delivery tidak terpengaruh — rencana pengiriman berubah selama hari berjalan ' +
      'dan tetap ditarik tiap 5 menit.',
    jenis: 'boolean',
    env: 'STAGING_PULL_SCHEDULED',
    bawaan: false,
    grup: 'SAP',
    berlaku: 'seketika',
  },
  {
    key: 'SAP_SIMULATION_ENABLED',
    label: 'Simulasi balasan SAP',
    deskripsi:
      'Membuka tombol untuk memalsukan balasan SAP (berhasil/gagal) pada dokumen di outbox, ' +
      'supaya alur sesudahnya bisa diuji tanpa SAP. Hanya bisa dipakai saat dorong transaksi mati.',
    jenis: 'boolean',
    env: 'SAP_SIMULATION_ENABLED',
    bawaan: false,
    grup: 'SAP',
    berlaku: 'seketika',
    peringatan:
      'Hanya untuk lingkungan uji. Di produksi ini membuat dokumen berstatus "sudah diterima SAP" ' +
      'padahal SAP belum pernah melihatnya.',
  },
  {
    key: 'MQTT_ENABLED',
    label: 'Dengarkan event mesin lewat MQTT',
    deskripsi: 'Menyambung ke broker MQTT untuk menerima event mesin secara langsung.',
    jenis: 'boolean',
    env: 'MQTT_ENABLED',
    bawaan: false,
    grup: 'Mesin',
    berlaku: 'perlu-restart',
  },
];

/*
 * TIDAK ada di daftar ini, dan itu disengaja:
 *
 *   MSSQL_SYNC_ENABLED — menggerbangi J922SyncService, yang isinya masih
 *   `belum diimplementasikan`. Saklar yang tidak mengubah apa pun adalah cara
 *   tercepat membuat orang berhenti percaya pada layar ini. Tambahkan ke sini
 *   begitu sinkronisasinya benar-benar jalan.
 *
 *   STAGING_HOST, STAGING_USER, STAGING_PASSWORD, JWT_SECRET, dan kredensial
 *   lain — lihat catatan di kepala berkas.
 */

export function definisiPengaturan(key: string): DefinisiPengaturan | undefined {
  return PENGATURAN.find((p) => p.key === key);
}

/** Grup dalam urutan tampil, tanpa duplikat. */
export function grupPengaturan(): string[] {
  return [...new Set(PENGATURAN.map((p) => p.grup))];
}

/**
 * Teks environment variable ditafsirkan sebagai benar/salah.
 *
 * Sengaja TIDAK memakai aturan truthy JavaScript: di sana string "false"
 * bernilai true, dan saklar yang dimatikan di .env justru menyala. Aturannya
 * disamakan dengan `envBoolean` di API supaya satu nilai tidak pernah
 * ditafsirkan dua cara.
 */
export function tafsirSaklar(nilai: string | undefined | null, bawaan: boolean): boolean {
  if (nilai === undefined || nilai === null) return bawaan;
  const teks = nilai.trim().toLowerCase();
  if (teks === '') return bawaan;
  return ['true', '1', 'yes', 'y', 'on'].includes(teks);
}

/** Dari mana nilai yang sedang berlaku datang — ditampilkan di layar. */
export type SumberPengaturan = 'tabel' | 'env' | 'bawaan';

export interface NilaiPengaturan {
  key: string;
  nilai: boolean;
  sumber: SumberPengaturan;
  /** Siapa yang terakhir mengubahnya lewat layar. Kosong bila dari env/bawaan. */
  diubahOleh: string | null;
  diubahPada: string | null;
}
