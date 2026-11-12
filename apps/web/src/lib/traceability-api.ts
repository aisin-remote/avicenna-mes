import 'server-only';
import type { HasilTraceKanban, HasilTracePart } from '@avicenna/contracts';
import { apiFetch } from './api';

export function tracePart(q: string): Promise<HasilTracePart> {
  return apiFetch<HasilTracePart>(`/trace/part?q=${encodeURIComponent(q)}`);
}

export function traceKanban(q: string): Promise<HasilTraceKanban> {
  return apiFetch<HasilTraceKanban>(`/trace/kanban?q=${encodeURIComponent(q)}`);
}
