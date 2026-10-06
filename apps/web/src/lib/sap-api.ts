import 'server-only';
import { apiFetch } from './api';

export interface SapSummary {
  pending: number;
  /** Sudah mendarat di staging, MENUNGGU diproses SAP. Bukan status akhir. */
  sent: number;
  confirmed: number;
  rejected: number;
  failed: number;
  held: number;
  skipped: number;
  /** Apakah pendorongan ke database jembatan sudah dinyalakan. */
  pengirimanAktif: boolean;
  /** Trial manual hanya tersedia ketika push staging nyata mati. */
  simulasiAktif: boolean;
}

export interface StagingStatus {
  sambungan: {
    terkonfigurasi: boolean;
    tersambung: boolean;
    kurang: string[];
    sejak: string | null;
    galatTerakhir: string | null;
    config: {
      host: string | null;
      port: number | null;
      instance: string | null;
      database: string | null;
      user: string | null;
      encrypt: boolean;
      dorongAktif: boolean;
      tarikAktif: boolean;
    };
  };
  target: string;
}

export interface SapOutboxRow {
  id: number;
  plantCode: string | null;
  docType: string;
  movementType: string | null;
  sourceTable: string;
  sourceId: number;
  status: string;
  isSimulation: boolean;
  attempts: number;
  lastError: string | null;
  sapDocNumber: string | null;
  occurredAt: string;
  sentAt: string | null;
  confirmedAt: string | null;
}

export interface SapOutboxList {
  data: SapOutboxRow[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function getSapSummary(): Promise<SapSummary> {
  return apiFetch<SapSummary>('/sap/summary');
}

/**
 * Keadaan sambungan ke database jembatan.
 *
 * Tanpa `?uji=true` — endpoint ini melaporkan keadaan terakhir tanpa menyentuh
 * jaringan. Mengujinya di sini berarti halaman ikut menggantung selama batas
 * waktu koneksi setiap kali SQL Server pabrik mati.
 */
export function getStagingStatus(): Promise<StagingStatus> {
  return apiFetch<StagingStatus>('/staging/status');
}

export function listSapOutbox(page = 1, perPage = 25, status = 'ALL'): Promise<SapOutboxList> {
  return apiFetch<SapOutboxList>(`/sap/outbox?page=${page}&perPage=${perPage}&status=${status}`);
}
