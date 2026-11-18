import 'server-only';
import { apiFetch } from './api';
import type { MoldScanBoard, PapanStasiun, StationSummary } from '@avicenna/contracts';

/** Identitas line, hitungan hari ini, dan scan terakhir — untuk memuat layar stasiun. */
export function getStationSummary(lineCode: string, limit = 10): Promise<StationSummary> {
  return apiFetch<StationSummary>(
    `/scan/summary?line=${encodeURIComponent(lineCode)}&limit=${limit}`,
  );
}

/** Progres satu putaran serta interlock line bermode KANBAN_MOLD. */
export function getMoldScanBoard(lineCode: string): Promise<MoldScanBoard> {
  return apiFetch<MoldScanBoard>(`/scan/mold?line=${encodeURIComponent(lineCode)}`);
}

/** Papan perintah kerja lini FG — antrean rencana, bukan riwayat scan. */
export function getPapanStasiun(lineCode: string, limit = 10): Promise<PapanStasiun> {
  return apiFetch<PapanStasiun>(`/scan/papan?line=${encodeURIComponent(lineCode)}&limit=${limit}`);
}
