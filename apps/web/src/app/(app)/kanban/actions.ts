'use server';

import { revalidatePath } from 'next/cache';
import type { KanbanCropProfile, KanbanCropProfileInput } from '@avicenna/contracts';
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
