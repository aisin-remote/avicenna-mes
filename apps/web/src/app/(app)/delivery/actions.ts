'use server';

import { revalidatePath } from 'next/cache';
import type { LoadingPhase, LoadingScanResult } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

function toMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const body = err.body as { details?: Array<{ message: string }> } | undefined;
    if (body?.details?.length) return body.details.map((d) => d.message).join(', ');
    return err.message;
  }
  return 'Tidak bisa menghubungi server.';
}

export interface DeliveryDocumentMatch {
  id: number;
  documentNumber: string;
  manifestNumber: string | null;
  customerName: string | null;
  deliveryDate: string;
  cycle: number;
  status: string;
}

export async function resolveDeliveryDocumentAction(
  code: string,
): Promise<{ code: string; matches: DeliveryDocumentMatch[] } | { error: string }> {
  try {
    return await apiFetch<{ code: string; matches: DeliveryDocumentMatch[] }>(
      `/loading/resolve?code=${encodeURIComponent(code)}`,
    );
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export interface DeliveryReturnResult {
  id: number;
  documentNumber: string;
  customerName: string | null;
  deliveryDate: string;
  status: 'RECEIVED';
  receivedAt: string | Date | null;
  alreadyReceived: boolean;
}

export async function receiveReturnedDeliveryAction(
  code: string,
): Promise<DeliveryReturnResult | { error: string }> {
  try {
    const result = await apiFetch<DeliveryReturnResult>('/loading/receive', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    revalidatePath('/delivery');
    revalidatePath('/trace');
    revalidatePath(`/delivery/${result.id}`);
    return result;
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
  internalKanban?: string;
  serialNumber?: string;
  clientRef?: string;
}): Promise<LoadingScanResult | { error: string; retryable: boolean }> {
  try {
    return await apiFetch<LoadingScanResult>('/loading/scan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return {
      error: toMessage(err),
      retryable: !(err instanceof ApiRequestError) || err.status >= 500,
    };
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
  reason: string,
): Promise<UndoResult | { error: string }> {
  try {
    return await apiFetch<UndoResult>(
      `/loading/${deliveryId}/lines/${lineId}/undo?phase=${phase}`,
      { method: 'POST', body: JSON.stringify({ reason }) },
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
export async function completePickingAction(id: number): Promise<PickResult | { error: string }> {
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
