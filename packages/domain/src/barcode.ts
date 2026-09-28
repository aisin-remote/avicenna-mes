import type { ProcessType, ScanMode } from '@avicenna/contracts';
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
  scanMode?: ScanMode | null;
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
 * Format berpemisah: PARTNUMBER|BACKNUMBER|SERIAL|QTY
 *
 * Ini format yang dipakai sejak awal sistem ini dan sudah punya test. Tetap
 * ditaruh paling depan karena bentuknya paling khas — adanya "|" membuatnya
 * tidak mungkin tertukar dengan format lain.
 */
export const ATURAN_BERPEMISAH: AturanBarcode = {
  nama: 'BERPEMISAH',
  keterangan: 'PARTNUMBER|BACKNUMBER|SERIAL|QTY',
  cocok: (raw) => raw.includes('|'),
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
  berlaku: (ctx) => ctx.scanMode === 'PER_KANBAN',
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
  /** Isi kartu menurut kartunya sendiri (pcs). Bila ada, dicocokkan ke master. */
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
 * Format ringkas: BACKNUMBER|SERIAL.
 *
 * Dipakai kartu cetakan baru. Ditaruh lebih dulu karena bentuknya paling khas.
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
  berlaku: (ctx) => ctx.scanMode === 'PER_KANBAN',
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
  berlaku: (ctx) => ctx.scanMode === 'PER_KANBAN',
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
