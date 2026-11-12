/**
 * ─── TRACEABILITY ────────────────────────────────────────────────────────────
 *
 * Dua pintu penelusuran (menu Traceability, Handika 12 Nov 2026):
 *
 *   Trace Part     dari QR unit (atau nomor/back number part): unit ini lewat
 *                  proses mana saja, kapan, oleh siapa, masuk kanban apa,
 *                  memakai komponen apa, dan sudah terkirim ke SAP atau belum.
 *   Trace Kanban   dari isi QR kartu (atau back number + seri): kartu ini
 *                  sedang berisi apa, pernah berisi apa, dan riwayat siklusnya.
 *
 * Hanya MEMBACA. Tidak ada yang diubah dari layar ini.
 */

/** Ringkasan kiriman SAP untuk satu scan. */
export interface TraceSap {
  docType: string;
  status: string;
  movementType: string | null;
  sapDocNumber: string | null;
  stagingNumber: number | null;
  lastError: string | null;
  sentAt: string | null;
  confirmedAt: string | null;
}

export interface TracePartRingkas {
  id: number;
  partNumber: string;
  backNumber: string | null;
  name: string | null;
  plantCode: string | null;
  partType: string | null;
  trackingMode: string | null;
}

/** Satu langkah proses yang dilalui unit — satu baris riwayat scan. */
export interface TraceLangkah {
  scanId: number;
  waktu: string;
  kind: string;
  processType: string | null;
  lineCode: string | null;
  lineName: string | null;
  part: TracePartRingkas | null;
  rawCode: string;
  qty: number;
  npk: string | null;
  userName: string | null;
  scanMode: string | null;
  kanbanSerial: string | null;
  sap: TraceSap[];
}

/** Komponen yang terpotong (backflush) atau tercatat di silsilah unit. */
export interface TraceKomponen {
  sumber: 'BACKFLUSH' | 'SILSILAH';
  scanId: number | null;
  lineCode: string | null;
  part: TracePartRingkas | null;
  qty: number;
  serialKomponen: string | null;
  lotNumber: string | null;
  waktu: string;
}

/** Kartu kanban yang pernah atau sedang membawa unit ini. */
export interface TraceKanbanUnit {
  kanbanId: number | null;
  part: TracePartRingkas | null;
  serial: string;
  /** true bila unit masih menempel di kartu (box belum dilepas). */
  masihTerpasang: boolean;
  waktu: string;
  lineCode: string | null;
}

/** Uraian QR 15 digit (lihat uraiQrUnit di @avicenna/domain). */
export interface TraceQrUnit {
  program: string;
  die: string;
  line: string;
  tahun: number | null;
  bulan: number | null;
  tanggal: number | null;
  tanggalProduksi: string | null;
  shift: string | null;
  shot: number | null;
  ruasTidakSah: string[];
  /** FG yang ditunjuk program number ini, bila terdaftar. */
  fg: TracePartRingkas | null;
}

/** Satu scan dalam daftar per part. */
export interface TraceScanPart {
  scanId: number;
  partId: number | null;
  waktu: string;
  kind: string;
  lineCode: string | null;
  serial: string | null;
  qty: number;
  npk: string | null;
  kanbanSerial: string | null;
}

export type HasilTracePart =
  | { jenis: 'KOSONG' }
  | { jenis: 'TIDAK_DITEMUKAN'; q: string }
  | {
      jenis: 'UNIT';
      q: string;
      serial: string;
      qr: TraceQrUnit | null;
      langkah: TraceLangkah[];
      kanban: TraceKanbanUnit[];
      komponen: TraceKomponen[];
    }
  | {
      jenis: 'PART';
      q: string;
      part: TracePartRingkas[];
      scan: TraceScanPart[];
      /** true bila daftar scan dipotong di batasnya. */
      terpotong: boolean;
    };

export interface TraceKanbanRingkas {
  id: number;
  plantCode: string | null;
  part: TracePartRingkas | null;
  serial: string;
  kanbanType: string;
  owner: string;
  status: string;
  qtyPerBox: number;
  cycleCount: number;
  isiSekarang: number;
  producedAt: string | null;
  deliveredAt: string | null;
  releasedAt: string | null;
  isActive: boolean;
}

export interface TraceKanbanIsi {
  serial: string;
  attachedAt: string;
  scanId: number | null;
  lineCode: string | null;
}

export interface TraceKanbanScan {
  scanId: number;
  waktu: string;
  serial: string | null;
  lineCode: string | null;
  qty: number;
  npk: string | null;
}

export interface TraceKanbanEvent {
  type: string;
  waktu: string;
  lineCode: string | null;
  qty: number | null;
  pasangan: string | null;
  npk: string | null;
}

export interface TraceKanbanDelivery {
  deliveryId: number;
  documentNumber: string;
  qty: number;
  releasedAt: string | null;
}

export interface TraceKanbanDetail extends TraceKanbanRingkas {
  isi: TraceKanbanIsi[];
  riwayatScan: TraceKanbanScan[];
  event: TraceKanbanEvent[];
  delivery: TraceKanbanDelivery[];
}

export type HasilTraceKanban =
  | { jenis: 'KOSONG' }
  | { jenis: 'TIDAK_DITEMUKAN'; q: string; alasan: string }
  | { jenis: 'KARTU'; q: string; kartu: TraceKanbanDetail[] }
  | { jenis: 'DAFTAR'; q: string; part: TracePartRingkas[]; kartu: TraceKanbanRingkas[] };
