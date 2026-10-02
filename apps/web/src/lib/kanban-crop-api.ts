import 'server-only';
import type { KanbanCropProfile } from '@avicenna/contracts';
import { apiFetch } from './api';

export function listKanbanCropProfiles(): Promise<KanbanCropProfile[]> {
  return apiFetch<KanbanCropProfile[]>('/kanban-crops');
}

export function getKanbanCropProfile(customerId: number): Promise<KanbanCropProfile | null> {
  return apiFetch<KanbanCropProfile | null>(`/kanban-crops/${customerId}`);
}
