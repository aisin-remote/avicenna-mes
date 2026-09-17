import { menghasilkanFinishGood, type ProcessType } from '@avicenna/contracts';

/*
 * Di-re-ekspor supaya pemakainya cukup satu impor: aturan rute dan pertanyaan
 * "apakah lini ini menghasilkan finish good" selalu dipakai bersamaan.
 * Definisinya tetap satu, di @avicenna/contracts.
 */
export { menghasilkanFinishGood };

/**
 * Aturan urutan proses produksi.
 *
 * ── Rute melekat pada PART, bukan pada jenis prosesnya ──────────────────────
 *
 * Versi sebelumnya memakai satu rantai global (CASTING -> MACHINING ->
 * ASSEMBLING) yang berlaku untuk semua part. Rute sebenarnya di AIIA berbeda-
 * beda per part:
 *
 *   TCC A   Melting -> Casting -> Machining -> Assembling(Unit) -> Delivery
 *   OPN A   Melting -> Casting -> Machining -> Delivery
 *   CSH A   Melting -> Casting -> Delivery
 *   HANDLE  Injection -> Painting -> Assembling(Body) -> Delivery
 *   GARNISH Injection -> Assembling(Body) -> Delivery
 *
 * Satu rantai global tidak bisa menyatakan bahwa proses sebelum Delivery adalah
 * Casting untuk CSH A, Machining untuk OPN A, dan Assembling untuk TCC A.
 * Karena itu urutan sekarang dibaca dari rute part di TM_PROCESS_PARTS, dan
 * fungsi-fungsi di sini bekerja atas rute yang diberikan — bukan atas daftar
 * yang ditanam di kode.
 *
 * Bahkan dua part dalam satu proyek bisa berbeda: pada proyek 660A, GARNISH
 * tidak melewati Painting sedangkan HANDLE melewatinya.
 */

/** Satu langkah dalam rute sebuah part. */
export interface LangkahRute {
  processType: ProcessType;
  /** Urutan di dalam rute part ini. Bukan urutan global. */
  seqNo: number;
}

/**
 * Proses yang wajib sudah dilalui sebelum `proses` boleh menerima scan.
 *
 * Yang dicari adalah langkah dengan seqNo TERBESAR yang masih lebih kecil dari
 * seqNo proses sekarang — di dalam rute part itu sendiri. Bukan urutan global,
 * dan bukan sekadar "satu nomor sebelumnya": nomor urut boleh berlompatan
 * (10, 20, 30) supaya langkah baru bisa disisipkan tanpa menomori ulang
 * seluruh rute.
 *
 * `undefined` berarti tidak ada syarat — proses ini yang pertama dalam rutenya,
 * atau prosesnya memang tidak ada dalam rute part tersebut.
 */
export function prosesSebelumnya(
  rute: readonly LangkahRute[],
  proses: ProcessType,
): ProcessType | undefined {
  const sekarang = rute.find((r) => r.processType === proses);
  if (!sekarang) return undefined;

  let terdekat: LangkahRute | undefined;
  for (const langkah of rute) {
    if (langkah.seqNo >= sekarang.seqNo) continue;
    if (!terdekat || langkah.seqNo > terdekat.seqNo) terdekat = langkah;
  }
  return terdekat?.processType;
}

/**
 * Apakah proses ini memang bagian dari rute part tersebut.
 *
 * Scan di proses yang tidak ada dalam rute adalah kekeliruan yang nyata —
 * part dibawa ke lini yang salah. Tanpa pemeriksaan ini, part CSH yang tidak
 * pernah melewati machining akan diterima di lini machining dan menambah stok
 * barang jadi yang tidak pernah dibuat.
 */
export function prosesAdaDiRute(rute: readonly LangkahRute[], proses: ProcessType): boolean {
  return rute.some((r) => r.processType === proses);
}

/** Rute diurutkan menurut seqNo — untuk ditampilkan di layar. */
export function ruteTerurut(rute: readonly LangkahRute[]): LangkahRute[] {
  return [...rute].sort((a, b) => a.seqNo - b.seqNo);
}

export type ScanRejectReason =
  | 'DUPLICATE'
  | 'UNKNOWN_PROGRAM'
  | 'MISSING_PREVIOUS_PROCESS'
  | 'LINE_NOT_FOUND'
  | 'PLANT_UNKNOWN'
  | 'BARCODE_UNREADABLE'
  | 'PART_NOT_RECOGNIZED'
  | 'PROCESS_NOT_IN_ROUTE'
  | 'KANBAN_REQUIRED'
  | 'KANBAN_UNREADABLE'
  | 'KANBAN_NOT_REGISTERED'
  | 'KANBAN_PART_MISMATCH'
  | 'KANBAN_FULL'
  | 'KANBAN_NOT_EXPECTED';

