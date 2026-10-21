import { PROCESS_LABELS, type LocationKind, type ProcessType } from '@avicenna/contracts';

/**
 * ─── APA YANG BOLEH SAMPAI KE SAP ───────────────────────────────────────────
 *
 * Seluruhnya diturunkan dari Blueprint SAP PP AIIA v1.0 (NTT Data, 7 September
 * 2026). Modul PP di sana hanya punya ENAM proses, dan yang menuntut kita
 * menulis ke staging cuma tiga:
 *
 *   PP-PE-01  Component Stock Transfer      WH -> WP, dipicu scan kanban
 *   PP-PE-02  Semifinished Goods Production  confirmation; SAP yang GR ke WP
 *   PP-PE-03  Finished Goods Production      confirmation; SAP yang GR ke FG
 *
 * Dua sisanya (PP-PE-04/05) justru arah MASUK — error COGI milik SAP yang
 * ditampilkan di layar kita — dan PP-PE-06 adalah koreksi.
 *
 * Konsekuensinya keras: SELAIN ketiga itu, tidak ada perpindahan di sistem ini
 * yang punya padanan dokumen SAP pada modul PP. Mengirimkannya berarti satu
 * dari dua hal, dan keduanya tidak memunculkan galat:
 *
 *   - ditolak SAP karena SLOC-nya tidak ada di sana (mis. ST80), lalu menumpuk
 *     sebagai REJECTED yang tidak ada yang bisa memperbaiki; atau
 *   - DITERIMA, dan stok berpindah dua kali.
 *
 * Berkas ini yang memutuskan. Pemanggilnya hanya menerima keputusannya.
 */

/**
 * Keluaran sebuah langkah proses MENURUT SAP.
 *
 *   'SFG'  barang setengah jadi — confirmation PP-PE-02, GR ke SLOC WIP
 *   'FG'   barang jadi          — confirmation PP-PE-03, GR ke SLOC FINISH_GOOD
 *   null   tidak ada padanannya di SAP; tidak pernah dikirim
 */
export type KelasHasilSap = 'SFG' | 'FG' | null;

/**
 * Jenis proses -> kelas hasil SAP.
 *
 * Dasarnya Tabel 16 "Person Responsible" blueprint, yang menyebut bagian
 * produksi tiap pabrik secara lengkap:
 *
 *   700 Body      INJ Injection · PTG Painting · ASY Assembly
 *   800 Unit      DCT Die Casting · MAC Machining · ASY Assembly
 *   900 Electric  MNT Mounting · INS Inspection · VAC Vacuum · ANT Antena
 *
 * ASY Assembly tercatat juga untuk plant 900 di tabel itu, tetapi di lapangan
 * dikerjakan di lini yang sama dengan Inspection — karena itu tidak ada jenis
 * proses tersendiri untuknya. Inspection dan Vacuum sendiri masing-masing punya
 * lini WIP dan lini FG. Lihat catatan di processTypeSchema.
 *
 * ── MELTING tidak ada di daftar itu ─────────────────────────────────────────
 *
 * Dan memang tidak bisa ada: keluarannya logam cair, yang tidak punya nomor
 * material maupun Production Version di SAP. Jadi hasil melting dicatat di
 * sini saja — bukan karena izinnya belum dinyalakan, tetapi karena tidak ada
 * dokumen SAP yang bisa dibuat untuknya.
 *
 * ── Kenapa WIP/FG kita lebih halus daripada SAP ─────────────────────────────
 *
 * SAP hanya mengenal "Die Casting"; di lantai, casting WIP dan casting FG
 * adalah LINI YANG BERBEDA dengan gudang keluaran yang berbeda. Perbedaan itu
 * dipertahankan di sini dan diterjemahkan saat mendorong: lini WIP menjadi
 * PP-PE-02, lini FG menjadi PP-PE-03. SAP menerima keduanya sebagai
 * confirmation pada work center masing-masing.
 *
 * ── Electric punya dua macam keluaran sekaligus ─────────────────────────────
 *
 * Inspection dan Vacuum masing-masing punya lini WIP dan lini FG, persis
 * seperti Casting dan Machining: yang FG menutup rute dan hasilnya barang
 * jadi, yang WIP diteruskan ke langkah berikutnya.
 *
 * Antena tetap 'SFG' karena part yang selesai di sana lanjut dirakit di
 * Assembling Body — pabrik yang BERBEDA. Jadi yang menentukan kelas hasil di
 * pabrik ini bukan pabriknya, melainkan lini tempat barang terakhir dikerjakan.
 *
 * Dan itu pun masih bisa dikalahkan POSISI langkah di rute part — lihat
 * kelasHasilSap() di bawah. Hal yang sama berlaku untuk INJECTION: sebuah part
 * bisa berhenti di sana dan langsung dikirim ke customer.
 */
