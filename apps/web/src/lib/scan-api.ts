import 'server-only';
import { apiFetch } from './api';
import type { StationSummary } from '@avicenna/contracts';

/** Identitas line, hitungan hari ini, dan scan terakhir — untuk memuat layar stasiun. */
export function getStationSummary(lineCode: string, limit = 10): Promise<StationSummary> {
  return apiFetch<StationSummary>(
    `/scan/summary?line=${encodeURIComponent(lineCode)}&limit=${limit}`,
  );
}
