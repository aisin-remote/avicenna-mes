import { scanPerBox, type ProcessType, type ScanModeTersimpan } from '@avicenna/contracts';
import type { PartNumberFormat } from './customer-part';

/**
 * Pembacaan barcode dengan BEBERAPA aturan sekaligus.
 *
 * ── Kenapa bukan satu fungsi ────────────────────────────────────────────────
 *
 * Format barcode di lapangan berbeda-beda: tiap customer punya penomoran
 * sendiri, dan tiap proses mencetak label yang berbeda pula. Satu fungsi
 * dengan rentetan `if` akan tumbuh jadi tidak bisa ditest, dan yang lebih
 * buruk — menambah format baru berarti menyentuh kode yang sudah dipakai
 * proses lain.
 *
 * Di sini tiap format berdiri sebagai satu aturan: punya nama, tahu kapan
 * dirinya berlaku, dan bisa ditest sendiri. Menambah format = menambah satu
 * objek ke DAFTAR_ATURAN beserta test-nya, tanpa menyentuh yang lain.
 *
 * ── Kenapa aturan yang cocok ikut dicatat ───────────────────────────────────
 *
 * Hasil baca membawa nama aturannya. Saat sebuah barcode terbaca keliru —
 * part-nya salah, qty-nya aneh — pertanyaan pertama selalu "dibaca pakai
 * aturan mana". Tanpa dicatat, jawabannya hanya bisa ditebak dengan menjalankan
 * ulang barcode-nya, dan barcode yang bermasalah biasanya sudah tidak ada lagi.
 */

export interface ParsedBarcode {
  raw: string;
  partNumber?: string;
  backNumber?: string;
  serialNumber?: string;
  qty?: number;
  /**
   * Dua digit pertama pada barcode produksi.
   *
   * Barcode itu TIDAK memuat nomor part sama sekali — kode inilah yang
   * menerjemahkannya, lewat TM_PROGRAM_NUMBER. Penerjemahannya di lapisan
   * service karena butuh database; di sini cukup diambil.
   */
  programCode?: string;
}

/** Hasil baca beserta aturan yang dipakai membacanya. */
export interface HasilBacaBarcode extends ParsedBarcode {
  /** Nama aturan yang cocok. Disimpan ke meta scan untuk penelusuran. */
  aturan: string;
}

/**
 * Keadaan saat barcode dibaca, dipakai memilih aturan.
 *
 * `processType` diketahui dari line tempat scan terjadi. `customerFormat` hanya
 * diketahui pada scan pengiriman dan pulling, tempat customer-nya sudah pasti
 * dari dokumennya — pada scan produksi customer belum diketahui, justru
 * part-nya yang sedang dicari.
 */
export interface KonteksBarcode {
  processType?: ProcessType | null;
  customerFormat?: PartNumberFormat | null;
  /**
   * Cara scan proses ini. Menentukan apakah barcode polos dibaca sebagai
   * NOMOR PART (master sample di BODY) atau nomor SERI (barang di UNIT).
   */
  scanMode?: ScanModeTersimpan | null;
}

export interface AturanBarcode {
  /** Nama singkat, ikut tercatat di hasil baca. */
  nama: string;
  keterangan: string;
  /**
   * Apakah aturan ini berlaku pada keadaan sekarang.
   *
   * Kosong berarti berlaku di mana saja. Dipakai membatasi aturan yang hanya
   * benar untuk satu proses atau satu customer.
   */
  berlaku?(ctx: KonteksBarcode): boolean;
  /** Apakah bentuk barcode-nya cocok dengan aturan ini. */
  cocok(raw: string): boolean;
  /** Membaca isinya. Hanya dipanggil bila `cocok` bernilai true. */
  baca(raw: string): ParsedBarcode;
}

/** Barcode yang tidak cocok dengan satu aturan pun. */
export class BarcodeTidakDikenali extends Error {
  constructor(readonly raw: string) {
    super(`Format barcode tidak dikenali: "${raw}"`);
    this.name = 'BarcodeTidakDikenali';
  }
}

/**
 * Penanda kartu kanban cetakan sendiri, sekaligus VERSI formatnya.
 *
 * Dideklarasikan di sini — jauh di atas aturan kanban yang memakainya — karena
 * aturan barcode PART di bawah ini harus menyingkirkannya lebih dulu. Isi
 * lengkapnya ada di ATURAN_KANBAN_AVICENNA, di bagian KANBAN berkas ini.
 *
 * Angka 1 pada "AVK1" adalah versi, dan itu disengaja. Menambah ruas nanti
 * berarti menerbitkan AVK2 sambil membiarkan pembaca AVK1 tetap hidup: kartu
 * yang sudah tercetak dan beredar di rak tidak bisa ditarik serentak, dan
 * kartu lama yang tiba-tiba tidak terbaca menghentikan lini.
 */
export const PENANDA_KARTU_KANBAN = 'AVK1';

