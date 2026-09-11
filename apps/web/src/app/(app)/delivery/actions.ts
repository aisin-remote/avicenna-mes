'use server';

import { revalidatePath } from 'next/cache';
import type { LoadingPhase, LoadingScanResult } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';
import type { CatalogPart } from '@/lib/loading-api';

function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const body = err.body as { details?: Array<{ message: string }> } | undefined;
    if (body?.details?.length) return body.details.map((d) => d.message).join(', ');
    return err.message;
  }
  return 'Tidak bisa menghubungi server.';
}

/** Part yang bisa dimuat untuk sebuah customer. */
export async function catalogAction(
  customerId: number,
  plantId?: number,
): Promise<CatalogPart[] | { error: string }> {
  try {
    const qs = new URLSearchParams({ customerId: String(customerId) });
    if (plantId) qs.set('plantId', String(plantId));
    return await apiFetch<CatalogPart[]>(`/loading/catalog?${qs.toString()}`);
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export interface SubmitLoadingInput {
  plantId: number;
  customerId: number;
  pdsNumber?: string;
  cycle: number;
  dock?: string;
  locationId?: number;
  stagingLocationId?: number;
  deliveryDate: string;
  truckNumber?: string;
  driverName?: string;
  lines: Array<{
    partId: number;
    customerPartId?: number;
    plannedKanban: number;
    qtyPerKanban: number;
  }>;
}

export async function submitLoadingAction(
  input: SubmitLoadingInput,
): Promise<{ id: number; documentNumber: string } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; documentNumber: string }>('/loading', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/delivery');
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

/** Scan satu kanban — saat pulling maupun saat muat. */
export async function scanKanbanAction(input: {
  deliveryId: number;
  phase: LoadingPhase;
  customerPart: string;
  internalPart?: string;
  serialNumber?: string;
  clientRef?: string;
}): Promise<LoadingScanResult | { error: string }> {
  try {
    return await apiFetch<LoadingScanResult>('/loading/scan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return { error: toMessage(err) };
  }
}

interface UndoResult {
  lineId: number;
  actualKanban: number;
  totals: { plannedKanban: number; pickedKanban: number; actualKanban: number };
}

export async function undoKanbanAction(
  deliveryId: number,
  lineId: number,
  phase: LoadingPhase,
): Promise<UndoResult | { error: string }> {
  try {
    return await apiFetch<UndoResult>(
      `/loading/${deliveryId}/lines/${lineId}/undo?phase=${phase}`,
      { method: 'POST' },
    );
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export interface PickResult {
  id: number;
  documentNumber: string;
  pickedLines: number;
  shortages: ShipResult['shortages'];
}

/** Menutup pulling: barang berpindah dari gudang finish good ke staging. */
export async function completePickingAction(
  id: number,
): Promise<PickResult | { error: string }> {
  try {
    const res = await apiFetch<PickResult>(`/loading/${id}/pick`, { method: 'POST' });
    revalidatePath('/delivery');
    revalidatePath(`/delivery/${id}`);
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export interface ShipResult {
  id: number;
  documentNumber: string;
  shippedLines: number;
  shortages: Array<{
    partId: number;
    partNumber: string;
    needed: number;
    available: number;
    short: number;
  }>;
}

export async function shipLoadingAction(id: number): Promise<ShipResult | { error: string }> {
  try {
    const res = await apiFetch<ShipResult>(`/loading/${id}/ship`, { method: 'POST' });
    revalidatePath('/delivery');
    revalidatePath(`/delivery/${id}`);
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function setTruckStatusAction(
  id: number,
  truckStatus: 'PENDING' | 'ARRIVED' | 'LOADING' | 'DEPARTED',
): Promise<{ id: number; truckStatus: string } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; truckStatus: string }>(`/loading/${id}/truck`, {
      method: 'PATCH',
      body: JSON.stringify({ truckStatus }),
    });
    revalidatePath(`/delivery/${id}`);
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function cancelLoadingAction(
  id: number,
): Promise<{ id: number; status: string } | { error: string }> {
  try {
    const res = await apiFetch<{ id: number; status: string }>(`/loading/${id}/cancel`, {
      method: 'POST',
    });
    revalidatePath('/delivery');
    revalidatePath(`/delivery/${id}`);
    return res;
  } catch (err) {
    return { error: toMessage(err) };
  }
}
