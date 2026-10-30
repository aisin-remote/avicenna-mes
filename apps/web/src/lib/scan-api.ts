import 'server-only';
import { apiFetch } from './api';
import type { PapanStasiun, StationSummary } from '@avicenna/contracts';

/** Identitas line, hitungan hari ini, dan scan terakhir — untuk memuat layar stasiun. */
export function getStationSummary(lineCode: string, limit = 10): Promise<StationSummary> {
  return apiFetch<StationSummary>(
    `/scan/summary?line=${encodeURIComponent(lineCode)}&limit=${limit}`,
  );
}

/** Papan perintah kerja lini FG — antrean rencana, bukan riwayat scan. */
export function getPapanStasiun(lineCode: string, limit = 10): Promise<PapanStasiun> {
  return apiFetch<PapanStasiun>(
    `/scan/papan?line=${encodeURIComponent(lineCode)}&limit=${limit}`,
  );
}