/**
 * Format berpemisah: PARTNUMBER|BACKNUMBER|SERIAL|QTY
 *
 * Ini format yang dipakai sejak awal sistem ini dan sudah punya test. Tetap
 * ditaruh paling depan karena bentuknya paling khas — adanya "|" membuatnya
 * tidak mungkin tertukar dengan format lain.
 *
 * Kecuali satu hal: kartu kanban cetakan sendiri memakai pemisah yang sama,
 * jadi penandanya disingkirkan di sini. Tanpa itu kartu `AVK1|…` terbaca
 * sebagai barcode part dengan nomor part "AVK1" — part yang tidak ada — dan
 * operator mendapat pesan "part tidak dikenali", padahal yang dipegangnya
 * kartu dan yang keliru adalah kotak scan-nya.
 */
export const ATURAN_BERPEMISAH: AturanBarcode = {
  nama: 'BERPEMISAH',
  keterangan: 'PARTNUMBER|BACKNUMBER|SERIAL|QTY',
  cocok: (raw) => raw.includes('|') && !raw.startsWith(`${PENANDA_KARTU_KANBAN}|`),
  baca(raw) {
    const [partNumber, backNumber, serialNumber, qtyRaw] = raw.split('|');
    const qty = qtyRaw ? Number.parseInt(qtyRaw, 10) : undefined;
    return {
      raw,
      partNumber: partNumber?.trim() || undefined,
      backNumber: backNumber?.trim() || undefined,
      serialNumber: serialNumber?.trim() || undefined,
      qty: qty !== undefined && Number.isFinite(qty) && qty > 0 ? qty : undefined,
    };
  },
};

/**
 * Nomor seri polos, tanpa identitas part.
 *
 * SENGAJA JADI ATURAN TERSENDIRI, bukan perilaku diam-diam saat aturan lain
 * gagal. Sebelumnya barcode yang tidak dikenali jatuh ke sini tanpa jejak,
 * sehingga scan produksi tercatat tanpa part — dan karena tanpa part, tidak ada
 * mutasi stok yang ditulis. Operator melihat "berhasil", stoknya tidak pernah
 * bergerak, dan tidak ada yang menyadarinya sampai stock opname.
 *
 * Sekarang hasilnya bernama. Scan produksi yang terbaca dengan aturan ini akan
 * DITOLAK di lapisan service, karena produksi wajib tahu part-nya. Scan
 * inspeksi dan stock opname yang memang bekerja per nomor seri tetap bisa.
 */
export const ATURAN_SERIAL_SAJA: AturanBarcode = {
  nama: 'SERIAL_SAJA',
  keterangan: 'nomor seri polos, tanpa identitas part',
  cocok: () => true,
  baca: (raw) => ({ raw, serialNumber: raw }),
};

/**
 * Daftar aturan, BERURUTAN — yang pertama cocok dipakai.
 *
 * Urutannya penting: yang paling khas di depan, yang paling longgar di
 * belakang. ATURAN_SERIAL_SAJA cocok dengan apa pun, jadi ia wajib jadi yang
 * terakhir; menaruhnya lebih awal membuat seluruh aturan sesudahnya mati.
 *
 * ── Menambah format baru ────────────────────────────────────────────────────
 *
 * Tambahkan satu objek DI ATAS ATURAN_SERIAL_SAJA, lengkapi `berlaku` bila
 * hanya untuk proses atau customer tertentu, lalu tulis test-nya di
 * barcode.test.ts. Tidak ada berkas lain yang perlu disentuh.
 */
/**
 * Barcode produksi 15 karakter berkode program.
 *
 * Bentuk yang benar-benar beredar di lantai: 2 digit program number, lalu 13
 * karakter yang membentuk identitas unitnya. Contoh nyata dari data lama:
 * `12051421B22A276`, `17041521B24A121`.
 *
 * ── Kenapa sisanya tidak diurai ─────────────────────────────────────────────
 *
 * Sistem lama hanya mengambil dua digit pertama dan menyimpan SELURUH barcode
 * sebagai identitas unit. Sisanya tidak pernah dibaca. Menguraikannya menjadi
 * tanggal dan nomor urut berarti menebak arti yang tidak pernah dipakai — dan
 * tebakan itu akan menolak barcode sah yang bentuknya sedikit berbeda.
 */
export const ATURAN_PROGRAM_15: AturanBarcode = {
  nama: 'PROGRAM_15',
  keterangan: '15 karakter; 2 digit pertama program number, seluruhnya nomor seri unit',
  cocok: (raw) => /^[0-9]{2}[0-9A-Za-z]{13}$/.test(raw),
  baca: (raw) => ({
    raw,
    programCode: raw.slice(0, 2),
    serialNumber: raw,
  }),
};

/**
 * Master sample — barcode polos berisi NOMOR PART, hanya di mode per-kanban.
 *
 * Di BODY (bella, prdreport) operator memulai shift dengan men-scan master
 * sample yang tertempel di lini; isinya nomor part apa adanya, tanpa seri,
 * tanpa pemisah. Barang di sana tidak berseri, jadi identitas yang dibawa
 * scan adalah "part apa", bukan "barang yang mana".
 *
 * ── Kenapa terikat pada scanMode ────────────────────────────────────────────
 *
 * Bentuknya tidak bisa dibedakan dari nomor seri polos di UNIT. Tanpa syarat
 * ini, nomor seri yang belum dikenali di UNIT akan ditafsirkan sebagai nomor
 * part, lalu ditolak "part tidak ada" — pesan yang menyesatkan. Aturan ini
 * hanya menyala ketika prosesnya memang per-kanban.
 */
