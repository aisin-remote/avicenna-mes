import { z } from 'zod';

const code = z.string().trim().min(1, 'Barcode wajib diisi').max(64);
export const receivingOpenSchema = z.object({
  code,
  locationId: z.coerce.number().int().positive(),
});
export const receivingScanSchema = z.object({ code, clientRef: z.string().uuid() });
export const receivingCloseSchema = z.object({ reason: z.string().trim().max(255).optional() });
export const receivingCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(255),
});

export interface AresOrderSource {
  id: number;
  orderNumber: string;
  revision: number;
  plantCode: string;
  supplierCode: string | null;
  supplierName: string;
  status: string;
  deliveryDate: string;
  arrivalTime: string;
  cycle: number;
  lines: Array<{
    id: number;
    vendorPartId: number;
    partNumber: string;
    materialNumber: string;
    partName: string;
    backNumber: string;
    uom: string;
    qtyPerBox: number;
    boxOrdered: number;
    boxShipped: number | null;
    poNumber: string;
    poItem: string;
    partId?: number;
    trackingMode?: string;
  }>;
  kanbans: Array<{
    id: string;
    lineId: number;
    serial: number;
    status: string;
    revision: number;
  }>;
}

export interface ReceivingSession {
  id: number;
  documentNumber: string;
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED';
  orderNumber: string;
  revision: number;
  supplierName: string;
  plantCode: string;
  locationName: string;
  deliveryDate: string;
  arrivalTime: string;
  cycle: number;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  lines: Array<AresOrderSource['lines'][number] & { boxScanned: number; pcsReceived: number }>;
  totals: { boxOrdered: number; boxScanned: number; pcsReceived: number; missing: number };
  history: Array<{
    id: number;
    code: string;
    result: string;
    message: string;
    at: string;
    userName: string | null;
  }>;
}

export interface ReceivingScanOutcome {
  result: 'OK' | 'DUPLICATE' | 'REJECTED';
  message: string;
  autoShipped: boolean;
  kanbanSerial: number | null;
  line: { id: number; boxScanned: number } | null;
  clientRef: string;
}
