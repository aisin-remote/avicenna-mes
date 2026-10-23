/**
 * Mesin status kanban.
 *
 * Di sistem lama, perpindahan status tersebar di banyak controller sehingga
 * kanban bisa "loncat" ke status yang tidak masuk akal (mis. DELIVERED tanpa
 * pernah PRODUCED). Di sini transisinya dideklarasikan satu tempat dan diuji.
 */

export type KanbanStatus =
  | 'AVAILABLE'
  | 'PRODUCED'
  | 'STORED'
  | 'PULLED'
  | 'LOADED'
  | 'DELIVERED'
  | 'CANCELLED';

export type KanbanEventType =
  | 'PRODUCED'
  | 'RELEASED'
  | 'PULLED'
  | 'PAIRED'
  | 'STORED'
  | 'LOADED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ADJUSTED';

/** Status tujuan yang sah untuk tiap kombinasi (status sekarang, event). */
/*
 * RELEASED dan DELIVERED bisa datang dari BEBERAPA keadaan, bukan hanya dari
 * LOADED, dan itu disengaja.
 *
 * Pelepasan terjadi saat truk dinyatakan berangkat, dan pada saat itu kartu
 * yang ikut tidak selalu melewati jalur yang sama: kartu biasa sudah PULLED
 * lewat pulling, sedangkan kartu customer direct pulling bisa langsung naik
 * truk dari keadaan PRODUCED tanpa pernah dipull. Memaksa semuanya lewat
 * LOADED berarti menolak melepas kartu yang jelas-jelas sudah pergi — dan
 * kartu yang tidak terlepas tidak akan pernah bisa dipakai lagi.
 */
