import 'server-only';
import { apiFetch } from './api';
import type { LoadingSummary } from '@avicenna/contracts';

export interface LoadingListResult {
  data: LoadingSummary[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    operationalDate: string;
    attention?: number;
    allTotal?: number;
  };
}

export function listLoadings(
  page = 1,
  perPage = 25,
  operationalDate?: string,
  attention?: 'all' | 'only',
): Promise<LoadingListResult> {
  const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (operationalDate) qs.set('date', operationalDate);
  if (attention) qs.set('attention', attention);
  return apiFetch<LoadingListResult>(`/loading?${qs.toString()}`);
}

/** Registry lintas hari untuk Mutation Delivery. */
export function listLoadingMutations(
  page = 1,
  perPage = 25,
  filters: { date?: string; query?: string } = {},
): Promise<LoadingListResult> {
  const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (filters.date) qs.set('date', filters.date);
  else qs.set('all', '1');
  if (filters.query) qs.set('q', filters.query);
  return apiFetch<LoadingListResult>(`/loading?${qs.toString()}`);
}

export interface LoadingLineDetail {
  id: number;
  partId: number;
  partNumber: string | null;
  partName: string | null;
  uom: string | null;
  customerPartNumber: string | null;
  plannedKanban: number;
  pickedKanban: number;
  actualKanban: number;
  qtyPerKanban: number;
  plannedQty: number;
  pickedQty: number;
  actualQty: number;
}

export interface LoadingDetail {
  id: number;
  documentNumber: string;
  manifestNumber: string | null;
  pdsNumber: string | null;
  plantId: number;
  customerId: number;
  customerName: string | null;
  customerCode: string | null;
  partNumberFormat: string | null;
  loadingMode: 'TIGA_ARAH' | 'KANBAN_CUSTOMER' | 'TANPA_SCAN';
  deliveryDate: string;
  cycle: number;
  dock: string | null;
  locationId: number | null;
  locationName: string | null;
  locationCode: string | null;
  stagingLocationId: number | null;
  stagingLocationName: string | null;
  stagingLocationCode: string | null;
  status: string;
  truckStatus: string;
  truckNumber: string | null;
  driverName: string | null;
  departedAt: string | null;
  sapStatus: string | null;
  sapDocNumber: string | null;
  sapError: string | null;
  lines: LoadingLineDetail[];
}

export function getLoading(id: number): Promise<LoadingDetail> {
  return apiFetch<LoadingDetail>(`/loading/${id}`);
}