export const ATURAN_NOMOR_PART: AturanBarcode = {
  nama: 'NOMOR_PART',
  keterangan: 'nomor part polos (master sample), hanya di proses per-kanban',
  berlaku: (ctx) => scanPerBox(ctx.scanMode),
  // Tanpa pemisah — yang berpemisah sudah ditangani ATURAN_BERPEMISAH di atas.
  cocok: (raw) => !raw.includes('|') && /^[A-Za-z0-9][A-Za-z0-9.\-_/]{2,63}$/.test(raw),
  baca: (raw) => ({ raw, partNumber: raw }),
};

/**
 * Apakah teks ini nomor part polos — bukan kanban, bukan barcode seri?
 *
 * Dipakai layar per-kanban: master sample yang discan di tengah shift berarti
 * operator berganti part, bukan men-scan kartu. Penyaringnya sama dengan
 * ATURAN_NOMOR_PART supaya keputusan layar dan server tidak berbeda.
 */
export function sepertiNomorPartPolos(raw: string): boolean {
  return ATURAN_NOMOR_PART.cocok(raw.trim());
}

export const DAFTAR_ATURAN: AturanBarcode[] = [
  ATURAN_BERPEMISAH,
  ATURAN_PROGRAM_15,
  ATURAN_NOMOR_PART,
  ATURAN_SERIAL_SAJA,
];

/**
 * Membaca barcode memakai aturan pertama yang cocok.
 *
 * Melempar BarcodeTidakDikenali bila tidak ada yang cocok. Selama
 * ATURAN_SERIAL_SAJA masih ada di daftar, itu tidak akan terjadi — tetapi
 * pemeriksaannya tetap ada supaya menghapus aturan itu nanti menghasilkan
 * penolakan yang jelas, bukan `undefined` yang menjalar diam-diam.
 */
export function bacaBarcode(raw: string, ctx: KonteksBarcode = {}): HasilBacaBarcode {
  const bersih = raw.trim();
  if (bersih.length === 0) throw new Error('Barcode kosong');

  for (const aturan of DAFTAR_ATURAN) {
    if (aturan.berlaku && !aturan.berlaku(ctx)) continue;
    if (!aturan.cocok(bersih)) continue;
    return { ...aturan.baca(bersih), aturan: aturan.nama };
  }

  throw new BarcodeTidakDikenali(bersih);
}

/** Apakah hasil baca cukup untuk menentukan part. Produksi mewajibkan ini. */
export function punyaIdentitasPart(hasil: ParsedBarcode): boolean {
  return Boolean(hasil.partNumber || hasil.backNumber);
}

/** Daftar aturan yang berlaku pada sebuah keadaan — untuk layar diagnostik. */
export function aturanBerlaku(ctx: KonteksBarcode = {}): AturanBarcode[] {
  return DAFTAR_ATURAN.filter((a) => !a.berlaku || a.berlaku(ctx));
}

/* ────────────────────────────────────────────────────────────────────────────
 * BARCODE KANBAN
 *
 * Dibaca terpisah dari barcode part: isinya berbeda (back number + nomor seri
 * kartu), dan formatnya pun berbeda-beda per customer.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ParsedKanban {
  raw: string;
  /** Back number part yang boleh ditempel kartu ini. */
  backNumber?: string;
  /** Nomor seri tercetak di kartu. */
  serialNumber?: string;
  /**
   * Nomor part internal yang tertulis di kartu — hanya pada kartu BODY.
   *
   * Dipakai mencocokkan kartu dengan master sample yang sedang aktif: kartu
   * part lain yang terscan di lini tidak boleh menambah hasil part yang
   * sedang dikerjakan.
   */
  partNumber?: string;
  /**
   * Isi kartu menurut kartunya sendiri (pcs).
   *
   * Yang DICATAT tetap angka terdaftar di master, bukan angka ini. Gunanya
   * mendeteksi kartu basi: scan.service membandingkan keduanya dan
   * memperingatkan bila berbeda — tetapi hanya untuk kartu cetakan sendiri,
   * karena kartu customer BODY menyimpan pcs pada satu digit saja.
   */
  qty?: number;
  /**
   * Label DN — hanya pada ATURAN_KANBAN_LABEL_DN.
   *
   * Label ini menunjuk ke loading list, bukan ke kartu terdaftar: nomor
   * dokumennya, urutan box di dalam dokumen itu, dan nomor part menurut
   * penomoran customer.
   */
  dnNumber?: string;
  dnSeq?: number;
  customerPartNumber?: string;
}

export interface HasilBacaKanban extends ParsedKanban {
  aturan: string;
}

export interface AturanKanban {
  nama: string;
  keterangan: string;
  berlaku?(ctx: KonteksBarcode): boolean;
  cocok(raw: string): boolean;
  baca(raw: string): ParsedKanban;
}

export class KanbanTidakTerbaca extends Error {
  constructor(readonly raw: string) {
    super(`Format barcode kanban tidak dikenali: "${raw}"`);
    this.name = 'KanbanTidakTerbaca';
  }
}

