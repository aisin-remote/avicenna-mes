import 'server-only';
import type { DashboardEfisiensi, LaporanProduksi } from '@avicenna/contracts';
import { apiFetch } from './api';

function qs(p: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function dashboardEfisiensi(p: {
  plant?: string;
  tanggal?: string;
  shift?: string;
  proses?: string;
}): Promise<DashboardEfisiensi> {
  return apiFetch<DashboardEfisiensi>(`/laporan/efisiensi${qs(p)}`);
}

export function laporanProduksi(p: {
  plant?: string;
  dari?: string;
  sampai?: string;
}): Promise<LaporanProduksi> {
  return apiFetch<LaporanProduksi>(`/laporan/produksi${qs(p)}`);
}
