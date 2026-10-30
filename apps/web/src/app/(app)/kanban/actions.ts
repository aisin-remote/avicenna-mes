'use server';

import { revalidatePath } from 'next/cache';
import {
  deliveryDocumentUploadSchema,
  MAX_DELIVERY_DOCUMENT_BYTES,
  type KanbanCropProfile,
  type KanbanCropProfileInput,
  type DeliveryDocumentArchive,
} from '@avicenna/contracts';
import { getToken } from '@/lib/session';
import { apiFetch, ApiRequestError } from '@/lib/api';

export async function saveKanbanCropAction(
  input: KanbanCropProfileInput,
): Promise<KanbanCropProfile | { error: string }> {
  try {
    const saved = await apiFetch<KanbanCropProfile>(`/kanban-crops/${input.customerId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    revalidatePath('/kanban');
    return saved;
  } catch (err) {
    return { error: err instanceof ApiRequestError ? err.message : 'Tidak bisa menyimpan master.' };
  }
}

export async function resolveDocumentUploadAction(code: string) {
  try {
    return await apiFetch<{
      matches: Array<{
        id: number;
        documentNumber: string;
        manifestNumber: string | null;
        customerName: string | null;
      }>;
    }>(`/loading/resolve?${new URLSearchParams({ code })}`);
  } catch (error) {
    return {
      error: error instanceof ApiRequestError ? error.message : 'Dokumen belum dapat dicari.',
    };
  }
}

export async function documentUploadTargetAction(id: number) {
  try {
    const doc = await apiFetch<{
      id: number;
      documentNumber: string;
      pdsNumber: string | null;
      deliveryDate: string;
      customerId: number;
      customerName: string | null;
    }>(`/loading/${id}`);
    return {
      data: {
        id: doc.id,
        documentNumber: doc.documentNumber,
        pdsNumber: doc.pdsNumber,
        deliveryDate: doc.deliveryDate,
        customerId: doc.customerId,
        customerName: doc.customerName,
      },
    };
  } catch (error) {
    return {
      error: error instanceof ApiRequestError ? error.message : 'Dokumen belum dapat dibuka.',
    };
  }
}

export async function listDeliveryDocumentsAction(deliveryId: number) {
  try {
    return {
      data: await apiFetch<DeliveryDocumentArchive>(`/delivery-documents?deliveryId=${deliveryId}`),
    };
  } catch (error) {
    return {
      error: error instanceof ApiRequestError ? error.message : 'Arsip belum dapat dimuat.',
    };
  }
}

export async function uploadDeliveryDocumentAction(form: FormData) {
  try {
    if (!(await getToken())) return { error: 'Sesi habis. Masuk kembali.' };
    const file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > MAX_DELIVERY_DOCUMENT_BYTES)
      return { error: 'Pilih PDF maksimal 20 MB.' };
    const input = deliveryDocumentUploadSchema.parse({
      deliveryId: form.get('deliveryId'),
      kind: form.get('kind'),
      filename: file.name,
      fileBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    });
    const result = await apiFetch<{ id: number; alreadyStored: boolean }>('/delivery-documents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/preparation-monitoring');
    return result;
  } catch (error) {
    return {
      error:
        error instanceof ApiRequestError
          ? error.message
          : 'PDF belum dapat disimpan. Periksa file dan coba kembali.',
    };
  }
}
