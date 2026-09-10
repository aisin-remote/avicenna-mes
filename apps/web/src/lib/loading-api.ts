import 'server-only';
import { apiFetch } from './api';
import type { LoadingSummary } from '@avicenna/contracts';

export interface LoadingListResult {
  data: LoadingSummary[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function listLoadings(page = 1, perPage = 25): Promise<LoadingListResult> {
  return apiFetch<LoadingListResult>(`/loading?page=${page}&perPage=${perPage}`);
}

export interface LoadingLineDetail {
  id: number;
  partId: number;
  partNumber: string | null;
  partName: string | null;
  uom: string | null;
  customerPartNumber: string | null;
  plannedKanban: number;
  actualKanban: number;
  qtyPerKanban: number;
  plannedQty: number;
  actualQty: number;
}

export interface LoadingDetail {
  id: number;
  documentNumber: string;
  pdsNumber: string | null;
  plantId: number;
  customerId: number;
  customerName: string | null;
  customerCode: string | null;
  partNumberFormat: string | null;
  deliveryDate: string;
  cycle: number;
  dock: string | null;
  locationId: number | null;
  locationName: string | null;
  status: string;
  truckStatus: string;
  truckNumber: string | null;
  driverName: string | null;
  departedAt: string | null;
  lines: LoadingLineDetail[];
}

export function getLoading(id: number): Promise<LoadingDetail> {
  return apiFetch<LoadingDetail>(`/loading/${id}`);
}

export interface CatalogPart {
  partId: number;
  partNumber: string;
  partName: string;
  plantId: number;
  uom: string;
  customerPartId: number | null;
  customerPartNumber: string | null;
  qtyPerKanban: number;
}

export function getCustomerCatalog(customerId: number, plantId?: number): Promise<CatalogPart[]> {
  const qs = new URLSearchParams({ customerId: String(customerId) });
  if (plantId) qs.set('plantId', String(plantId));
  return apiFetch<CatalogPart[]>(`/loading/catalog?${qs.toString()}`);
}