/**
 * Format berspasi milik sistem lama.
 *
 * Barcode dipecah menurut spasi, lalu back number dan seri diambil dari dua
 * kolom yang bersebelahan. Letak kolomnya TIDAK tetap: sistem lama memeriksa
 * `$arr[8] == '0'` lalu `$arr[9] == '0'` untuk menebak pergeserannya, karena
 * sebagian kartu punya kolom kosong berisi "0" di depan.
 *
 * Perilaku itu dipertahankan apa adanya. Memperbaikinya berarti sebagian kartu
 * yang selama ini terbaca menjadi tidak terbaca, dan itu menghentikan lini —
 * bukan sesuatu yang boleh diubah tanpa memeriksa kartu yang benar-benar
 * beredar.
 *
 * Seri adalah EMPAT KARAKTER TERAKHIR dari kolom sesudah back number.
 */
export const ATURAN_KANBAN_BERSPASI: AturanKanban = {
  nama: 'KANBAN_BERSPASI',
  keterangan: 'dipisah spasi; back number dan seri diambil dari kolom ke-8/9/10',
  cocok: (raw) => raw.trim().split(/ +/).length >= 10,
  baca(raw) {
    const a = raw.trim().split(/ +/);
    // Urutan pemeriksaan mengikuti sistem lama; jangan dibalik.
    const [iBack, iSeri] = a[8] === '0' ? [9, 10] : a[9] === '0' ? [10, 11] : [8, 9];
    const back = a[iBack]?.trim();
    const kolomSeri = a[iSeri]?.trim();
    return {
      raw,
      backNumber: back || undefined,
      serialNumber: kolomSeri ? kolomSeri.slice(-4) : undefined,
    };
  },
};

/**
 * Kartu kanban cetakan SENDIRI — `AVK1|PART|BACK|SERI|QTY`.
 *
 * Contoh: `AVK1|212110-34141|CI25|0001|60`
 *
 * ── Kenapa isinya tidak cukup back number dan seri ──────────────────────────
 *
 * Dua ruas sudah cukup untuk MENEMUKAN kartunya di master, dan itulah yang
 * dipakai kartu percobaan pertama. Tetapi "cukup untuk mencari" tidak sama
 * dengan "cukup untuk diperiksa": seluruh pemeriksaan jadi bergantung pada
 * baris master yang kebetulan ditemukan, dan kartu yang salah cetak atau salah
 * tempel tidak bisa dibantah oleh kartunya sendiri.
 *
 * Dengan nomor part ikut tercetak, kartu bisa dicocokkan dengan part yang
 * SEDANG dikerjakan di lini (lihat KANBAN_PART_MISMATCH di scan.service) —
 * persis seperti kartu customer BODY, yang sejak dulu menyebut nomor part-nya
 * sendiri. Kartu kita jadi setara dengan kartu mereka, bukan versi yang lebih
 * miskin yang harus ditangani jalur lain.
 *
 * ── Kenapa qty/box ikut, padahal angkanya bisa berubah ─────────────────────
 *
 * Qty/box tercetak di MUKA kartu juga. Kalau isi box diubah di master, kartu
 * yang beredar sudah berbohong kepada orang yang mengisi box — barcodenya
 * tidak menambah kebohongan baru, ia membuat kebohongan yang sudah ada bisa
 * TERDETEKSI: server membandingkannya dengan yang terdaftar dan memperingatkan
 * bahwa kartu itu perlu dicetak ulang.
 *
 * ── Yang SENGAJA tidak ikut ────────────────────────────────────────────────
 *
 *   nama part   teks bebas, panjangnya tidak terbatas, dan tidak ada satu pun
 *               keputusan sistem yang bergantung padanya — mata orang membacanya
 *               dari muka kartu
 *   nama lini   penugasan lini berubah tanpa kartunya dicetak ulang; begitu
 *               tercetak di barcode, ia jadi fakta basi yang bisa dipercaya
 *               pembacanya
 *   kode pabrik nomor part sudah menentukannya — pabrik di barcode hanya ruas
 *               kedua yang harus ikut dijaga agar tidak bertentangan
 *   id baris    id internal membuat kartu kertas terikat pada satu database.
 *               Restore yang menomori ulang membuat setiap kartu menunjuk part
 *               lain, dan salahnya TIDAK kelihatan — id-nya tetap ada
 *
 * Isinya ±30 karakter, jadi QR-nya masih versi rendah dan modulnya tetap besar
 * di kartu 36 mm.
 */
export const ATURAN_KANBAN_AVICENNA: AturanKanban = {
  nama: 'KANBAN_AVICENNA',
  keterangan: `${PENANDA_KARTU_KANBAN}|PART|BACK|SERI|QTY (kartu cetakan sendiri)`,
  /*
   * Dikenali dari PENANDANYA, bukan dari jumlah ruas.
   *
   * Jumlah ruas akan bertabrakan dengan barcode part empat ruas, dan menambah
   * ruas di masa depan akan mematikan aturan ini tanpa satu pun galat.
   */
  cocok: (raw) => raw.startsWith(`${PENANDA_KARTU_KANBAN}|`),
  baca(raw) {
    const [, partNumber, backNumber, serialNumber, qtyRaw] = raw.split('|');
    const qty = Number.parseInt(qtyRaw ?? '', 10);
    return {
      raw,
      partNumber: partNumber?.trim() || undefined,
      backNumber: backNumber?.trim() || undefined,
      serialNumber: serialNumber?.trim() || undefined,
      qty: Number.isFinite(qty) && qty > 0 ? qty : undefined,
    };
  },
};