const KELAS_HASIL: Record<ProcessType, KelasHasilSap> = {
  MELTING: null,
  CASTING_WIP: 'SFG',
  CASTING_FG: 'FG',
  MACHINING_WIP: 'SFG',
  MACHINING_FG: 'FG',
  ASSEMBLING_UNIT: 'FG',
  INJECTION: 'SFG',
  PAINTING: 'SFG',
  ASSEMBLING_BODY: 'FG',
  MOUNTING: 'SFG',
  INSPECTION_WIP: 'SFG',
  INSPECTION_FG: 'FG',
  VACUUM_WIP: 'SFG',
  VACUUM_FG: 'FG',
  ANTENNA: 'SFG',
  // Delivery bukan produksi: itu modul SD, bukan PP.
  DELIVERY: null,
};

/**
 * Kelas hasil sebuah langkah produksi.
 *
 * `langkahTerakhir` mengalahkan tabel di atas, dan itu disengaja: yang
 * menentukan sebuah keluaran barang jadi atau bukan adalah apakah masih ada
 * proses sesudahnya DI RUTE PART ITU, bukan nama prosesnya. Pada proyek 660A,
 * GARNISH melewati Injection lalu langsung Assembling sedangkan HANDLE lewat
 * Painting dulu — dan sebuah part yang berhenti di Injection memang menjadi
 * barang jadi di situ.
 *
 * Dipanggil tanpa argumen kedua, jawabannya mengikuti tabel.
 */
export function kelasHasilSap(proses: ProcessType, langkahTerakhir?: boolean): KelasHasilSap {
  const bawaan = KELAS_HASIL[proses];
  if (bawaan === null) return null;
  if (langkahTerakhir === undefined) return bawaan;
  return langkahTerakhir ? 'FG' : 'SFG';
}

/** Jenis SLOC yang WAJIB menerima hasil langkah ini di SAP. */
export function slocHasilWajib(kelas: KelasHasilSap): LocationKind | null {
  if (kelas === 'SFG') return 'WIP';
  if (kelas === 'FG') return 'FINISH_GOOD';
  return null;
}

/** Keputusan atas sebuah calon dokumen SAP. */
export interface KeputusanSap {
  /** Boleh didorong ke staging. */
  kirim: boolean;
  /**
   * Hanya bila `kirim` false.
   *
   *   true   memang tidak perlu dikirim — dicatat SKIPPED, bukan kegagalan
   *   false  perlu keputusan orang dulu — DITAHAN sampai sebabnya hilang
   */
  sengaja?: boolean;
  /** Dibaca manusia di layar pemantauan. Selalu ada bila `kirim` false. */
  alasan?: string;
}

const BOLEH: KeputusanSap = { kirim: true };

/**
 * Apakah hasil produksi langkah ini boleh didorong, dan apakah SLOC-nya cocok.
 *
 * ── Kenapa SLOC-nya diperiksa padahal tidak dikirim ─────────────────────────
 *
 * TT_PRODUCTION_RESULT di staging TIDAK punya kolom storage location sama
 * sekali — 24 kolom, tak satu pun SLOC. Sebabnya ada di blueprint: field MRP 2
 * nomor 11, *Production Storage Location*, "menentukan default Storage Location
 * untuk proses penerimaan barang dari hasil produksi". Jadi SAP mengambil SLOC
 * tujuan dari MATERIAL MASTER, dan apa pun yang kita kirim tidak bisa
 * mengubahnya.
 *
 * Artinya SLOC keluaran di rute kita bukan perintah, melainkan JANJI: kalau ia
 * berbeda dari isi material master, stok yang sama akan tercatat di dua tempat
 * yang berbeda — FG80 di sini, WP80 di SAP — dan selisihnya tidak akan pernah
 * memunculkan galat. Yang bisa kita periksa tanpa membaca SAP adalah
 * kewajarannya: hasil SFG mustahil benar bila mendarat di SLOC barang jadi.
 *
 * Dokumennya DITAHAN, bukan dikirim: begitu SLOC rutenya dibetulkan, ia jalan
 * sendiri pada putaran berikutnya.
 */
