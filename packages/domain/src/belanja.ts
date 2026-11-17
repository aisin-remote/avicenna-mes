/**
 * ─── BELANJA: MENCOCOKKAN KARTU FG DENGAN KARTU WIP ─────────────────────────
 *
 * Langkah di antara dua proses. Orang membawa SATU kartu induk ke rak barang
 * setengah jadi, mengambil box-box yang dibutuhkan untuk mengisinya, lalu
 * men-scan kartu induk itu bersama kartu tiap box. Kalau isinya cocok dengan
 * BOM, pasangannya dicatat.
 *
 * ── Interlock-nya DUA ARAH ──────────────────────────────────────────────────
 *
 * ke hilir  scan produksi di proses yang mewajibkan belanja hanya menerima
 *           kartu yang sudah belanja — hasil produksi tidak bisa dinyatakan
 *           tanpa barangnya benar-benar diambil
 *
 * ke hulu   kartu box yang diambil DILEPAS di sini, dan hanya di sini. Selama
 *           belum dibelanjakan, kartunya masih menempel di box yang penuh dan
 *           tidak bisa dipakai lagi di lini pembuatnya — jadi lini itu tidak
 *           bisa membuat box baru sebelum box lamanya terambil
 *
 * Arah kedua bukan aturan tambahan: kartu PRODUCED memang sudah ditolak di
 * stasiun scan. Yang membuatnya berlaku adalah titik pelepasannya — di belanja,
 * bukan di scan produksi induknya. Di situlah kartunya benar-benar dicopot dari
 * box dan dibawa pulang ke posnya, sementara box-nya berjalan diantar kartu
 * induk.
 *
 * ── Beberapa kartu induk per belanja ───────────────────────────────────────
 *
 * Dulu satu belanja = satu kartu FG, karena Bella menyimpan SELURUH seri
 * painting pada setiap seri assembly sehingga tidak ada yang tahu box mana
 * masuk ke mana. Sejak 13 Nov 2026 (Handika) satu belanja boleh berisi
 * beberapa kartu induk; pembagiannya dicatat per pasangan oleh
 * `alokasiBelanja` (berurutan, dengan qty bagiannya), dan seluruh kartu dalam
 * satu belanja dibatalkan bersama — satu box turunan bisa terbagi ke dua induk.
 *
 * ── Hanya BOM tingkat satu ──────────────────────────────────────────────────
 *
 * Yang diperiksa pasangan LANGSUNG, bukan hasil `explodeBom`. Yang diambil
 * orang dari rak adalah box barang setengah jadi; raw material di bawahnya
 * sudah habis terpakai di proses sebelumnya dan tidak punya kartu untuk
 * discan. Mengurai sampai raw material akan menuntut operator men-scan
 * sesuatu yang tidak ada bendanya.
 *
 * ── PENGAMAN WARNA + JUMLAH BOX (Handika, 13 Nov 2026) ─────────────────────
 *
 * Belanja memastikan box turunan yang diambil sesuai dengan kartu induk yang
 * akan diproduksi — terutama WARNANYA. Di BODY, suffix nomor part adalah kode
 * warna: KPJ9 `423120-14170-AA7` hanya boleh diisi KN2N `423117-10870-AA7`.
 * Turunan yang sah adalah yang ada di BOM induk, jadi cocok-BOM berarti
 * cocok-warna.
 *
 * Satu belanja boleh berisi BEBERAPA kartu induk (satu part yang sama), lalu
 * kartu turunan dari SATU komponen saja — tidak dicampur. Jumlah kartu
 * turunannya mengikuti total isi induk: 5 kartu induk isi 8 = 40 unit, jadi
 * 5 kartu turunan isi 8, atau 3 kartu isi 16 (48, sisa 8 tetap tercatat).
 * Kurang ditolak; satu box yang tidak dibutuhkan juga ditolak.
 */

/** Satu kartu yang discan dalam sesi belanja. */
export interface KartuBelanja {
  kanbanId: number;
  partId: number;
  partNumber: string;
  serialNumber: string;
  /** Unit yang dibawa kartu ini — INT_QTY_PER_BOX kartunya. */
  qty: number;
}

/** Satu baris BOM yang ikut diperiksa saat belanja. */
export interface KomponenBelanja {
  partId: number;
  partNumber: string;
  /** Unit komponen per SATU unit induk. Desimal, karena BOM memang desimal. */
  qtyPer: number;
}

export interface RingkasanKomponen {
  partId: number;
  partNumber: string;
  /** Unit komponen untuk seluruh kartu induk: total isi induk × qtyPer. */
  dibutuhkan: number;
  /** Unit yang dibawa kartu turunan komponen ini. */
  dibawa: number;
  jumlahKartu: number;
  /**
   * Kartu turunan yang diperlukan dengan isi box yang sedang dipakai, mis.
   * butuh 40 dan isi 16 → 3. Kosong selama belum ada kartu, atau isinya campur.
   */
  kartuDibutuhkan: number | null;
  /** Komponen inilah yang dipilih kartu turunannya. */
  dipilih: boolean;
  /** Yang dibawa sudah memenuhi kebutuhan. */
  cukup: boolean;
}

