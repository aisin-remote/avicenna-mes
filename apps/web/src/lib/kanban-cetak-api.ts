import 'server-only';
import type {
  CetakKanbanInput,
  HasilCetakKanban,
  KartuKanbanCetak,
  PartKartu,
  PratinjauCetakKanban,
} from '@avicenna/contracts';
import { apiFetch } from './api';

export function listPartKartu(): Promise<(PartKartu & { jumlahKartu: number })[]> {
  return apiFetch<(PartKartu & { jumlahKartu: number })[]>('/kanban-master/part');
}

export function pratinjauCetakKanban(input: CetakKanbanInput): Promise<PratinjauCetakKanban> {
  return apiFetch<PratinjauCetakKanban>('/kanban-master/pratinjau', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function buatKanban(input: CetakKanbanInput): Promise<HasilCetakKanban> {
  return apiFetch<HasilCetakKanban>('/kanban-master/buat', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function daftarKartuCetak(input: CetakKanbanInput): Promise<KartuKanbanCetak[]> {
  return apiFetch<KartuKanbanCetak[]>('/kanban-master/daftar', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