export function periksaHasilProduksi(opsi: {
  proses: ProcessType;
  /** Jenis SLOC tujuan hasil produksi. Kosong berarti mutasinya tanpa lokasi. */
  slocKind: LocationKind | null;
  /** Kode SLOC-nya, untuk pesan yang bisa ditindaklanjuti. */
  slocCode?: string | null;
  /** Apakah langkah ini yang terakhir di rute part. */
  langkahTerakhir?: boolean;
}): KeputusanSap {
  const kelas = kelasHasilSap(opsi.proses, opsi.langkahTerakhir);
  const nama = PROCESS_LABELS[opsi.proses] ?? opsi.proses;

  if (kelas === null) {
    return {
      kirim: false,
      sengaja: true,
      alasan:
        opsi.proses === 'MELTING'
          ? 'Melting tidak punya nomor material di SAP (keluarannya logam cair) — ' +
            'hasilnya dicatat di Avicenna saja'
          : `${nama} bukan langkah produksi pada modul PP SAP`,
    };
  }

  const wajib = slocHasilWajib(kelas);
  if (opsi.slocKind === null) {
    return { kirim: false, alasan: `${nama}: SLOC hasil produksi kosong` };
  }
  if (opsi.slocKind !== wajib) {
    const sloc = opsi.slocCode ? `${opsi.slocCode} (${opsi.slocKind})` : String(opsi.slocKind);
    const seharusnya = kelas === 'SFG' ? 'SLOC WIP (WP*)' : 'SLOC barang jadi (FG*)';
    return {
      kirim: false,
      alasan:
        `${nama} menghasilkan ${kelas} menurut blueprint, jadi hasilnya mestinya masuk ` +
        `${seharusnya}, bukan ${sloc}. SAP mengambil SLOC-nya dari material master ` +
        `(MRP 2 Production Storage Location), jadi selisih ini membuat stok tercatat ` +
        `di dua tempat yang berbeda tanpa galat apa pun. Perbaiki SLOC keluarnya.`,
    };
  }

  return BOLEH;
}

/**
 * Apakah sebuah perpindahan antar SLOC punya padanan dokumen di SAP.
 *
 * Satu-satunya yang punya adalah **WAREHOUSE -> WIP**: PP-PE-01 Component Stock
 * Transfer, "memindahkan material komponen dari Storage Location RAW ke Storage
 * Location WIP", dipicu scan kanban. Sisanya tidak, masing-masing karena
 * sebabnya sendiri:
 *
 *   -> FINISH_GOOD   barang jadi masuk SLOC FG lewat GOODS RECEIPT dari
 *                    confirmation, bukan lewat transfer tersendiri. Mengirim
 *                    311 di atasnya berarti barang yang sama masuk dua kali.
 *   -> NG            posting ke SLOC reject dilakukan SAP sendiri dari qty NG
 *                    pada baris hasil produksi (PP-PE-02/03 langkah 6).
 *   WIP -> WIP       seluruh serah-terima antar langkah internal terjadi DI
 *                    DALAM satu SLOC WIP di SAP. Tidak ada movement untuknya.
 *   STAGING          ST70/ST80/ST90 tidak ada di SAP sama sekali. Menurut
 *                    blueprint barang keluar langsung dari SLOC FG.
 *   CHUTE, TRANSIT   sama: hanya ada di sini.
 *
 * Yang tidak masuk salah satu pola di atas DITAHAN, bukan dikirim dengan
 * tebakan — mis. FINISH_GOOD -> WAREHOUSE, yang mungkin sah di SAP tetapi tidak
 * disebut blueprint PP.
 */