export interface HasilBelanja {
  bolehDisimpan: boolean;
  /** Total unit seluruh kartu induk. */
  unitInduk: number;
  perKomponen: RingkasanKomponen[];
  /** Kartu turunan yang part-nya bukan komponen BOM induk. */
  bukanKomponen: KartuBelanja[];
  /** Pesan siap tampil. Kosong berarti tidak ada yang menghalangi. */
  galat: string[];
}

function bulat(n: number): number {
  // BOM desimal (0,8 kg) membuat perkalian menghasilkan 79,99999999999999.
  return Math.round(n * 10000) / 10000;
}

/**
 * Memeriksa satu sesi belanja.
 *
 * Tidak menyentuh database dan tidak peduli status kartu — status diperiksa
 * pemanggilnya, yang memang memegang barisnya dan bisa menguncinya.
 */
export function periksaBelanja(input: {
  kartuInduk: KartuBelanja[];
  komponen: KomponenBelanja[];
  kartuWip: KartuBelanja[];
}): HasilBelanja {
  const { kartuInduk, komponen, kartuWip } = input;
  const galat: string[] = [];
  const unitInduk = kartuInduk.reduce((n, k) => n + k.qty, 0);
  const induk = kartuInduk[0];

  if (!induk) galat.push('Scan kartu induk dulu.');
  if (new Set(kartuInduk.map((k) => k.partId)).size > 1) {
    galat.push('Kartu induk harus satu part yang sama dalam satu belanja.');
  }
  for (const k of kartuInduk) {
    if (k.qty <= 0) {
      galat.push(
        `Kartu induk ${k.serialNumber} tidak menyebutkan isi per box. Perbaiki master kanbannya dulu.`,
      );
    }
  }
  if (adaKembar(kartuInduk)) galat.push('Ada kartu induk yang discan dua kali.');

  /*
   * BOM kosong ditolak, TIDAK dianggap "tidak ada yang perlu diperiksa".
   * Tanpa BOM, belanja akan selalu lolos dan pengaman warnanya berubah jadi
   * sekadar tombol — persis kebalikan dari gunanya.
   */
  if (induk && komponen.length === 0) {
    galat.push(
      `BOM untuk ${induk.partNumber} belum diisi, jadi turunannya tidak bisa diperiksa. ` +
        'Isi dulu di Master Data › Part Pairing.',
    );
  }

  if (kartuWip.length === 0) galat.push('Scan kartu turunan.');
  if (adaKembar(kartuWip)) galat.push('Ada kartu turunan yang discan dua kali.');

  const idKomponen = new Set(komponen.map((k) => k.partId));
  const bukanKomponen = kartuWip.filter((k) => !idKomponen.has(k.partId));
  for (const k of bukanKomponen) {
    galat.push(
      `${k.partNumber} bukan turunan ${induk?.partNumber ?? 'induk'} menurut BOM — model atau warnanya berbeda.`,
    );
  }
  if (new Set(kartuWip.map((k) => k.partId)).size > 1) {
    galat.push('Kartu turunan harus satu part saja — jangan dicampur.');
  }

  const perKomponen: RingkasanKomponen[] = komponen.map((komp) => {
    const kartu = kartuWip.filter((k) => k.partId === komp.partId);
    const dibutuhkan = bulat(unitInduk * komp.qtyPer);
    const dibawa = kartu.reduce((n, k) => n + k.qty, 0);
    const isi = kartu[0]?.qty ?? 0;
    const seragam = kartu.length > 0 && isi > 0 && kartu.every((k) => k.qty === isi);
    return {
      partId: komp.partId,
      partNumber: komp.partNumber,
      dibutuhkan,
      dibawa,
      jumlahKartu: kartu.length,
      kartuDibutuhkan: seragam ? Math.ceil(dibutuhkan / isi) : null,
      dipilih: kartu.length > 0,
      cukup: kartu.length > 0 && dibawa >= dibutuhkan,
    };
  });

  const pilihan = perKomponen.filter((k) => k.dipilih);
  if (pilihan.length === 1 && bukanKomponen.length === 0) {
    const k = pilihan[0]!;
    const kartu = kartuWip.filter((w) => w.partId === k.partId);
    if (k.dibawa < k.dibutuhkan) {
      const sisa = k.kartuDibutuhkan !== null ? k.kartuDibutuhkan - k.jumlahKartu : null;
      galat.push(
        `${k.partNumber} kurang ${bulat(k.dibutuhkan - k.dibawa)} dari ${k.dibutuhkan}` +
          (sisa !== null ? ` — scan ${sisa} kartu lagi.` : '.'),
      );
    } else {
      // Box yang tidak dibutuhkan: tanpa kartu terkecil pun kebutuhan masih terpenuhi.
      const terkecil = Math.min(...kartu.map((w) => w.qty));
      if (k.dibawa - terkecil >= k.dibutuhkan) {
        galat.push(
          `${k.partNumber} kelebihan box — ${k.dibutuhkan} unit cukup dengan ` +
            `${k.jumlahKartu - 1} kartu. Lepas satu kartu.`,
        );
      }
    }
  }

  return {
    bolehDisimpan: galat.length === 0,
    unitInduk,
    perKomponen,
    bukanKomponen,
    galat,
  };
}