/** Pesan untuk operator. Ditulis sebagai instruksi, bukan sekadar keterangan. */
export const REJECT_MESSAGES: Record<ScanRejectReason, string> = {
  DUPLICATE: 'Barcode ini sudah pernah discan. Ambil part berikutnya.',
  UNKNOWN_PROGRAM: 'Kode program tidak dikenal. Laporkan ke leader.',
  MISSING_PREVIOUS_PROCESS: 'Part belum discan di proses sebelumnya. Jangan diproses.',
  LINE_NOT_FOUND: 'Line tidak dikenal. Periksa barcode line.',
  PLANT_UNKNOWN: 'Pabrik tidak bisa ditentukan dari scan ini.',
  BARCODE_UNREADABLE: 'Barcode tidak terbaca. Coba scan ulang, lalu laporkan ke leader.',
  /*
   * Sebelumnya keadaan ini TIDAK ditolak: scan tetap tercatat, tetapi karena
   * part-nya tidak dikenali tidak ada mutasi stok yang ditulis. Operator
   * melihat "berhasil", stoknya tidak pernah bergerak, dan selisihnya baru
   * ketahuan saat stock opname.
   */
  PART_NOT_RECOGNIZED: 'Part tidak dikenali dari barcode ini. JANGAN diproses — laporkan ke leader.',
  PROCESS_NOT_IN_ROUTE: 'Part ini tidak melewati proses di lini ini. Periksa part-nya.',

  /*
   * Enam alasan seputar kanban. Dipisah sedetail ini karena operator harus tahu
   * APA yang keliru tanpa memanggil siapa pun: kartunya, part-nya, atau
   * kartunya sudah terpakai — masing-masing tindakannya berbeda.
   */
  KANBAN_REQUIRED: 'Lini ini wajib scan kanban. Scan kartu kanbannya.',
  KANBAN_UNREADABLE: 'Barcode kanban tidak terbaca. Scan ulang kartunya.',
  KANBAN_NOT_REGISTERED: 'Kartu kanban ini belum terdaftar. Laporkan ke leader.',
  KANBAN_PART_MISMATCH: 'Kartu kanban ini bukan untuk part tersebut. Ambil kartu yang benar.',
  KANBAN_FULL: 'Kartu kanban ini sudah terisi penuh. Ambil kartu kosong.',
  KANBAN_NOT_EXPECTED: 'Lini ini tidak memakai kanban. Cukup scan part code.',
};

/**
 * Mengambil kode program dari barcode.
 *
 * DUA KARAKTER PERTAMA. Ini terbaca dari `substr($number, 0, 2)` yang muncul
 * identik di ketiga fungsi scan avicenna, lalu dicocokkan ke tabel
 * avi_trace_program_number untuk mendapatkan produk dan back number.
 */
export function programCodeOf(barcode: string): string | undefined {
  const trimmed = barcode.trim();
  if (trimmed.length < 2) return undefined;
  return trimmed.slice(0, 2);
}

/**
 * Memeriksa kewajaran sebuah rute.
 *
 * ── Aturan yang diperiksa ───────────────────────────────────────────────────
 *
 * 1. Langkah TEPAT SEBELUM Delivery harus lini FG. Sejak titik itu barang
 *    berpindah sebagai kanban, dan di delivery part code sudah tidak discan
 *    sama sekali — rute yang berakhir di lini WIP menghasilkan barang yang
 *    tidak punya kanban, dan barang itu tidak akan pernah bisa dikirim.
 *
 * 2. Lini FG tidak boleh berada di tengah rute. Kanban ditempel sekali, di
 *    langkah terakhir; menempelkannya lalu memprosesnya lagi membuat kanban
 *    menunjuk barang yang sudah berubah bentuk.
 *
 * 3. Rute yang memuat Delivery harus punya tepat satu lini FG.
 *
 * Mengembalikan daftar masalah dalam bahasa yang terbaca di layar; kosong
 * berarti rutenya wajar.
 */
export function periksaRute(rute: readonly LangkahRute[]): string[] {
  if (rute.length === 0) return [];

  const urut = ruteTerurut(rute);
  const fg = urut.filter((l) => menghasilkanFinishGood(l.processType));
  const punyaDelivery = urut.some((l) => l.processType === 'DELIVERY');
  const masalah: string[] = [];

  if (!punyaDelivery) {
    // Rute yang berhenti sebagai WIP memang ada — komponen setengah jadi yang
    // dipakai proses lain. Yang tidak wajar justru bila ia punya lini FG.
    if (fg.length > 0) {
      masalah.push(
        `rute tanpa Delivery tidak seharusnya melewati lini finish good (${fg
          .map((l) => l.processType)
          .join(', ')})`,
      );
    }
    return masalah;
  }

  const posisiDelivery = urut.findIndex((l) => l.processType === 'DELIVERY');
  if (posisiDelivery !== urut.length - 1) {
    masalah.push('Delivery harus menjadi langkah terakhir');
  }

  if (fg.length === 0) {
    masalah.push(
      'rute berakhir di Delivery tetapi tidak melewati lini finish good — barangnya tidak akan punya kanban',
    );
  } else if (fg.length > 1) {
    masalah.push(
      `rute melewati lebih dari satu lini finish good (${fg.map((l) => l.processType).join(', ')})`,
    );
  } else {
    const sebelumDelivery = urut[posisiDelivery - 1];
    if (sebelumDelivery && sebelumDelivery.processType !== fg[0]!.processType) {
      masalah.push(
        `langkah sebelum Delivery adalah ${sebelumDelivery.processType}, bukan lini finish good`,
      );
    }
  }

  return masalah;
}