export function periksaTransferSloc(opsi: {
  dariKind: LocationKind | null;
  keKind: LocationKind | null;
  dariCode?: string | null;
  keCode?: string | null;
  /** Pabrik pemilik SLOC asal dan tujuan. Beda pabrik = dokumen yang lain. */
  dariPlantId?: number | null;
  kePlantId?: number | null;
}): KeputusanSap {
  const { dariKind, keKind } = opsi;
  const dari = opsi.dariCode ?? dariKind ?? '(kosong)';
  const ke = opsi.keCode ?? keKind ?? '(kosong)';

  if (dariKind === null || keKind === null) {
    return { kirim: false, alasan: 'asal atau tujuan SLOC belum terisi' };
  }

  if (opsi.dariCode && opsi.keCode && opsi.dariCode === opsi.keCode) {
    return {
      kirim: false,
      sengaja: true,
      alasan: `asal dan tujuan SLOC sama (${dari}) — bukan perpindahan di SAP`,
    };
  }

  /*
   * ── Beda pabrik diperiksa SEBELUM pola SLOC-nya ───────────────────────────
   *
   * Ada part yang setelah selesai di Antena (plant 900) lanjut dirakit di
   * Assembling Body (plant 700). Barangnya benar-benar berpindah pabrik, dan
   * di SAP itu BUKAN transfer antar storage location: plant adalah unit
   * organisasi tersendiri, perpindahannya dokumen lain lagi — stock transport
   * order, atau movement 301/303/305 tergantung caranya.
   *
   * Tanpa pemeriksaan ini, WP90 -> WP70 jatuh ke aturan "WIP -> WIP" di bawah
   * dan DILEWATI sebagai serah-terima internal. Padahal yang terjadi
   * sebaliknya: itu satu-satunya perpindahan di rute yang justru HARUS sampai
   * ke SAP, dan melewatkannya membuat stok plant 900 tidak pernah berkurang
   * sementara plant 700 tidak pernah bertambah.
   *
   * Blueprint PP tidak menyebut perpindahan antar plant sama sekali, jadi
   * dokumennya DITAHAN — bukan dilewati, dan bukan pula dikirim dengan
   * movement yang ditebak.
   */
  if (opsi.dariPlantId != null && opsi.kePlantId != null && opsi.dariPlantId !== opsi.kePlantId) {
    return {
      kirim: false,
      alasan:
        `${dari} dan ${ke} milik pabrik yang berbeda — perpindahan antar plant ` +
        'bukan transfer antar SLOC di SAP (butuh stock transport order atau ' +
        'movement 301/303/305). Tidak disebut blueprint PP; perlu dikonfirmasi tim SAP',
    };
  }

  if (dariKind === 'WAREHOUSE' && keKind === 'WIP') return BOLEH;

  const milikKita: LocationKind[] = ['STAGING', 'CHUTE', 'TRANSIT'];
  const kitaDari = milikKita.includes(dariKind);
  const kitaKe = milikKita.includes(keKind);
  if (kitaDari || kitaKe) {
    return {
      kirim: false,
      sengaja: true,
      alasan:
        `SLOC ${kitaDari ? dari : ke} hanya ada di Avicenna, tidak di SAP — ` +
        'menurut blueprint barang keluar langsung dari SLOC FG',
    };
  }

  if (keKind === 'FINISH_GOOD') {
    return {
      kirim: false,
      sengaja: true,
      alasan:
        `hasil produksi masuk ${ke} lewat goods receipt dari confirmation ` +
        '(REM Profile Z001), bukan lewat transfer tersendiri',
    };
  }

  if (keKind === 'NG') {
    return {
      kirim: false,
      sengaja: true,
      alasan:
        `posting ke ${ke} dilakukan SAP dari qty NG pada baris hasil produksi ` +
        '(PP-PE-02/03 langkah 6)',
    };
  }

  if (dariKind === 'WIP' && keKind === 'WIP') {
    return {
      kirim: false,
      sengaja: true,
      alasan:
        `${dari} dan ${ke} sama-sama SLOC WIP — serah-terima antar langkah ` +
        'internal terjadi di dalam satu SLOC WIP di SAP',
    };
  }

  return {
    kirim: false,
    alasan:
      `perpindahan ${dari} -> ${ke} tidak disebut blueprint PP ` +
      '(yang ada hanya WH -> WP, PP-PE-01) — perlu dikonfirmasi tim SAP',
  };
}