function adaKembar(kartu: KartuBelanja[]): boolean {
  return new Set(kartu.map((k) => k.kanbanId)).size !== kartu.length;
}

/** Bagian satu kartu turunan yang masuk ke satu kartu induk. */
export interface AlokasiBelanja {
  indukKanbanId: number;
  wipKanbanId: number;
  /** Unit komponen dari kartu turunan itu untuk induk ini. */
  qty: number;
}

/**
 * Membagi isi kartu turunan ke kartu induk, berurutan seperti diambil dari rak.
 *
 * Induk pertama diisi dari turunan pertama sampai penuh, lalu induk berikutnya,
 * dst. Satu turunan isi 16 untuk induk isi 8 terbagi ke dua induk; sisa turunan
 * terakhir tidak dialokasikan ke siapa pun. Hasilnya menjawab "box turunan
 * mana masuk ke box induk mana" untuk penelusuran.
 */
export function alokasiBelanja(
  kartuInduk: KartuBelanja[],
  kartuWip: KartuBelanja[],
  qtyPer: number,
): AlokasiBelanja[] {
  const hasil: AlokasiBelanja[] = [];
  const sisa = kartuWip.map((w) => ({ id: w.kanbanId, sisa: w.qty }));
  let i = 0;
  for (const induk of kartuInduk) {
    let perlu = bulat(induk.qty * qtyPer);
    while (perlu > 0 && i < sisa.length) {
      const w = sisa[i]!;
      const ambil = bulat(Math.min(perlu, w.sisa));
      if (ambil > 0) hasil.push({ indukKanbanId: induk.kanbanId, wipKanbanId: w.id, qty: ambil });
      perlu = bulat(perlu - ambil);
      w.sisa = bulat(w.sisa - ambil);
      if (w.sisa <= 0) i++;
    }
  }
  return hasil;
}

/** Sebab sebuah kartu tidak boleh masuk sesi belanja. */
export type TolakBelanja =
  | 'FG_TIDAK_TERDAFTAR'
  | 'FG_SUDAH_BELANJA'
  | 'FG_TERISI'
  | 'FG_TIDAK_AKTIF'
  | 'WIP_TIDAK_TERDAFTAR'
  | 'WIP_BELUM_TERISI'
  | 'WIP_SUDAH_TERIKAT'
  | 'BEDA_PABRIK'
  | 'BUKAN_KARTU';

export const PESAN_BELANJA: Record<TolakBelanja, string> = {
  FG_TIDAK_TERDAFTAR: 'Kartu FG ini tidak terdaftar.',
  FG_SUDAH_BELANJA: 'Kartu FG ini sudah belanja. Scan produksinya dulu, atau batalkan belanjanya.',
  FG_TERISI: 'Kartu FG ini sedang berisi barang, jadi belum bisa dipakai belanja.',
  FG_TIDAK_AKTIF: 'Kartu FG ini sudah ditarik dari peredaran.',
  WIP_TIDAK_TERDAFTAR: 'Kartu WIP ini tidak terdaftar.',
  WIP_BELUM_TERISI: 'Kartu WIP ini belum berisi barang — box-nya belum dinyatakan penuh di lini.',
  WIP_SUDAH_TERIKAT: 'Kartu ini sudah belanja tetapi belum discan produksi — box-nya belum penuh.',
  BEDA_PABRIK: 'Kartu ini milik pabrik lain.',
  BUKAN_KARTU: 'Barcode tidak dikenali sebagai kartu kanban.',
};

/**
 * Apakah kartu FG dalam keadaan yang boleh memulai belanja.
 *
 * AVAILABLE saja. Kartu SHOPPED sudah punya pasangan — menimpanya diam-diam
 * akan melepaskan box yang sudah diambil orang lain dari rak tanpa jejak.
 */
export function fgSiapBelanja(status: string): TolakBelanja | null {
  if (status === 'AVAILABLE') return null;
  if (status === 'SHOPPED') return 'FG_SUDAH_BELANJA';
  if (status === 'CANCELLED') return 'FG_TIDAK_AKTIF';
  return 'FG_TERISI';
}

/**
 * Apakah kartu box boleh dibelanjakan.
 *
 * PRODUCED saja: isinya harus sudah dinyatakan penuh di lini sebelumnya.
 * Kartu AVAILABLE berarti box-nya kosong — yang diambil orang dari rak bukan
 * barang, melainkan kartu.
 *
 * SHOPPED berarti kartu itu sudah berbelanja untuk DIRINYA sendiri (prosesnya
 * juga mewajibkan belanja) tetapi belum discan produksi. Box-nya belum penuh,
 * jadi belum ada yang bisa diambil darinya.
 */
export function wipSiapBelanja(status: string): TolakBelanja | null {
  if (status === 'PRODUCED') return null;
  if (status === 'SHOPPED') return 'WIP_SUDAH_TERIKAT';
  if (status === 'CANCELLED') return 'FG_TIDAK_AKTIF';
  return 'WIP_BELUM_TERISI';
}
