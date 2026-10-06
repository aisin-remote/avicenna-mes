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
  sapItemNumber: string | null;
  partId: number;
  partNumber: string | null;
  partName: string | null;
  uom: string | null;
  customerPartNumber: string | null;
  customerPartId: number | null;
  plannedKanban: number;
  pickedKanban: number;
  actualKanban: number;
  qtyPerKanban: number;
  plannedQty: number;
  sapDeliveryQty: number;
  itemType: string | null;
  pickedQty: number;
  actualQty: number;
}

export interface LoadingDetail {
  id: number;
  documentNumber: string;
  manifestNumber: string | null;
  pdsNumber: string | null;
  purchaseOrderNumber: string | null;
  salesOrganization: string | null;
  distributionChannel: string | null;
  division: string | null;
  deliveryType: string | null;
  sapGiStatus: string | null;
  invoiceNumber: string | null;
  qcStatus: string | null;
  sapActualDeliveryDate: string | null;
  sapHeaderMovementStatus: string | null;
  sapLineMovementStatus: string | null;
  sapReceiveStatus: string | null;
  sapReceiveDate: string | null;
  sapReceiveTime: string | null;
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
  arrivedAt: string | null;
  sapStatus: string | null;
  sapIsSimulation: boolean | null;
  sapDocNumber: string | null;
  sapError: string | null;
  lines: LoadingLineDetail[];
}

export function getLoading(id: number): Promise<LoadingDetail> {
  return apiFetch<LoadingDetail>(`/loading/${id}`);
}

export interface DeliverySyncStatus {
  syncedAt: string;
  result: { dibaca: number; baru: number; diperbarui: number; dilewati: number; catatan: string[] };
}
export async function getDeliverySyncStatus(date: string): Promise<DeliverySyncStatus | null> {
  const { data } = await apiFetch<{ data: DeliverySyncStatus | null }>(
    `/loading/sync-status?date=${date}`,
  );
  return data;
}

export interface LoadingHistory {
  scans: Array<{
    id: number;
    at: string;
    rawCode: string;
    serialNumber: string | null;
    qty: number;
    user: string | null;
    meta: { action?: string; phase?: string; reason?: string; deliveryLineId?: number } | null;
  }>;
  movements: Array<{
    id: number;
    at: string;
    type: string;
    qty: string;
    note: string | null;
    user: string | null;
    partNumber: string | null;
    location: string | null;
  }>;
}
export function getLoadingHistory(id: number): Promise<LoadingHistory> {
  return apiFetch(`/loading/${id}/history`);
}
