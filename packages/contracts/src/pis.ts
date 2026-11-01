import { z } from 'zod';

export const PIS_MODES = ['OEM', 'DANDORY'] as const;
export const PIS_DOCKS = [
  'TMMIN SPD',
  'TMMIN SPD-ADM',
  'TMMIN-PBOD',
  '43',
  '53',
  '1L',
  '1N',
  'HINO-SPD',
  'SIM-SPD',
  'TAM-SPD',
  'MMKI',
  'MMKI-SPD',
  'MMKI-Fujitrans',
  'MMKI-Senopati',
  'MMKI-MMO',
  '6I',
  'TAM-ADM',
  'TAM-HINO',
  'ADM-AS',
  'ADM-KP',
  'YHA',
  'ADM',
  'TTI',
] as const;
export type PisMode = (typeof PIS_MODES)[number];
export const pisPlantSchema = z
  .object({ plantId: z.coerce.number().int().positive().optional() })
  .strict();
const plantId = z.number().int().positive();
export const pisScanSchema = z
  .object({
    plantId,
    code: z.string().trim().min(1).max(2048),
    clientRef: z.string().trim().min(1).max(64),
  })
  .strict();
export const pisConfirmSchema = z.object({ plantId, pendingId: z.string().uuid() }).strict();
export const pisContextSchema = z
  .object({ plantId, mode: z.enum(PIS_MODES), dock: z.enum(PIS_DOCKS) })
  .strict();
export const pisResetSchema = z.object({ plantId }).strict();
export const pisUnlockSchema = z
  .object({ plantId, npk: z.string().trim().min(1).max(32) })
  .strict();
export type PisScanInput = z.infer<typeof pisScanSchema>;
export type PisConfirmInput = z.infer<typeof pisConfirmSchema>;
export type PisContextInput = z.infer<typeof pisContextSchema>;
export type PisUnlockInput = z.infer<typeof pisUnlockSchema>;

export interface PisLine {
  id: number;
  partId: number;
  partNumber: string;
  customerPartNumber: string | null;
  partName: string;
  qtyPerKanban: number;
  targetQty: number;
  packedQty: number;
  remainingQty: number;
}
export interface PisDocument {
  id: number;
  documentNumber: string;
  manifestNumber: string | null;
  pdsNumber: string | null;
  customerName: string | null;
  deliveryDate: string;
  cycle: number;
  lines: PisLine[];
}
/** Suara khusus seperti stasiun lama; tanpa ini layar memilih dari status (ok / notMatch / LLSelesai). */
export type PisSound = 'LABEL_INVALID' | 'PDS_DIFFERENT' | 'MOVE_KANBAN';
export interface PisMessage {
  status: 'READY' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'COMPLETE';
  text: string;
  sound?: PisSound;
}
export interface PisBoard {
  plantId: number;
  plants: Array<{ id: number; code: string; name: string }>;
  mode: PisMode;
  dock: string;
  stage: 'DOCUMENT' | 'KANBAN' | 'LABEL';
  documents: PisDocument[];
  activeKanban: { code: string; partNumber: string; lineId: number } | null;
  pending: {
    id: string;
    deliveryId: number;
    lineId: number;
    label: string;
    partNumber: string;
    customerPartNumber: string | null;
    previewUrl: string;
    createdAt: string;
  } | null;
  interlock: { id: string; reason: string; expected: string; scanned: string } | null;
  cooldownUntil: string | null;
  dailyCount: number;
  message: PisMessage;
  complete: boolean;
}