/**
 * Format ringkas: BACKNUMBER|SERIAL.
 *
 * Dua peran, dan keduanya masih perlu:
 *
 *   ketik manual   stasiun scan punya tombol ketik manual untuk kartu yang
 *                  QR-nya tergores. Mengetik `CI25|0001` masih mungkin di
 *                  lantai; mengetik seluruh isi AVK1 tidak, dan orang akan
 *                  menyerah lalu melewatkan scan-nya
 *   kartu lama     kartu percobaan yang sudah tercetak dengan format ini tetap
 *                  terbaca. Kartu yang sah tetapi tidak terbaca menghentikan
 *                  lini, dan itu harga yang tidak perlu dibayar untuk
 *                  kerapian format
 *
 * Yang hilang saat kartu diketik manual hanyalah pemeriksaan tambahan (part dan
 * qty); pencarian kartunya sendiri tetap utuh, karena (back number + seri)
 * itulah kunci yang dipakai mencari.
 */
export const ATURAN_KANBAN_BERPEMISAH: AturanKanban = {
  nama: 'KANBAN_BERPEMISAH',
  keterangan: 'BACKNUMBER|SERIAL',
  // Tepat dua ruas. Barcode PART yang berpemisah punya tiga-empat ruas
  // (PART|BACK|SERIAL|QTY) dan tidak boleh terbaca sebagai kartu.
  cocok: (raw) => raw.split('|').length === 2,
  baca(raw) {
    const [backNumber, serialNumber] = raw.split('|');
    return {
      raw,
      backNumber: backNumber?.trim() || undefined,
      serialNumber: serialNumber?.trim() || undefined,
    };
  },
};

/** Panjang nomor seri kartu kanban cetakan kita. */
export const PANJANG_SERI_KANBAN = 4;

/**
 * Nomor seri kartu sebagai teks, dari angka yang diminta OMD.
 *
 * Empat digit dengan nol di depan. Bukan selera: ATURAN_KANBAN_BERSPASI milik
 * sistem lama mengambil EMPAT KARAKTER TERAKHIR kolom serinya, dan seri "1"
 * yang tercetak apa adanya akan terbaca berbeda dari "0001" yang tersimpan di
 * master. Lebar yang tetap juga membuat kartu berjajar rapi di rak.
 *
 * Angka di atas 9999 dibiarkan apa adanya — memotongnya diam-diam akan membuat
 * kartu 10001 dan 20001 punya seri yang sama.
 */
export function seriKanban(nomor: number): string {
  return String(Math.trunc(nomor)).padStart(PANJANG_SERI_KANBAN, '0');
}

/** Membuang pemisah dan spasi dari satu ruas sebelum disusun jadi barcode. */
function ruasBersih(nilai: string): string {
  return nilai.trim().replace(/[|\s]/g, '');
}

/**
 * Menyusun isi barcode QR kartu kanban yang dicetak.
 *
 * Kebalikan ATURAN_KANBAN_AVICENNA, di satu tempat supaya yang dicetak pasti
 * terbaca — persis seperti `susunLabelDn` untuk label DN.
 *
 * ── Kenapa SEMUA ruas wajib ─────────────────────────────────────────────────
 *
 * Kartu kertas tidak bisa ditarik kembali. Satu ruas yang kosong saat dicetak
 * akan beredar bertahun-tahun, dan pembacanya harus memaafkannya selamanya —
 * jadi yang tidak lengkap ditolak di sini, saat kertasnya belum keluar.
 *
 * Masing-masing menyingkirkan satu kekeliruan:
 *
 *   back number  seri TIDAK unik antar part: "1001" ada pada beberapa part
 *                sekaligus. Back number-lah yang memisahkannya saat dicari
 *   seri         identitas kartu itu sendiri
 *   nomor part   mencocokkan kartu dengan part yang sedang dikerjakan di lini
 *   qty/box      mendeteksi kartu yang tercetak sebelum isi box diubah
 */
export function susunKodeKartuKanban(kartu: {
  partNumber: string;
  backNumber: string;
  serialNumber: string;
  qtyPerBox: number;
}): string {
  const part = ruasBersih(kartu.partNumber);
  const back = ruasBersih(kartu.backNumber);
  const seri = ruasBersih(kartu.serialNumber);
  if (!part) throw new Error('Kartu kanban tidak bisa dicetak tanpa nomor part');
  if (!back) throw new Error('Kartu kanban tidak bisa dicetak tanpa back number');
  if (!seri) throw new Error('Kartu kanban tidak bisa dicetak tanpa nomor seri');
  if (!Number.isInteger(kartu.qtyPerBox) || kartu.qtyPerBox <= 0) {
    throw new Error('Kartu kanban tidak bisa dicetak tanpa isi box yang wajar');
  }
  return [PENANDA_KARTU_KANBAN, part, back, seri, String(kartu.qtyPerBox)].join('|');
}

