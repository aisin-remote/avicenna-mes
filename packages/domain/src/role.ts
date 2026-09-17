import { PROCESS_GROUPS, ROLE_KINDS, type ProcessGroup, type RoleKind, type ProcessType } from '@avicenna/contracts';

/**
 * Role = PROSES × JABATAN.
 *
 * Di lapangan namanya disebut "casting lasman", "casting jp", "casting leader",
 * dan seterusnya untuk tiap proses. Memetakan tiap kombinasi satu per satu
 * berarti daftar yang bertambah tiap kali ada proses atau jabatan baru — dan
 * setiap penambahan menuntut perubahan kode.
 *
 * Karena itu role menyimpan DUA hal: proses mana lingkupnya, dan apa yang boleh
 * dikerjakannya. Halaman awalnya diturunkan dari keduanya.
 */

/**
 * Grup proses — lingkup sebuah role.
 *
 * Lebih longgar daripada jenis proses: "casting lasman" mencakup lini Casting
 * WIP maupun Casting FG. Memakai jenis proses sebagai lingkup akan menuntut dua
 * role terpisah untuk satu jabatan yang di lapangan memang satu orang.
 */
export { PROCESS_GROUPS, type ProcessGroup };

const GRUP: Record<ProcessType, ProcessGroup> = {
  MELTING: 'MELTING',
  CASTING_WIP: 'CASTING',
  CASTING_FG: 'CASTING',
  MACHINING_WIP: 'MACHINING',
  MACHINING_FG: 'MACHINING',
  ASSEMBLING_UNIT: 'ASSEMBLING',
  ASSEMBLING_BODY: 'ASSEMBLING',
  INJECTION: 'INJECTION',
  PAINTING: 'PAINTING',
  DELIVERY: 'DELIVERY',
};

export function grupProses(p: ProcessType): ProcessGroup {
  return GRUP[p];
}

/** Jenis proses yang termasuk sebuah grup. */
export function prosesDalamGrup(g: ProcessGroup): ProcessType[] {
  return (Object.keys(GRUP) as ProcessType[]).filter((p) => GRUP[p] === g);
}

/**
 * Apa yang dikerjakan pemegang role.
 *
 *   SCANNING  berdiri di lini, men-scan barang         (lasman)
 *   VIEW      memeriksa data, tidak men-scan            (jp, leader)
 *   ADMIN     mengelola master dan seluruh sistem
 */
export { ROLE_KINDS, type RoleKind };

export interface RoleScope {
  kind: RoleKind;
  /** Grup proses yang menjadi lingkupnya. Kosong berarti seluruh proses. */
  processGroup?: ProcessGroup | null;
}

/**
 * Halaman yang dibuka tepat setelah login.
 *
 * ── Kenapa diturunkan, bukan disimpan per role ──────────────────────────────
 *
 * Menyimpan alamat halaman di tiap baris role berarti penggantian alamat
 * menuntut penyuntingan data di setiap lingkungan — dan lingkungan yang
 * terlewat akan mengirim orang ke halaman yang sudah tidak ada.
 *
 * Yang disimpan adalah maksudnya (scanning/lihat, proses apa); alamatnya
 * ditentukan di satu tempat ini.
 */
export function halamanAwal(role: RoleScope): string {
  if (role.kind === 'ADMIN') return '/dashboard';

  if (role.kind === 'SCANNING') {
    /*
     * Halaman scan per GRUP, bukan per lini. Lini belum diketahui saat login —
     * operator menentukannya dengan men-scan barcode lini di layar itu.
     */
    return role.processGroup ? `/scan/proses/${role.processGroup.toLowerCase()}` : '/scan';
  }

  // VIEW: pemantauan. Disaring ke prosesnya bila lingkupnya ada.
  return role.processGroup ? `/monitor?proses=${role.processGroup.toLowerCase()}` : '/monitor';
}

/** Apakah role ini boleh men-scan di lini dengan jenis proses tersebut. */
export function bolehScanDi(role: RoleScope, proses: ProcessType): boolean {
  if (role.kind === 'ADMIN') return true;
  if (role.kind !== 'SCANNING') return false;
  if (!role.processGroup) return true;
  return grupProses(proses) === role.processGroup;
}

export const ROLE_KIND_LABELS: Record<RoleKind, string> = {
  SCANNING: 'Scanning di lini',
  VIEW: 'Cek data',
  ADMIN: 'Administrator',
};

export const PROCESS_GROUP_LABELS: Record<ProcessGroup, string> = {
  MELTING: 'Melting',
  CASTING: 'Casting',
  MACHINING: 'Machining',
  ASSEMBLING: 'Assembling',
  INJECTION: 'Injection',
  PAINTING: 'Painting',
  DELIVERY: 'Delivery',
};

