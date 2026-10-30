import { z } from 'zod';
import { MAKS_UKURAN_FOTO } from './master/import';

export const driverAttendanceStartSchema = z.object({
  plantId: z.coerce.number().int().positive(),
  slot: z.union([z.literal(1), z.literal(2)]),
  destinationId: z.coerce.number().int().positive(),
  cycle: z.coerce.number().int().min(1).max(10),
  helmet: z.literal(true, { errorMap: () => ({ message: 'Helm safety wajib dipakai.' }) }),
  vest: z.literal(true, { errorMap: () => ({ message: 'Rompi safety wajib dipakai.' }) }),
  shoes: z.literal(true, { errorMap: () => ({ message: 'Sepatu safety wajib dipakai.' }) }),
  photo: z
    .string()
    .max(Math.ceil(MAKS_UKURAN_FOTO / 3) * 4 + 64)
    .regex(
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/,
      'Ambil foto driver terlebih dulu.',
    ),
  orderIds: z
    .array(z.number().int().positive())
    .min(1, 'Scan minimal satu DO.')
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'DO tidak boleh didaftarkan dua kali.'),
});
export type DriverAttendanceStart = z.infer<typeof driverAttendanceStartSchema>;
export interface DriverDestination {
  id: number;
  customerId: number;
  name: string;
  dock: string;
  logistic: string;
}
export interface DriverAttendanceOrder {
  id: number;
  number: string | null;
  pdsNumber: string;
  customerName: string;
  shippedAt: string | null;
  driverScannedAt: string | null;
}
export interface DriverAttendanceRow {
  id: number;
  plantId: number;
  slot: number;
  destinationName: string;
  dock: string;
  logistic: string;
  cycle: number;
  helmet: boolean;
  vest: boolean;
  shoes: boolean;
  startedAt: string;
  endedAt: string | null;
  orders: DriverAttendanceOrder[];
}
export interface DriverAttendanceBoard {
  plantId: number;
  plants: Array<{ id: number; name: string }>;
  destinations: DriverDestination[];
  active: DriverAttendanceRow[];
}
export interface DriverAttendanceHistory {
  data: DriverAttendanceRow[];
  total: number;
  page: number;
  perPage: number;
}
