import { z } from 'zod';
import { processTypeSchema, type ScanMode } from './common';

export const scanKindSchema = z.enum([
  'PRODUCTION',
  'PULLING',
  'DELIVERY',
  'RECEIVING',
  'INSPECTION',
  'STOCK_TAKE',
]);
export type ScanKind = z.infer<typeof scanKindSchema>;

/**
 * Payload satu scan dari lapangan.
 *
 * `clientRef` diisi oleh device (mis. uuid lokal). Dipakai membentuk kunci
 * idempoten supaya kiriman ulang saat jaringan pabrik putus-nyambung tidak
 * menghasilkan data dobel — masalah yang sering terjadi di sistem lama.
 */
export const scanInputSchema = z.object({
  kind: scanKindSchema,
  processType: processTypeSchema.optional(),
  rawCode: z.string().trim().min(1, 'Barcode kosong').max(255),
  /**
   * Barcode kanban, dikirim BERSAMA barcode part dalam satu permintaan.
   *
   * Wajib di lini finish good, tidak boleh di lini WIP. Dikirim bersama, bukan
   * sebagai langkah kedua yang terpisah: operator yang berpindah sebelum scan
   * kedua akan meninggalkan unit tanpa kanban, dan tidak ada yang tahu sampai
   * barang itu gagal dikirim.
   */
  kanbanCode: z.string().trim().max(255).optional(),
  lineCode: z.string().trim().max(32).optional(),
  machineCode: z.string().trim().max(32).optional(),
  qty: z.coerce.number().int().min(1).default(1),
  npk: z.string().trim().max(32).optional(),
  scannedAt: z.coerce.date().optional(),
  clientRef: z.string().trim().max(64).optional(),
  meta: z.record(z.unknown()).optional(),
});
export type ScanInput = z.infer<typeof scanInputSchema>;

/** Pengiriman batch — device offline mengirim antreannya sekaligus saat online. */
export const scanBatchSchema = z.object({
  scans: z.array(scanInputSchema).min(1).max(500),
});
export type ScanBatchInput = z.infer<typeof scanBatchSchema>;

export const scanResultSchema = z.object({
  accepted: z.number(),
  duplicated: z.number(),
  rejected: z.array(z.object({ index: z.number(), reason: z.string() })),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

/**
 * Hasil satu scan dari layar stasiun operator.
 *
 * Berbeda dari ScanResult yang meringkas satu batch dari device, bentuk ini
 * memuat semua yang dibutuhkan layar dalam satu jawaban: status untuk memilih
 * warna, pesan untuk ditampilkan besar, identitas part sebagai konfirmasi
 * visual, dan penghitung hari ini agar tidak perlu request kedua.
 */
export const stationStatusSchema = z.enum(['ACCEPTED', 'DUPLICATE', 'REJECTED']);
export type StationStatus = z.infer<typeof stationStatusSchema>;

export const stationResultSchema = z.object({
  status: stationStatusSchema,
  reason: z.string().optional(),
  message: z.string(),
  rawCode: z.string(),
  partNumber: z.string().nullable(),
  partName: z.string().nullable(),
  qty: z.number(),
  /** Seri yang tercatat: seri barang (per barang) atau seri kanban (per kanban). */
  serialNumber: z.string().nullable(),
  /**
   * Isi satu kanban menurut master part — layar FG menahan sebanyak ini
   * sebelum meminta kartu. Hanya terisi pada ACCEPTED.
   */
  qtyPerKanban: z.number().nullable().optional(),
  /** Pemilik kartu yang ditempel: INTERNAL, atau CUSTOMER untuk direct kanban. */
  kanbanOwner: z.enum(['INTERNAL', 'CUSTOMER']).nullable().optional(),
  /**
   * Loading list yang ditunjuk label DN — direct pulling di lini FG.
   *
   * Terisi bila kartunya label DN. Layar menampilkannya sebagai "detail
   * loading list": tiap part, berapa box sudah diambil dari berapa rencana —
   * padanan tabel Part Number / Progress / Total di layar D98E lama.
   */
  loadingList: z
    .object({
      deliveryId: z.number(),
      documentNumber: z.string(),
      pdsNumber: z.string().nullable(),
      customerName: z.string().nullable(),
      status: z.string(),
      items: z.array(
        z.object({
          partNumber: z.string().nullable(),
          backNumber: z.string().nullable(),
          customerPartNumber: z.string().nullable(),
          pickedKanban: z.number(),
          plannedKanban: z.number(),
          qtyPerKanban: z.number(),
        }),
      ),
    })
    .nullable()
    .optional(),
  /** Jumlah scan hari produksi ini di lini ini. */
  counterToday: z.number(),
  /** Jumlah pcs hari produksi ini — berbeda dari counterToday di lini per-kanban. */
  pcsToday: z.number(),
  scannedAt: z.string(),
});
export type StationResult = z.infer<typeof stationResultSchema>;

export interface StationSummary {
  line: {
    code: string;
    name: string;
    processType: string;
    plantCode: string | null;
    plantName: string | null;
    /** PER_PIECE: scan part per barang. PER_KANBAN: master sample lalu kanban per box. */
    scanMode: ScanMode;
  };
  counterToday: number;
  pcsToday: number;
  recent: Array<{
    id: number;
    kind: string;
    rawCode: string;
    serialNumber: string | null;
    qty: number;
    scannedAt: string | Date;
    partNumber: string | null;
    partName: string | null;
  }>;
}

/**
 * Hasil pemeriksaan master sample di lini per-kanban (GET /scan/sample).
 *
 * Layar menyimpan ini sepanjang shift dan mengirim partNumber-nya sebagai
 * rawCode pada setiap scan kanban. Kalau sample-nya salah, semua scan sesudahnya
 * salah — karena itu pemeriksaannya di server, bukan sekadar "ada di master".
 */
export interface SampleCheck {
  partId: number;
  partNumber: string;
  backNumber: string | null;
  partName: string;
  qtyPerKanban: number | null;
  /** false = part ini belum punya rute sama sekali, jadi lininya tidak bisa diperiksa. */
  ruteDiperiksa: boolean;
}