/**
 * Isi barcode versi KETIK MANUAL, yang tercetak sebagai teks di bawah QR.
 *
 * Bukan isi QR-nya yang ditulis di situ, dan itu disengaja: gunanya untuk
 * diketik orang saat QR-nya tergores, dan tiga puluh karakter tidak akan
 * diketik siapa pun di lantai. Keduanya menuju kartu yang sama — (back number +
 * seri) adalah kunci pencariannya, ruas lain hanya pemeriksaan tambahan.
 */
export function kodeKetikKanban(kartu: { backNumber: string; serialNumber: string }): string {
  const back = ruasBersih(kartu.backNumber);
  const seri = ruasBersih(kartu.serialNumber);
  if (!back) throw new Error('Kartu kanban tidak bisa dicetak tanpa back number');
  if (!seri) throw new Error('Kartu kanban tidak bisa dicetak tanpa nomor seri');
  return `${back}|${seri}`;
}

/** Panjang isi QR kartu kanban format AIGSYS, termasuk spasi di belakang. */
export const PANJANG_KANBAN_AIGSYS = 230;

/**
 * Seri terbesar yang muat di kartu AIGSYS. Kolom serinya empat digit, dan
 * sistem lama mengambil tepat empat karakter mulai posisi 123.
 */
export const SERI_KANBAN_AIGSYS_MAKS = 9999;

/**
 * Menyusun isi QR kartu kanban yang dicetak — format AIGSYS 230 karakter,
 * sama persis dengan kartu sistem lama (`AIGSYSGJ922 ...`).
 *
 * ── Kenapa ikut format lama, bukan AVK1 ────────────────────────────────────
 *
 * Kartu yang beredar di lantai berformat ini, dan sistem lama (Laravel)
 * membacanya dari POSISI, bukan dari pemisah: `substr($kode, 123, 4)` untuk
 * seri. Kartu yang kita cetak harus terbaca di sana juga selama keduanya
 * masih berjalan, jadi setiap kolom berada tepat di posisinya:
 *
 *     0  AIGSYSGJ922        tetap
 *    14  JE10               tetap
 *    20  JE + kode line     work center SAP lini yang memproduksi, mis. AS0547
 *    31  JE                 tetap
 *    40  0 + nomor part     nol di depan, seperti kartu lama
 *    63  SLOC + 000         SLOC tujuan, mis. SE1C000
 *    72  JE                 tetap
 *    81  XXX                tetap
 *    92  0                  tetap
 *   100  back number        empat karakter
 *   105  qty(7) + 0×11 + seri(4) — seri jatuh di posisi 123
 *   159  0                  tetap
 *   190  qty(7)             isi per box
 *   215  PCS                tetap
 *
 * Pembacanya di sistem ini ATURAN_KANBAN_AIGSYS (scan per box) dan
 * ATURAN_KANBAN_BERSPASI (yang lain); keduanya diuji terhadap hasil fungsi ini.
 *
 * ── Kenapa yang tidak muat DITOLAK, bukan dipotong ─────────────────────────
 *
 * Kolom yang kepanjangan akan menggeser atau menimpa kolom sesudahnya, dan
 * sistem lama tetap membaca posisi 123 — kartunya terbaca sebagai seri lain
 * tanpa galat apa pun. Kolom kosong lebih buruk lagi: pembaca berspasi
 * menghitung KOLOM, jadi satu kolom hilang menggeser back number dan seri.
 */
export function susunKanbanAigsys(kartu: {
  /** Work center SAP lini yang memproduksi part ini, tanpa "JE". */
  workCenter: string;
  partNumber: string;
  /** SLOC tujuan, empat karakter. */
  sloc: string;
  backNumber: string;
  serialNumber: string;
  qtyPerBox: number;
}): string {
  const wc = ruasBersih(kartu.workCenter);
  const part = ruasBersih(kartu.partNumber);
  const sloc = ruasBersih(kartu.sloc);
  const back = ruasBersih(kartu.backNumber);
  const seri = ruasBersih(kartu.serialNumber);

  if (!wc) throw new Error('Kartu kanban tidak bisa dicetak tanpa kode line (work center SAP)');
  if (!part) throw new Error('Kartu kanban tidak bisa dicetak tanpa nomor part');
  if (!sloc) throw new Error('Kartu kanban tidak bisa dicetak tanpa SLOC tujuan');
  if (!back) throw new Error('Kartu kanban tidak bisa dicetak tanpa back number');
  if (!seri) throw new Error('Kartu kanban tidak bisa dicetak tanpa nomor seri');
  if (!Number.isInteger(kartu.qtyPerBox) || kartu.qtyPerBox <= 0) {
    throw new Error('Kartu kanban tidak bisa dicetak tanpa isi box yang wajar');
  }

  /*
   * Batas tiap kolom diambil dari pembaca sistem lama, bukan dari lebar
   * kolomnya saja: ATURAN_KANBAN_BODY membaca nomor part 19 karakter mulai
   * posisi 41 dan back number 4 karakter mulai posisi 100.
   */
  if (wc.length > 8) throw new Error(`Kode line "${wc}" lebih dari 8 karakter`);
  if (part.length > 19) throw new Error(`Nomor part "${part}" lebih dari 19 karakter`);
  if (sloc.length > 4) throw new Error(`SLOC tujuan "${sloc}" lebih dari 4 karakter`);
  if (back.length > 4) throw new Error(`Back number "${back}" lebih dari 4 karakter`);
  if (!/^\d{4}$/.test(seri)) {
    throw new Error(`Nomor seri "${seri}" harus empat digit (paling besar ${SERI_KANBAN_AIGSYS_MAKS})`);
  }
  if (kartu.qtyPerBox > 9_999_999) throw new Error('Isi box lebih dari tujuh digit');

  const qty = String(kartu.qtyPerBox).padStart(7, '0');
  const kolom: [number, string][] = [
    [0, 'AIGSYSGJ922'],
    [14, 'JE10'],
    [20, `JE${wc}`],
    [31, 'JE'],
    [40, `0${part}`],
    [63, `${sloc}000`],
    [72, 'JE'],
    [81, 'XXX'],
    [92, '0'],
    [100, back],
    [105, `${qty}${'0'.repeat(11)}${seri}`],
    [159, '0'],
    [190, qty],
    [215, 'PCS'],
  ];

  let teks = '';
  for (const [posisi, isi] of kolom) teks = teks.padEnd(posisi) + isi;
  return teks.padEnd(PANJANG_KANBAN_AIGSYS);
}

