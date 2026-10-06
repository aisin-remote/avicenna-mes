import 'server-only';
import { apiFetch } from './api';
import type { ReceiptSummary, ReceivingSession } from '@avicenna/contracts';

export interface ReceiptListResult {
  data: ReceiptSummary[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function listReceipts(page = 1, perPage = 25, status = 'ALL'): Promise<ReceiptListResult> {
  return apiFetch<ReceiptListResult>(
    `/receiving?page=${page}&perPage=${perPage}&status=${encodeURIComponent(status)}`,
  );
}

export interface ReceiptDetail {
  id: number;
  documentNumber: string;
  supplierDocNumber: string | null;
  supplierName: string | null;
  receivedAt: string;
  status: string;
  aresOrderId: number | null;
  note: string | null;
  lines: Array<{
    id: number;
    partId: number;
    partNumber: string | null;
    partName: string | null;
    trackingMode: string | null;
    qty: string;
    uom: string;
    lotNumber: string | null;
    supplierLotNumber: string | null;
  }>;
}

export function getReceipt(id: number): Promise<ReceiptDetail> {
  return apiFetch<ReceiptDetail>(`/receiving/${id}`);
}

export function getReceivingSession(id: number): Promise<ReceivingSession> {
  return apiFetch<ReceivingSession>(`/receiving/${id}/session`);
}
