import type { DashboardProduksi } from '@avicenna/contracts';
import { apiFetch } from './api';

/** Kartu per lini untuk papan monitor produksi. */
export function getDashboardProduksi(plant?: string): Promise<DashboardProduksi> {
  const q = plant ? `?plant=${encodeURIComponent(plant)}` : '';
  return apiFetch<DashboardProduksi>(`/scan/dashboard${q}`);
}