/**
 * Daftar aturan kanban, berurutan.
 *
 * TIDAK ada aturan penadah di sini — berbeda dari barcode part. Kanban yang
 * tidak terbaca harus ditolak: menempelkan kartu yang salah baca berarti
 * barangnya dikirim atas nama kanban lain, dan itu tidak bisa dilacak balik.
 */
/**
 * Kartu kanban BODY — label customer lebar dengan posisi tetap.
 *
 * Diambil apa adanya dari prdreport bella. Format dibedakan dari PANJANG
 * barcode; tiap panjang punya posisi kolomnya sendiri:
 *
 *   230  kanban biasa       part @41(19)  seri @123  back @100  pcs @196
 *   220  kanban buffer      part @35(12)  seri @130  back @100  pcs @196
 *   241  kanban passthrough part @35(12)  seri @127  back @100  pcs @196
 *   218  kanban suzuki      part @41(16)  seri @123  back @100  pcs @196
 *
 * Posisi ini bukan tebakan — sudah dipakai bertahun-tahun di lantai BODY.
 * Kalau customer mengubah labelnya, yang berubah cukup tabel ini.
 *
 * Hanya berlaku di mode per-kanban: di UNIT tidak ada label sepanjang ini,
 * dan membiarkannya menyala di sana hanya menambah peluang salah baca.
 */
const POSISI_KANBAN_BODY: Record<number, { part: [number, number]; seri: number; nama: string }> = {
  230: { part: [41, 19], seri: 123, nama: 'biasa' },
  220: { part: [35, 12], seri: 130, nama: 'buffer' },
  241: { part: [35, 12], seri: 127, nama: 'passthrough' },
  218: { part: [41, 16], seri: 123, nama: 'suzuki' },
};

export const ATURAN_KANBAN_BODY: AturanKanban = {
  nama: 'KANBAN_BODY',
  keterangan: 'label kanban customer BODY, dibedakan dari panjang (230/220/241/218)',
  berlaku: (ctx) => scanPerBox(ctx.scanMode),
  cocok: (raw) => raw.length in POSISI_KANBAN_BODY,
  baca(raw) {
    const p = POSISI_KANBAN_BODY[raw.length]!;
    const pcs = Number.parseInt(raw.substr(196, 1), 10);
    return {
      raw,
      partNumber: raw.substr(p.part[0], p.part[1]).trim() || undefined,
      serialNumber: raw.substr(p.seri, 4).trim() || undefined,
      backNumber: raw.substr(100, 4).trim() || undefined,
      qty: Number.isFinite(pcs) && pcs > 0 ? pcs : undefined,
    };
  },
};

/**
 * Kartu kanban AIGSYS — label bertoken, dipisah spasi, dengan padding yang
 * tidak tetap. Karena itu dibaca dari BENTUK tokennya, bukan posisinya:
 *
 *   token pertama        AIGSYS…
 *   nomor part           0DDDDDD-XXX…  (nol di depan dibuang)
 *   nomor seri           20+ digit; 4 terakhir = seri kartu
 *   back number          token tepat SEBELUM nomor seri
 *   pcs                  token kedua dari belakang
 *
 * Ditaruh SEBELUM aturan posisi-tetap: label AIGSYS bisa kebetulan sepanjang
 * salah satu dari empat panjang di atas, dan pembacaan posisi akan menghasilkan
 * seri yang salah tanpa galat apa pun.
 */
