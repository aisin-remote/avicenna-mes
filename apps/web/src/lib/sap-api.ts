import 'server-only';
import { apiFetch } from './api';

export interface SapSummary {
  pending: number;
  sent: number;
  failed: number;
  held: number;
  skipped: number;
  /** Apakah pengiriman ke MS SQL sudah dinyalakan. */
  pengirimanAktif: boolean;
}

export interface SapOutboxRow {
  id: number;
  plantCode: string | null;
  docType: string;
  movementType: string | null;
  sourceTable: string;
  sourceId: number;
  status: string;
  attempts: number;
  lastError: string | null;
  sapDocNumber: string | null;
  occurredAt: string;
  sentAt: string | null;
}

export interface SapOutboxList {
  data: SapOutboxRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function getSapSummary(): Promise<SapSummary> {
  return apiFetch<SapSummary>('/sap/summary');
}

export function listSapOutbox(page = 1, perPage = 25, status = 'ALL'): Promise<SapOutboxList> {
  return apiFetch<SapOutboxList>(`/sap/outbox?page=${page}&perPage=${perPage}&status=${status}`);
}
