/**
 * Mesin status kanban.
 *
 * Di sistem lama, perpindahan status tersebar di banyak controller sehingga
 * kanban bisa "loncat" ke status yang tidak masuk akal (mis. DELIVERED tanpa
 * pernah PRODUCED). Di sini transisinya dideklarasikan satu tempat dan diuji.
 */

export type KanbanStatus =
  | 'CREATED'
  | 'PRODUCED'
  | 'STORED'
  | 'PULLED'
  | 'LOADED'
  | 'DELIVERED'
  | 'CANCELLED';

export type KanbanEventType =
  | 'PRODUCED'
  | 'PULLED'
  | 'PAIRED'
  | 'STORED'
  | 'LOADED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ADJUSTED';

/** Status tujuan yang sah untuk tiap kombinasi (status sekarang, event). */
const TRANSITIONS: Record<KanbanStatus, Partial<Record<KanbanEventType, KanbanStatus>>> = {
  CREATED: { PRODUCED: 'PRODUCED', CANCELLED: 'CANCELLED' },
  PRODUCED: { STORED: 'STORED', PULLED: 'PULLED', PAIRED: 'PRODUCED', CANCELLED: 'CANCELLED' },
  STORED: { PULLED: 'PULLED', PAIRED: 'STORED', CANCELLED: 'CANCELLED' },
  PULLED: { LOADED: 'LOADED', STORED: 'STORED', PAIRED: 'PULLED', CANCELLED: 'CANCELLED' },
  LOADED: { DELIVERED: 'DELIVERED', PULLED: 'PULLED', CANCELLED: 'CANCELLED' },
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