export const ATURAN_KANBAN_AIGSYS: AturanKanban = {
  nama: 'KANBAN_AIGSYS',
  keterangan: 'label kanban AIGSYS bertoken (BODY)',
  berlaku: (ctx) => scanPerBox(ctx.scanMode),
  cocok: (raw) => /^AIGSYS/i.test(raw.trim().split(/\s+/)[0] ?? ''),
  baca(raw) {
    const token = raw.trim().split(/\s+/);
    const iPart = token.findIndex((t) => /^0\d{6}-[A-Z0-9]+(?:-[A-Z0-9]+)*$/i.test(t));
    const iSeri = token.findIndex((t) => /^\d{20,}$/.test(t));
    const pcs = Number.parseInt(token[token.length - 2] ?? '', 10);
    return {
      raw,
      partNumber: iPart >= 0 ? token[iPart]!.replace(/^0(?=\d{6}-)/, '') : undefined,
      serialNumber: iSeri >= 0 ? token[iSeri]!.slice(-4) : undefined,
      backNumber: iSeri > 0 ? token[iSeri - 1] : undefined,
      qty: Number.isFinite(pcs) && pcs > 0 ? pcs : undefined,
    };
  },
};

/**
 * Label DN loading list — direct pulling di lini FG.
 *
 * Diambil dari layar casting D98E avicenna lama (`getAjaxCastingD98e`):
 * empat ruas dipisah "~", contoh `xxx~L75~DN-202605-0006~1`:
 *
 *   ruas 1  tidak dipakai sistem lama (dibiarkan apa adanya)
 *   ruas 2  nomor part menurut CUSTOMER (ext_matnr)
 *   ruas 3  nomor DN / loading list
 *   ruas 4  urutan box dalam DN, 1-3 digit
 *
 * Di sistem lama label ini langsung menyimpan box ke loading list lewat API
 * pulling bella (`api_save_ldlist_dn`) — box yang ditutup dengan label ini
 * tidak melewati pulling lagi. Serinya dibentuk `DN/urutan` supaya satu label
 * = satu kartu di TM_KANBAN dan aturan kapasitas kartu tetap berlaku.
 */
export const ATURAN_KANBAN_LABEL_DN: AturanKanban = {
  nama: 'KANBAN_LABEL_DN',
  keterangan: 'RUAS~PART_CUSTOMER~NOMOR_DN~URUTAN_BOX (label DN, direct pulling)',
  cocok: (raw) => /^[^~]*~[^~\s]+~[^~\s]+~\d{1,3}$/.test(raw),
  baca(raw) {
    const [, customerPartNumber, dnNumber, seq] = raw.split('~');
    const dnSeq = Number.parseInt(seq ?? '', 10);
    return {
      raw,
      customerPartNumber: customerPartNumber?.trim(),
      dnNumber: dnNumber?.trim(),
      dnSeq,
      serialNumber: `${dnNumber?.trim()}/${dnSeq}`,
    };
  },
};

/**
 * Menyusun isi label DN untuk dicetak dari loading list kita sendiri.
 *
 * Kebalikan ATURAN_KANBAN_LABEL_DN, di satu tempat supaya yang dicetak pasti
 * terbaca. Ruas pertama diisi kode customer — sistem lama tidak membacanya,
 * dan di sini pun tidak; gunanya untuk mata orang di lantai.
 */
export function susunLabelDn(label: {
  customerCode: string;
  customerPartNumber: string;
  dnNumber: string;
  dnSeq: number;
}): string {
  const bersih = (v: string) => v.trim().replace(/[~\s]/g, '');
  return [
    bersih(label.customerCode),
    bersih(label.customerPartNumber),
    bersih(label.dnNumber),
    String(label.dnSeq),
  ].join('~');
}

export const DAFTAR_ATURAN_KANBAN: AturanKanban[] = [
  ATURAN_KANBAN_AVICENNA,
  ATURAN_KANBAN_LABEL_DN,
  ATURAN_KANBAN_BERPEMISAH,
  ATURAN_KANBAN_AIGSYS,
  ATURAN_KANBAN_BODY,
  ATURAN_KANBAN_BERSPASI,
];

/**
 * Apakah teks ini berbentuk kartu kanban — bukan barcode part?
 *
 * Dipakai layar FG per barang, yang menerima keduanya di satu kotak scan:
 * part ditahan dulu, kartu menutup box. Keputusannya memakai aturan kanban
 * yang sama dengan server, jadi yang dianggap kartu di layar juga kartu di
 * server. Di UNIT tidak ada tumpang tindih: barcode part 15 karakter tanpa
 * spasi, kartu berspasi panjang atau BACK|SERI dua ruas.
 */
export function sepertiKanban(raw: string, ctx: KonteksBarcode = {}): boolean {
  try {
    bacaKanban(raw, ctx);
    return true;
  } catch {
    return false;
  }
}

export function bacaKanban(raw: string, ctx: KonteksBarcode = {}): HasilBacaKanban {
  const bersih = raw.trim();
  if (bersih.length === 0) throw new Error('Barcode kanban kosong');

  for (const aturan of DAFTAR_ATURAN_KANBAN) {
    if (aturan.berlaku && !aturan.berlaku(ctx)) continue;
    if (!aturan.cocok(bersih)) continue;
    const hasil = aturan.baca(bersih);
    // Aturan yang cocok tetapi tidak menghasilkan seri sama saja dengan tidak
    // terbaca — jangan diteruskan sebagai hasil setengah jadi.
    if (!hasil.serialNumber) continue;
    return { ...hasil, aturan: aturan.nama };
  }

  throw new KanbanTidakTerbaca(bersih);
}
