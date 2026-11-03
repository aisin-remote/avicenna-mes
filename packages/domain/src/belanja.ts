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
 * ── Kenapa SATU kartu FG per belanja ────────────────────────────────────────
 *
 * Satu kartu FG adalah satu box yang harus diisi. Bella mengizinkan beberapa
 * seri assembly sekaligus, lalu menyimpan SELURUH seri painting pada setiap
 * barisnya — jadi tidak ada yang tahu box painting mana sebenarnya milik box
 * assembly mana. Di sini pasangannya harus tunggal, sebab interlock-nya
 * memeriksa per kartu: box yang sama tidak boleh dihitung untuk dua perintah.
 *
 * Membagi beberapa kartu WIP ke beberapa kartu FG secara otomatis sempat
 * dipertimbangkan, lalu ditolak: pembagiannya tidak punya dasar fisik — yang
 * tahu box mana masuk ke box mana hanya orang yang mengambilnya.
 *
 * ── Hanya BOM tingkat satu ──────────────────────────────────────────────────
 *
 * Yang diperiksa pasangan LANGSUNG, bukan hasil `explodeBom`. Yang diambil
 * orang dari rak adalah box barang setengah jadi; raw material di bawahnya
 * sudah habis terpakai di proses sebelumnya dan tidak punya kartu untuk
 * discan. Mengurai sampai raw material akan menuntut operator men-scan
 * sesuatu yang tidak ada bendanya.
 *
 * ── Kenapa jumlahnya harus PAS, bukan "cukup" ───────────────────────────────
 *
 * Kanban bergerak per box utuh. "Lebih" berarti ada box yang terikat pada
 * perintah ini tanpa pernah terpakai — dan box itu hilang dari rak bagi lini
 * lain yang membutuhkannya, tanpa satu pun catatan yang menjelaskan ke mana.
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
  /** Unit yang harus dibawa: isi kartu FG × qtyPer. */
  dibutuhkan: number;
  /** Unit yang benar-benar discan. */
  dibawa: number;
  jumlahKartu: number;
  /** dibawa − dibutuhkan. Negatif berarti kurang. */
  selisih: number;
  pas: boolean;
  /**
   * Terisi kalau kekurangannya TIDAK bisa digenapi dengan isi box yang sedang
   * dipakai — mis. butuh 100 sedangkan satu box isi 30. Tanpa ini operator
   * akan menambah dan mengurangi kartu berulang kali mencari angka yang
   * sebenarnya tidak ada.
   */
  tidakAkanPas?: { isiBox: number; kurangKartu: number; lebihKartu: number };
}

export interface HasilBelanja {
  bolehDisimpan: boolean;
  /** Unit FG yang akan dihasilkan kartu ini. */
  unitFg: number;
  perKomponen: RingkasanKomponen[];
  /** Kartu WIP yang part-nya bukan komponen BOM kartu FG ini. */
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
 * pemanggilnya, yang memang memegang barisnya dan bisa menguncinya. Yang di
 * sini murni soal JUMLAH: apakah yang dibawa sudah pas dengan yang dibutuhkan.
 */
export function periksaBelanja(input: {
  kartuFg: KartuBelanja;
  komponen: KomponenBelanja[];
  kartuWip: KartuBelanja[];
}): HasilBelanja {
  const { kartuFg, komponen, kartuWip } = input;
  const galat: string[] = [];

  const unitFg = kartuFg.qty;
  if (unitFg <= 0) {
    galat.push(
      `Kartu FG ${kartuFg.serialNumber} tidak menyebutkan isi per box. Perbaiki master kanbannya dulu.`,
    );
  }

  /*
   * BOM kosong ditolak, TIDAK dianggap "tidak ada yang perlu diperiksa".
   *
   * Tanpa BOM, belanja akan selalu lolos dan interlock-nya berubah jadi
   * sekadar tombol — persis kebalikan dari gunanya.
   */
  if (komponen.length === 0) {
    galat.push(
      `BOM untuk ${kartuFg.partNumber} belum diisi, jadi kebutuhannya tidak bisa dihitung. ` +
        'Isi dulu di Master Data › BOM.',
    );
  }

  if (kartuWip.length === 0) {
    galat.push('Belum ada kartu WIP yang discan.');
  }

  // Kartu yang sama discan dua kali: satu box tidak bisa mengisi dua jatah.
  const terlihat = new Set<number>();
  for (const k of kartuWip) {
    if (terlihat.has(k.kanbanId)) {
      galat.push(`Kartu ${k.partNumber} seri ${k.serialNumber} discan dua kali.`);
    }
    terlihat.add(k.kanbanId);
  }

  const idKomponen = new Set(komponen.map((k) => k.partId));
  const bukanKomponen = kartuWip.filter((k) => !idKomponen.has(k.partId));
  for (const k of bukanKomponen) {
    galat.push(`${k.partNumber} bukan komponen ${kartuFg.partNumber} menurut BOM.`);
  }

  const perKomponen: RingkasanKomponen[] = komponen.map((komp) => {
    const kartu = kartuWip.filter((k) => k.partId === komp.partId);
    const dibutuhkan = bulat(unitFg * komp.qtyPer);
    const dibawa = kartu.reduce((n, k) => n + k.qty, 0);
    const selisih = bulat(dibawa - dibutuhkan);

    const ringkas: RingkasanKomponen = {
      partId: komp.partId,
      partNumber: komp.partNumber,
      dibutuhkan,
      dibawa,
      jumlahKartu: kartu.length,
      selisih,
      pas: selisih === 0,
    };

    /*
     * Hanya bisa disimpulkan kalau SELURUH kartu yang discan untuk komponen ini
     * isinya sama. Kalau isinya campur, kombinasi yang pas mungkin saja ada dan
     * menyatakan "tidak akan pas" justru menyesatkan.
     */
    if (!ringkas.pas && kartu.length > 0) {
      const isi = kartu[0]!.qty;
      const seragam = kartu.every((k) => k.qty === isi);
      if (seragam && isi > 0 && dibutuhkan % isi !== 0) {
        ringkas.tidakAkanPas = {
          isiBox: isi,
          kurangKartu: Math.floor(dibutuhkan / isi),
          lebihKartu: Math.ceil(dibutuhkan / isi),
        };
      }
    }

    return ringkas;
  });

  for (const r of perKomponen) {
    if (r.pas) continue;
    if (r.jumlahKartu === 0) {
      galat.push(`${r.partNumber} belum discan — butuh ${r.dibutuhkan}.`);
    } else if (r.tidakAkanPas) {
      const { isiBox, kurangKartu, lebihKartu } = r.tidakAkanPas;
      galat.push(
        `${r.partNumber} butuh ${r.dibutuhkan} tetapi satu box isinya ${isiBox} — ` +
          `${kurangKartu} kartu kurang, ${lebihKartu} kartu lebih. Periksa isi per box di masternya.`,
      );
    } else if (r.selisih < 0) {
      galat.push(`${r.partNumber} kurang ${Math.abs(r.selisih)} dari ${r.dibutuhkan}.`);
    } else {
      galat.push(`${r.partNumber} lebih ${r.selisih} dari ${r.dibutuhkan}.`);
    }
  }

  return {
    bolehDisimpan: galat.length === 0,
    unitFg,
    perKomponen,
    bukanKomponen,
    galat,
  };
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
