import 'server-only';
import { apiFetch } from './api';
import type { TransferSummary, StockAvailability } from '@avicenna/contracts';

export interface TransferListResult {
  data: TransferSummary[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function listTransfers(page = 1, perPage = 25): Promise<TransferListResult> {
  return apiFetch<TransferListResult>(`/transfer?page=${page}&perPage=${perPage}`);
}

export interface TransferDetail {
  id: number;
  documentNumber: string;
  fromName: string | null;
  toName: string | null;
  movedAt: string;
  status: string;
  note: string | null;
  lines: Array<{
    id: number;
    partNumber: string | null;
    partName: string | null;
    uom: string | null;
    qty: string;
    serialNumber: string | null;
    lotNumber: string | null;
  }>;
}

export function getTransfer(id: number): Promise<TransferDetail> {
  return apiFetch<TransferDetail>(`/transfer/${id}`);
}

export type { StockAvailability };