/* ────────────────────────────────────────────────────────────────────────────
 * LOGIN LEWAT QR
 * ──────────────────────────────────────────────────────────────────────────── */

export interface KredensialQr {
  npk: string;
  password: string;
}

export class QrLoginTidakTerbaca extends Error {
  constructor() {
    super('Kartu login tidak terbaca. Pastikan QR-nya utuh, atau masuk manual.');
    this.name = 'QrLoginTidakTerbaca';
  }
}

/**
 * Membaca kartu login: `NPK|password`.
 *
 * Dipisah pada tanda "|" PERTAMA saja, bukan seluruhnya. Kata sandi yang
 * kebetulan memuat "|" akan terpotong bila dipecah semuanya, dan orangnya
 * ditolak masuk tanpa sebab yang terlihat.
 *
 * ── NPK dirapikan, kata sandi TIDAK ─────────────────────────────────────────
 *
 * Kredensial tidak boleh diubah diam-diam: kata sandi yang sah bisa saja diawali
 * atau diakhiri spasi, dan memangkasnya membuat orangnya tidak pernah bisa masuk
 * tanpa petunjuk apa pun. NPK aman dirapikan karena bentuknya pasti — hanya
 * angka.
 *
 * Akibatnya kartu yang terlanjur dicetak dengan spasi ("NPK | sandi") akan
 * ditolak sebagai sandi salah. Itu disengaja; memperbaikinya di sini berarti
 * menebak mana spasi yang berarti dan mana yang tidak.
 */
export function bacaQrLogin(raw: string): KredensialQr {
  const bersih = raw.trim();
  const pemisah = bersih.indexOf('|');
  if (pemisah <= 0) throw new QrLoginTidakTerbaca();

  const npk = bersih.slice(0, pemisah).trim();
  const password = bersih.slice(pemisah + 1);
  if (!npk || !password) throw new QrLoginTidakTerbaca();

  return { npk, password };
}

/**
 * Apakah barcode ini BERBENTUK kartu login.
 *
 * ── Bentuk saja, bukan keputusan ────────────────────────────────────────────
 *
 * Yang memutuskan seseorang benar-benar memegang kartu login adalah kata
 * sandinya, dan itu hanya bisa diperiksa server. Fungsi ini cuma penyaring
 * murah di depan: memutuskan apakah barcode layak dicoba sebagai kartu login,
 * bukan menyatakan bahwa ia memang kartu login.
 *
 * ── Kenapa "ada tanda |" tidak cukup ────────────────────────────────────────
 *
 * Barcode part (ATURAN_BERPEMISAH: `PARTNUMBER|BACKNUMBER|SERIAL|QTY`) dan
 * kartu kanban (ATURAN_KANBAN_BERPEMISAH: `BACKNUMBER|SERIAL`) sama-sama
 * memakai tanda itu. Menganggap setiap barcode ber-"|" sebagai kartu login
 * berarti operator yang men-scan kanban di lini FG akan dikeluarkan dari
 * sesinya di tengah shift.
 *
 * Tiga syarat yang mempersempitnya, dan masing-masing menyingkirkan satu hal:
 *
 *   tepat SATU pemisah   menyingkirkan barcode part 3-4 bagian
 *   NPK berbentuk NPK    huruf, angka, titik, garis bawah, strip — tanpa spasi
 *   sandi minimal 6      menyingkirkan kartu kanban, yang serinya empat angka
 *
 * Yang TERSISA sebagai risiko: barcode dua bagian yang bagian keduanya enam
 * karakter atau lebih akan ikut tersaring ke jalur login. Di lini WIP casting
 * dan machining itu tidak mungkin terjadi — barcode di situ 15 karakter tanpa
 * pemisah sama sekali. Kalau suatu saat ada lini yang memakai bentuk seperti
 * itu untuk part, syarat di sini yang harus dipersempit, bukan pemanggilnya.
 */
export function sepertiKartuLogin(raw: string): boolean {
  const bersih = raw.trim();
  const bagian = bersih.split('|');
  if (bagian.length !== 2) return false;

  const [npk, sandi] = bagian;
  if (!npk || !sandi) return false;
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(npk)) return false;

  /*
   * Panjang sandi TIDAK dirapikan lebih dulu.
   *
   * Sandi yang sah boleh diawali atau diakhiri spasi — lihat bacaQrLogin. Kalau
   * di sini dipangkas, kartu dengan sandi berspasi bisa lolos saringan padahal
   * yang dikirim ke server nanti berbeda panjang.
   */
  return sandi.length >= 6;
}