const TRANSITIONS: Record<KanbanStatus, Partial<Record<KanbanEventType, KanbanStatus>>> = {
  AVAILABLE: { PRODUCED: 'PRODUCED', CANCELLED: 'CANCELLED' },
  PRODUCED: {
    STORED: 'STORED',
    PULLED: 'PULLED',
    PAIRED: 'PRODUCED',
    RELEASED: 'AVAILABLE',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
  STORED: {
    PULLED: 'PULLED',
    PAIRED: 'STORED',
    RELEASED: 'AVAILABLE',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
  PULLED: {
    LOADED: 'LOADED',
    STORED: 'STORED',
    PAIRED: 'PULLED',
    RELEASED: 'AVAILABLE',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
  },
  LOADED: {
    DELIVERED: 'DELIVERED',
    RELEASED: 'AVAILABLE',
    PULLED: 'PULLED',
    CANCELLED: 'CANCELLED',
  },
  // Status akhir: hanya bisa diubah lewat event ADJUSTED yang tercatat.
  DELIVERED: { ADJUSTED: 'DELIVERED' },
  CANCELLED: { ADJUSTED: 'CANCELLED' },
};

export class InvalidKanbanTransitionError extends Error {
  constructor(
    readonly from: KanbanStatus,
    readonly event: KanbanEventType,
  ) {
    super(`Kanban tidak bisa berpindah dari ${from} lewat event ${event}`);
    this.name = 'InvalidKanbanTransitionError';
  }
}

export function canTransition(from: KanbanStatus, event: KanbanEventType): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/** Mengembalikan status berikutnya, atau melempar bila transisinya tidak sah. */
export function nextKanbanStatus(from: KanbanStatus, event: KanbanEventType): KanbanStatus {
  const next = TRANSITIONS[from][event];
  if (next === undefined) throw new InvalidKanbanTransitionError(from, event);
  return next;
}

/**
 * ─── PRODUCTION VERSION SEBUAH KARTU ────────────────────────────────────────
 *
 * Blueprint PP AIIA (PP-MD-05) menjadikannya SYARAT pembuatan kanban: Project
 * Control memastikan dulu Production Version material tersedia dan valid, baru
 * kartunya dibuat. Versinya sendiri dimiliki SAP dan dipelihara di sana.
 *
 * ── Diwariskan dari part, lalu DIBEKUKAN di kartu ───────────────────────────
 *
 * Satu part bisa punya ribuan kartu. Mengetik versinya satu per satu adalah
 * cara paling pasti membuat sebagian kartu memakai versi berbeda tanpa ada yang
 * menyadarinya, jadi kartu mewarisi dari part.
 *
 * Tetapi yang diwarisi itu DISALIN, bukan dirujuk: begitu versi material
 * diganti, kartu yang sudah beredar tetap menyatakan versi yang benar-benar
 * dipakai membuatnya. Merujuk akan membuat seluruh riwayat ikut berubah secara
 * surut — dan riwayat yang berubah sendiri adalah riwayat yang tidak bisa
 * dipakai menjawab apa pun.
 *
 * ── Kartu customer dikecualikan ─────────────────────────────────────────────
 *
 * Label DN yang didaftarkan otomatis saat scan adalah milik CUSTOMER, bukan
 * master kanban kita — tidak ada Production Version yang bisa dilekatkan
 * padanya, dan mewajibkannya akan menghentikan scan pengiriman.
 */
export interface AsalProductionVersion {
  owner: 'INTERNAL' | 'CUSTOMER';
  /** Yang diketik di kartu, bila ada. */
  versiKartu?: string | null;
  /** Milik part-nya — sumber warisan. */
  versiPart?: string | null;
}

export interface HasilProductionVersion {
  /** Yang harus disimpan di kartu. */
  versi: string | null;
  /** Terisi bila kartunya TIDAK boleh dibuat. */
  masalah?: string;
}

export function productionVersionKartu(asal: AsalProductionVersion): HasilProductionVersion {
  const bersih = (v: string | null | undefined) => (v ?? '').trim() || null;
  const kartu = bersih(asal.versiKartu);
  const part = bersih(asal.versiPart);

  if (asal.owner === 'CUSTOMER') return { versi: kartu };
  if (kartu) return { versi: kartu };
  if (part) return { versi: part };
  return {
    versi: null,
    masalah:
      'Production Version part ini belum diisi. Lengkapi dulu di master Part — ' +
      'blueprint SAP menjadikannya syarat pembuatan kanban.',
  };
}

/**
 * ─── PELEPASAN KARTU SAAT TRUK BERANGKAT ────────────────────────────────────
 *
 * Inilah yang membuat kartu BERPUTAR. Tanpa langkah ini kartu sekali pakai:
 * isinya tidak pernah dikosongkan, sehingga lini finish good menolaknya sebagai
 * "kartu penuh" pada putaran berikutnya — dan satu-satunya jalan keluar adalah
 * mencetak kartu baru terus-menerus.
 *
 * ── Kapan, dan kenapa bukan saat kartunya discan ────────────────────────────
 *
 * Saat truk dinyatakan BERANGKAT. Scan muat masih bisa dibatalkan operator;
 * keberangkatan tidak. Melepas kartu pada saat scan berarti setiap pembatalan
 * harus mengembalikan isi kartu dan mengurangi hitungan putarannya — koreksi
 * yang mudah meleset, dan kalau meleset kartunya hilang dari peredaran tanpa
 * ada yang tahu.
 *
 * ── Kartu customer tidak dilepas ────────────────────────────────────────────
 *
 * Ia ikut barangnya ke customer dan tidak pernah kembali, jadi tidak ada yang
 * bisa dilepaskan. Isinya tetap dikosongkan — barangnya memang sudah pergi,
 * dan kartu yang masih "berisi" akan terbaca seolah barangnya masih di sini.
 */
export interface PelepasanKanban {
  /** Keadaan kartu setelah truk berangkat. */
  status: Extract<KanbanStatus, 'AVAILABLE' | 'DELIVERED'>;
  /** Kejadian yang dicatat di TT_KANBAN_EVENT. */
  event: Extract<KanbanEventType, 'RELEASED' | 'DELIVERED'>;
  /** Apakah putaran kartu bertambah satu. */
  hitungSiklus: boolean;
  /** Dibaca manusia di riwayat kartu. */
  alasan: string;
}

export function pelepasanKanban(owner: 'INTERNAL' | 'CUSTOMER'): PelepasanKanban {
  if (owner === 'CUSTOMER') {
    return {
      status: 'DELIVERED',
      event: 'DELIVERED',
      hitungSiklus: false,
      alasan: 'kartu customer ikut barangnya dan tidak kembali',
    };
  }
  return {
    status: 'AVAILABLE',
    event: 'RELEASED',
    hitungSiklus: true,
    alasan: 'kartu internal dilepas saat truk berangkat dan kembali ke peredaran',
  };
}

/**
 * Qty per kanban: penomoran customer boleh menimpa standar part.
 * TMMIN dan Dowa bisa memakai kelipatan berbeda untuk part yang sama.
 */
export function resolveQtyPerKanban(
  partQtyPerKanban: number | null | undefined,
  customerQtyPerKanban?: number | null,
): number {
  const qty = customerQtyPerKanban ?? partQtyPerKanban;
  if (qty === null || qty === undefined) {
    throw new Error('qty_per_kanban belum diset pada part maupun mapping customer');
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`qty_per_kanban tidak valid: ${qty}`);
  }
  return qty;
}

/** Jumlah kanban penuh yang dibutuhkan untuk sejumlah pcs (sisa dibulatkan ke atas). */
export function kanbanCountFor(totalPcs: number, qtyPerKanban: number): number {
  if (totalPcs < 0) throw new Error('totalPcs tidak boleh negatif');
  return Math.ceil(totalPcs / resolveQtyPerKanban(qtyPerKanban));
}
