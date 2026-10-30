import { z } from 'zod';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Jam harus HH:mm');
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Tanggal tidak valid');

export const preparationFilterSchema = z
  .object({
    from: date,
    to: date,
    customerId: z.coerce.number().int().positive().optional(),
    cycle: z.coerce.number().int().positive().max(9999).optional(),
    q: z.string().trim().max(128).default(''),
    status: z.enum(['ALL', 'INCOMPLETE', 'COMPLETE', 'LATE']).default('ALL'),
  })
  .refine((v) => {
    const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
    return days >= 0 && days <= 30;
  }, 'Rentang tanggal maksimal 31 hari dan tanggal akhir tidak boleh sebelum awal');
export type PreparationFilter = z.infer<typeof preparationFilterSchema>;

export const preparationScheduleSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  destination: z.string().trim().max(32).default(''),
  gate: z.string().trim().max(32).default(''),
  cycle: z.coerce.number().int().positive().max(9999),
  preparationStart: clock,
  preparationEnd: clock,
  dayOffset: z.coerce.number().int().min(-14).max(14).default(0),
  truckTime: clock.nullable().default(null),
  isActive: z.boolean().default(true),
});
export type PreparationScheduleInput = z.infer<typeof preparationScheduleSchema>;

export interface PreparationSchedule {
  id: number;
  customerId: number;
  customerName: string;
  destination: string;
  gate: string;
  cycle: number;
  preparationStart: string | null;
  preparationEnd: string | null;
  dayOffset: number;
  truckTime: string | null;
  sapPickTime: string | null;
  sapLoadingTime: string | null;
  sapDeliveryTime: string | null;
  syncedAt: string | null;
  isActive: boolean;
}

export type PreparationStatus =
  | 'NO_PLAN'
  | 'UNCONFIGURED'
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'OVERDUE'
  | 'COMPLETE_LATE'
  | 'COMPLETE_UNTIMED';

export interface PreparationDocument {
  id: number;
  plantId: number;
  plantCode: string;
  customerId: number;
  customerName: string;
  customerCode: string;
  documentNumber: string;
  manifestNumber: string | null;
  pdsNumber: string | null;
  deliveryDate: string;
  cycle: number;
  destination: string;
  status: string;
  truckStatus: string;
  truckPickedAt: string | null;
  lineCount: number;
  plannedKanban: number;
  pickedKanban: number;
  missingKanban: number;
  invalidLines: number;
  loadedKanban: number;
  plannedQty: number;
  pickedQty: number;
  latestPullingAt: string | null;
}

export interface PreparationGroup {
  key: string;
  plantId: number;
  plantCode: string;
  customerId: number;
  customerName: string;
  deliveryDate: string;
  cycle: number;
  destination: string;
  pdsNumbers: string[];
  documents: PreparationDocument[];
  plannedKanban: number;
  pickedKanban: number;
  missingKanban: number;
  loadedKanban: number;
  progress: number;
  completed: boolean;
  status: PreparationStatus;
  preparationStartAt: string | null;
  deadlineAt: string | null;
  truckEtaAt: string | null;
  latestPullingAt: string | null;
  scheduleIssue: string | null;
}

export interface PreparationSnapshot {
  filters: PreparationFilter;
  asOf: string;
  pdsGroups: PreparationGroup[];
  cycleGroups: PreparationGroup[];
  customers: Array<{ id: number; name: string }>;
  schedules: PreparationSchedule[];
  source: { configured: boolean; readOnly: true; message: string };
  syncs: Array<{ date: string; syncedAt: string; result: unknown }>;
}

export interface PreparationScan {
  id: number;
  lineId: number;
  partId: number;
  at: string;
  qty: number;
  serial: string | null;
  customerSerial: string | null;
  internalSerial: string | null;
  producedAt: string | null;
  action: string | null;
  phase: string;
}

export interface PreparationLine {
  id: number;
  partId: number;
  partNumber: string;
  backNumber: string | null;
  name: string;
  customerPartNumber: string | null;
  customerBackNumber: string | null;
  plannedKanban: number;
  pickedKanban: number;
  loadedKanban: number;
  qtyPerKanban: number;
  plannedQty: number;
  pickedQty: number;
}

export interface PreparationDetail {
  document: PreparationDocument;
  group: PreparationGroup;
  lines: PreparationLine[];
  scans: PreparationScan[];
  historyTruncated: boolean;
}
